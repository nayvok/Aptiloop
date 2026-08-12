import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import type {
  PiCredential as Credential,
  PiCredentialInfo as CredentialInfo,
  PiCredentialStore as CredentialStore,
} from "@aptiloop/agent-core";

import {
  createWindowsCredentialProtection,
  type WindowsCredentialProtection,
} from "./windows-dpapi.js";

interface PlaintextCredentialFile {
  readonly version: 1;
  readonly credentials: Readonly<Record<string, Credential>>;
}

interface WindowsProtectedCredentialFile {
  readonly version: 2;
  readonly protection: "windows-dpapi-current-user";
  readonly payload: string;
}

interface LocalPiCredentialStoreTestHooks {
  /** @internal Deterministic persistence-failure seam. */
  readonly beforePersist?: () => Promise<void> | void;
  /** @internal Platform seam for storage-format tests. */
  readonly platform?: NodeJS.Platform;
  /** @internal DPAPI seam for deterministic failure and migration tests. */
  readonly windowsProtection?: WindowsCredentialProtection;
}

const MAX_CREDENTIAL_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES = 2 * 1024 * 1024;
const WINDOWS_PROTECTION = "windows-dpapi-current-user" as const;

export class LocalPiCredentialStore {
  readonly #filePath: string;
  readonly #credentials = new Map<string, Credential>();
  readonly #testHooks: LocalPiCredentialStoreTestHooks;
  readonly #windowsProtection: WindowsCredentialProtection | null;
  #mutationTail: Promise<void> = Promise.resolve();
  #loaded: Promise<void> | null = null;

  constructor(
    projectRoot: string,
    testHooks: LocalPiCredentialStoreTestHooks = {},
  ) {
    this.#filePath = path.join(
      path.resolve(projectRoot),
      ".data",
      "provider-credentials.json",
    );
    this.#testHooks = testHooks;
    const platform = testHooks.platform ?? process.platform;
    this.#windowsProtection =
      platform === "win32"
        ? (testHooks.windowsProtection ?? createWindowsCredentialProtection())
        : null;
  }

  scope(connectionId: string): CredentialStore {
    return {
      read: async (_providerId, options) => {
        options?.signal?.throwIfAborted();
        return this.read(connectionId);
      },
      list: async (options) => {
        options?.signal?.throwIfAborted();
        const credential = await this.read(connectionId);
        return credential
          ? ([
              { providerId: connectionId, type: credential.type },
            ] satisfies CredentialInfo[])
          : [];
      },
      modify: async (_providerId, operation, options) => {
        options?.signal?.throwIfAborted();
        return this.modify(connectionId, operation, options?.signal);
      },
      delete: async (_providerId, options) => {
        options?.signal?.throwIfAborted();
        await this.delete(connectionId, options?.signal);
      },
    };
  }

  async read(connectionId: string): Promise<Credential | undefined> {
    await this.#ensureLoaded();
    const credential = this.#credentials.get(connectionId);
    return credential ? cloneCredential(credential) : undefined;
  }

  async has(connectionId: string): Promise<boolean> {
    return (await this.read(connectionId)) !== undefined;
  }

  async setApiKey(connectionId: string, apiKey: string): Promise<void> {
    const key = apiKey.trim();
    if (key.length < 8 || key.length > 20_000) {
      throw new Error("API key must contain between 8 and 20000 characters");
    }
    await this.modify(connectionId, async () => ({ type: "api_key", key }));
  }

  async modify(
    connectionId: string,
    operation: (
      current: Credential | undefined,
    ) => Promise<Credential | undefined>,
    signal?: AbortSignal,
  ): Promise<Credential | undefined> {
    await this.#ensureLoaded();
    return this.#withMutationLock(async () => {
      signal?.throwIfAborted();
      const current = this.#credentials.get(connectionId);
      const next = await operation(
        current ? cloneCredential(current) : undefined,
      );
      signal?.throwIfAborted();
      if (next === undefined)
        return current ? cloneCredential(current) : undefined;
      const canonical = cloneCredential(next);
      const staged = new Map(this.#credentials);
      staged.set(connectionId, canonical);
      await this.#persist(staged, signal);
      this.#credentials.set(connectionId, canonical);
      return cloneCredential(canonical);
    });
  }

  async delete(connectionId: string, signal?: AbortSignal): Promise<void> {
    await this.#ensureLoaded();
    await this.#withMutationLock(async () => {
      signal?.throwIfAborted();
      if (!this.#credentials.has(connectionId)) return;
      const staged = new Map(this.#credentials);
      staged.delete(connectionId);
      await this.#persist(staged, signal);
      this.#credentials.delete(connectionId);
    });
  }

  async #ensureLoaded(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  async #load(): Promise<void> {
    let fileSize: number;
    try {
      fileSize = (await stat(this.#filePath)).size;
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    if (fileSize <= 0 || fileSize > MAX_CREDENTIAL_FILE_BYTES) {
      throw invalidCredentialStore();
    }

    let raw: string;
    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    const parsed = parseJson(raw);
    let credentialFile: PlaintextCredentialFile;
    let migratePlaintext = false;
    if (isPlaintextCredentialFile(parsed)) {
      credentialFile = parsed;
      migratePlaintext = this.#windowsProtection !== null;
    } else if (isWindowsProtectedCredentialFile(parsed)) {
      if (!this.#windowsProtection) throw invalidCredentialStore();
      let plaintext: Buffer;
      try {
        plaintext = await this.#windowsProtection.unprotect(
          decodeCanonicalBase64(parsed.payload),
        );
      } catch {
        throw invalidCredentialStore();
      }
      if (plaintext.length === 0 || plaintext.length > MAX_PLAINTEXT_BYTES) {
        throw invalidCredentialStore();
      }
      const decrypted = parseJson(plaintext.toString("utf8"));
      if (!isPlaintextCredentialFile(decrypted)) {
        throw invalidCredentialStore();
      }
      credentialFile = decrypted;
    } else {
      throw invalidCredentialStore();
    }

    const loaded = new Map<string, Credential>();
    for (const [connectionId, credential] of Object.entries(
      credentialFile.credentials,
    )) {
      assertConnectionId(connectionId);
      loaded.set(connectionId, cloneCredential(credential));
    }
    if (migratePlaintext) await this.#persist(loaded);
    for (const [connectionId, credential] of loaded) {
      this.#credentials.set(connectionId, credential);
    }
  }

  async #persist(
    credentials: ReadonlyMap<string, Credential>,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    await this.#testHooks.beforePersist?.();
    signal?.throwIfAborted();
    const directory = path.dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.#filePath}.${randomUUID()}.tmp`;
    const plaintext: PlaintextCredentialFile = {
      version: 1,
      credentials: Object.fromEntries(credentials),
    };
    const plaintextBytes = Buffer.from(JSON.stringify(plaintext), "utf8");
    if (plaintextBytes.length > MAX_PLAINTEXT_BYTES) {
      throw new Error("Local provider credential store is too large");
    }
    let serialized: string;
    if (this.#windowsProtection) {
      let ciphertext: Buffer;
      try {
        ciphertext = await this.#windowsProtection.protect(
          plaintextBytes,
          signal,
        );
      } catch (error) {
        if (signal?.aborted) signal.throwIfAborted();
        throw new Error("Windows provider credential protection failed", {
          cause: error,
        });
      }
      if (
        ciphertext.length === 0 ||
        ciphertext.length > MAX_PLAINTEXT_BYTES * 1.5
      ) {
        throw new Error("Windows provider credential protection failed");
      }
      const protectedFile: WindowsProtectedCredentialFile = {
        version: 2,
        protection: WINDOWS_PROTECTION,
        payload: ciphertext.toString("base64"),
      };
      serialized = JSON.stringify(protectedFile);
    } else {
      serialized = plaintextBytes.toString("utf8");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_CREDENTIAL_FILE_BYTES) {
      throw new Error("Local provider credential store is too large");
    }
    signal?.throwIfAborted();

    let temporaryFile: Awaited<ReturnType<typeof open>> | null = null;
    try {
      temporaryFile = await open(temporaryPath, "wx", 0o600);
      await temporaryFile.writeFile(serialized, "utf8");
      signal?.throwIfAborted();
      await temporaryFile.chmod(0o600);
      signal?.throwIfAborted();
      await temporaryFile.sync();
      signal?.throwIfAborted();
      await temporaryFile.close();
      temporaryFile = null;
      signal?.throwIfAborted();
      await rename(temporaryPath, this.#filePath);
    } catch (error) {
      await temporaryFile?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw error;
    }
    if (!this.#windowsProtection) {
      await chmod(this.#filePath, 0o600);
    }
  }

  async #withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release!: () => void;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function isPlaintextCredentialFile(
  value: unknown,
): value is PlaintextCredentialFile {
  return (
    isObject(value) &&
    hasExactKeys(value, ["credentials", "version"]) &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { credentials?: unknown }).credentials === "object" &&
    (value as { credentials?: unknown }).credentials !== null &&
    !Array.isArray((value as { credentials?: unknown }).credentials)
  );
}

function isWindowsProtectedCredentialFile(
  value: unknown,
): value is WindowsProtectedCredentialFile {
  return (
    isObject(value) &&
    hasExactKeys(value, ["payload", "protection", "version"]) &&
    value.version === 2 &&
    value.protection === WINDOWS_PROTECTION &&
    typeof value.payload === "string" &&
    value.payload.length > 0 &&
    value.payload.length <= MAX_CREDENTIAL_FILE_BYTES
  );
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    expected.every((key, index) => actual[index] === key)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw invalidCredentialStore();
  }
}

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/iu.test(value)) {
    throw invalidCredentialStore();
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw invalidCredentialStore();
  }
  return decoded;
}

function assertConnectionId(connectionId: string): void {
  if (!/^[a-z0-9][a-z0-9._:-]{0,199}$/u.test(connectionId)) {
    throw new Error("Credential store contains an invalid connection id");
  }
}

function assertCredential(value: unknown): asserts value is Credential {
  if (typeof value !== "object" || value === null) {
    throw new Error("Credential store contains an invalid credential");
  }
  const type = (value as { type?: unknown }).type;
  if (type === "api_key") {
    const key = (value as { key?: unknown }).key;
    if (key !== undefined && (typeof key !== "string" || key.length > 20_000)) {
      throw new Error("Credential store contains an invalid API key");
    }
    return;
  }
  if (type === "oauth") {
    const candidate = value as {
      access?: unknown;
      refresh?: unknown;
      expires?: unknown;
    };
    if (
      typeof candidate.access !== "string" ||
      typeof candidate.refresh !== "string" ||
      typeof candidate.expires !== "number"
    ) {
      throw new Error("Credential store contains an invalid OAuth credential");
    }
    return;
  }
  throw new Error("Credential store contains an unsupported credential type");
}

function cloneCredential(value: unknown): Credential {
  assertCredential(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error("Credential store contains an invalid credential", {
      cause: error,
    });
  }
  const clone = parseJson(serialized);
  assertCredential(clone);
  return clone;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function invalidCredentialStore(): Error {
  return new Error("Local provider credential store is invalid");
}
