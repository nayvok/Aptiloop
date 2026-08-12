import { createHash, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalPiCredentialStore } from "../src/local-pi-credential-store.js";
import {
  createWindowsCredentialProtection,
  type WindowsCredentialProtection,
} from "../src/windows-dpapi.js";

const roots: string[] = [];
const TEST_HEADER = Buffer.from("aptiloop-test-protection-v1\0", "utf8");

function createRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-credentials-"));
  roots.push(root);
  return root;
}

function credentialPath(root: string): string {
  return path.join(root, ".data", "provider-credentials.json");
}

function persistedCredentials(root: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(credentialPath(root), "utf8")) as {
    credentials: Record<string, unknown>;
  };
  return parsed.credentials;
}

function fakeWindowsProtection(): WindowsCredentialProtection {
  return {
    async protect(plaintext) {
      const ciphertext = Buffer.from(
        plaintext.map((value, index) => value ^ ((index * 31 + 0xa5) & 0xff)),
      );
      return Buffer.concat([
        TEST_HEADER,
        createHash("sha256").update(plaintext).digest(),
        ciphertext,
      ]);
    },
    async unprotect(protectedBytes) {
      const digestOffset = TEST_HEADER.length;
      const ciphertextOffset = digestOffset + 32;
      if (
        protectedBytes.length <= ciphertextOffset ||
        !protectedBytes.subarray(0, digestOffset).equals(TEST_HEADER)
      ) {
        throw new Error("test protection rejected the payload");
      }
      const plaintext = Buffer.from(
        protectedBytes
          .subarray(ciphertextOffset)
          .map((value, index) => value ^ ((index * 31 + 0xa5) & 0xff)),
      );
      const expectedDigest = protectedBytes.subarray(
        digestOffset,
        ciphertextOffset,
      );
      const actualDigest = createHash("sha256").update(plaintext).digest();
      if (!timingSafeEqual(expectedDigest, actualDigest)) {
        throw new Error("test protection rejected the payload");
      }
      return plaintext;
    },
  };
}

function windowsStore(
  root: string,
  overrides: {
    beforePersist?: () => Promise<void> | void;
    windowsProtection?: WindowsCredentialProtection;
  } = {},
): LocalPiCredentialStore {
  return new LocalPiCredentialStore(root, {
    platform: "win32",
    windowsProtection: overrides.windowsProtection ?? fakeWindowsProtection(),
    ...(overrides.beforePersist
      ? { beforePersist: overrides.beforePersist }
      : {}),
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("LocalPiCredentialStore", () => {
  it("serializes whole-file updates for different connections on POSIX", async () => {
    const root = createRoot();
    const store = new LocalPiCredentialStore(root, { platform: "linux" });

    await Promise.all([
      store.setApiKey("conn:one", "first-secret"),
      store.setApiKey("conn:two", "second-secret"),
    ]);

    expect(persistedCredentials(root)).toEqual({
      "conn:one": { type: "api_key", key: "first-secret" },
      "conn:two": { type: "api_key", key: "second-secret" },
    });
    const reloaded = new LocalPiCredentialStore(root, { platform: "linux" });
    await expect(reloaded.has("conn:one")).resolves.toBe(true);
    await expect(reloaded.has("conn:two")).resolves.toBe(true);
  });

  it("persists a strict protected envelope and reloads credentials on Windows", async () => {
    const root = createRoot();
    const secret = "windows-sentinel-secret";
    const store = windowsStore(root);

    await store.setApiKey("conn:windows", secret);

    const raw = readFileSync(credentialPath(root), "utf8");
    expect(raw).not.toContain(secret);
    expect(JSON.parse(raw)).toEqual({
      version: 2,
      protection: "windows-dpapi-current-user",
      payload: expect.stringMatching(/^[A-Za-z0-9+/]+={0,2}$/u),
    });
    await expect(windowsStore(root).read("conn:windows")).resolves.toEqual({
      type: "api_key",
      key: secret,
    });
  });

  it("preserves supported OAuth extension data in a protected Windows store", async () => {
    const root = createRoot();
    const store = windowsStore(root);
    const credential = {
      type: "oauth" as const,
      access: "access-token",
      refresh: "refresh-token",
      expires: 1_900_000_000_000,
      enterpriseUrl: "company.ghe.example",
      availableModelIds: ["model-a", "model-b"],
    };

    await store.modify("conn:oauth", async () => credential);

    await expect(windowsStore(root).read("conn:oauth")).resolves.toEqual(
      credential,
    );
    expect(readFileSync(credentialPath(root), "utf8")).not.toContain(
      "refresh-token",
    );
  });

  it("migrates a valid legacy Windows plaintext file without a plaintext backup", async () => {
    const root = createRoot();
    const pathToCredential = credentialPath(root);
    const legacy = JSON.stringify({
      version: 1,
      credentials: {
        "conn:legacy": { type: "api_key", key: "legacy-secret" },
      },
    });
    mkdirSync(path.dirname(pathToCredential), { recursive: true });
    writeFileSync(pathToCredential, legacy, "utf8");

    const store = windowsStore(root);
    await expect(store.read("conn:legacy")).resolves.toEqual({
      type: "api_key",
      key: "legacy-secret",
    });

    const migrated = readFileSync(pathToCredential, "utf8");
    expect(migrated).not.toBe(legacy);
    expect(migrated).not.toContain("legacy-secret");
    expect(readdirSync(path.dirname(pathToCredential))).toEqual([
      "provider-credentials.json",
    ]);
    await expect(windowsStore(root).has("conn:legacy")).resolves.toBe(true);
  });

  it("leaves legacy Windows plaintext byte-for-byte unchanged if migration protection fails", async () => {
    const root = createRoot();
    const pathToCredential = credentialPath(root);
    const legacy = JSON.stringify({
      version: 1,
      credentials: {
        "conn:legacy": { type: "api_key", key: "retained-secret" },
      },
    });
    mkdirSync(path.dirname(pathToCredential), { recursive: true });
    writeFileSync(pathToCredential, legacy, "utf8");
    const failingProtection: WindowsCredentialProtection = {
      async protect() {
        throw new Error("must not escape");
      },
      async unprotect() {
        throw new Error("not used");
      },
    };

    await expect(
      windowsStore(root, { windowsProtection: failingProtection }).has(
        "conn:legacy",
      ),
    ).rejects.toThrow("Windows provider credential protection failed");
    expect(readFileSync(pathToCredential, "utf8")).toBe(legacy);
    expect(readdirSync(path.dirname(pathToCredential))).toEqual([
      "provider-credentials.json",
    ]);
  });

  it.each([
    [
      "tampered ciphertext",
      {
        version: 2,
        protection: "windows-dpapi-current-user",
        payload: Buffer.from("not-valid-protected-data").toString("base64"),
      },
    ],
    [
      "non-canonical base64",
      {
        version: 2,
        protection: "windows-dpapi-current-user",
        payload: "not base64",
      },
    ],
    [
      "an unknown envelope field",
      {
        version: 2,
        protection: "windows-dpapi-current-user",
        payload: "YQ==",
        fallback: "plaintext",
      },
    ],
    [
      "an unknown protection mode",
      { version: 2, protection: "plaintext", payload: "YQ==" },
    ],
  ])("fails closed for %s", async (_label, envelope) => {
    const root = createRoot();
    const pathToCredential = credentialPath(root);
    const serialized = JSON.stringify(envelope);
    mkdirSync(path.dirname(pathToCredential), { recursive: true });
    writeFileSync(pathToCredential, serialized, "utf8");

    await expect(windowsStore(root).has("conn:any")).rejects.toThrow(
      "Local provider credential store is invalid",
    );
    expect(readFileSync(pathToCredential, "utf8")).toBe(serialized);
  });

  it("keeps memory and disk unchanged when credential removal cannot persist", async () => {
    const root = createRoot();
    const initial = new LocalPiCredentialStore(root, { platform: "linux" });
    await initial.setApiKey("conn:kept", "retained-secret");
    let failPersistence = true;
    const store = new LocalPiCredentialStore(root, {
      platform: "linux",
      beforePersist: () => {
        if (failPersistence) throw new Error("injected persistence failure");
      },
    });

    await expect(store.delete("conn:kept")).rejects.toThrow(
      "injected persistence failure",
    );
    await expect(store.has("conn:kept")).resolves.toBe(true);
    expect(persistedCredentials(root)).toEqual({
      "conn:kept": { type: "api_key", key: "retained-secret" },
    });

    failPersistence = false;
    await store.delete("conn:kept");
    await expect(store.has("conn:kept")).resolves.toBe(false);
    expect(persistedCredentials(root)).toEqual({});
  });

  it("isolates live credentials from mutation when persistence fails", async () => {
    const root = createRoot();
    const initial = new LocalPiCredentialStore(root, { platform: "linux" });
    await initial.setApiKey("conn:kept", "initial-secret");
    const store = new LocalPiCredentialStore(root, {
      platform: "linux",
      beforePersist: () => {
        throw new Error("injected persistence failure");
      },
    });

    const leaked = await store.read("conn:kept");
    if (leaked?.type === "api_key") leaked.key = "outside-mutation";
    await expect(store.read("conn:kept")).resolves.toEqual({
      type: "api_key",
      key: "initial-secret",
    });

    await expect(
      store.modify("conn:kept", async (current) => {
        if (current?.type === "api_key") current.key = "callback-mutation";
        return current;
      }),
    ).rejects.toThrow("injected persistence failure");
    await expect(store.read("conn:kept")).resolves.toEqual({
      type: "api_key",
      key: "initial-secret",
    });
    expect(persistedCredentials(root)).toEqual({
      "conn:kept": { type: "api_key", key: "initial-secret" },
    });
  });

  it("does not commit a Windows credential when protection is aborted", async () => {
    const root = createRoot();
    const controller = new AbortController();
    let protectStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      protectStarted = resolve;
    });
    let releaseProtection!: () => void;
    const protectionReleased = new Promise<void>((resolve) => {
      releaseProtection = resolve;
    });
    const delegate = fakeWindowsProtection();
    const delayedProtection: WindowsCredentialProtection = {
      async protect(plaintext, signal) {
        protectStarted();
        await protectionReleased;
        signal?.throwIfAborted();
        return delegate.protect(plaintext, signal);
      },
      unprotect: delegate.unprotect,
    };
    const store = windowsStore(root, { windowsProtection: delayedProtection });
    const pending = store.modify(
      "conn:cancelled",
      async () => ({ type: "api_key", key: "cancelled-secret" }),
      controller.signal,
    );

    await started;
    controller.abort();
    releaseProtection();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(store.has("conn:cancelled")).resolves.toBe(false);
    expect(() => readFileSync(credentialPath(root), "utf8")).toThrow();
  });
});

describe.skipIf(process.platform !== "win32")(
  "Windows DPAPI credential protection",
  () => {
    it("round-trips synthetic bytes for only the current Windows user", async () => {
      const protection = createWindowsCredentialProtection();
      const plaintext = Buffer.from("synthetic-dpapi-secret", "utf8");

      const ciphertext = await protection.protect(plaintext);

      expect(ciphertext.equals(plaintext)).toBe(false);
      expect(ciphertext.includes(plaintext)).toBe(false);
      await expect(protection.unprotect(ciphertext)).resolves.toEqual(
        plaintext,
      );
    });

    it("rejects malformed ciphertext without returning provider bytes", async () => {
      const protection = createWindowsCredentialProtection();

      await expect(
        protection.unprotect(Buffer.from("malformed-dpapi-ciphertext")),
      ).rejects.toThrow("Windows provider credential protection failed");
    });

    it("rejects an abort that races with abort-listener registration", async () => {
      const controller = new AbortController();
      let hookCalls = 0;
      const protection = createWindowsCredentialProtection({
        beforeAbortListener: () => {
          hookCalls += 1;
          controller.abort();
        },
      });

      await expect(
        protection.protect(
          Buffer.from("synthetic-dpapi-abort-race", "utf8"),
          controller.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(hookCalls).toBe(1);
    });

    it("ignores caller-controlled Windows root environment variables", async () => {
      const previousSystemRoot = process.env.SYSTEMROOT;
      const previousWindir = process.env.WINDIR;
      process.env.SYSTEMROOT = "C:\\attacker-controlled-windows";
      process.env.WINDIR = "C:\\attacker-controlled-windows";
      try {
        const protection = createWindowsCredentialProtection();
        const plaintext = Buffer.from("synthetic-trusted-root", "utf8");
        const ciphertext = await protection.protect(plaintext);

        await expect(protection.unprotect(ciphertext)).resolves.toEqual(
          plaintext,
        );
      } finally {
        if (previousSystemRoot === undefined) delete process.env.SYSTEMROOT;
        else process.env.SYSTEMROOT = previousSystemRoot;
        if (previousWindir === undefined) delete process.env.WINDIR;
        else process.env.WINDIR = previousWindir;
      }
    });

    it("round-trips a protected payload near the plaintext limit", async () => {
      const protection = createWindowsCredentialProtection();
      const plaintext = Buffer.alloc(2 * 1024 * 1024 - 1, 0x41);

      const ciphertext = await protection.protect(plaintext);

      expect(ciphertext.length).toBeGreaterThan(plaintext.length);
      await expect(protection.unprotect(ciphertext)).resolves.toEqual(
        plaintext,
      );
    });
  },
);
