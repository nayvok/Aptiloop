import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type {
  PiCredential as Credential,
  PiCredentialInfo as CredentialInfo,
  PiCredentialStore as CredentialStore,
} from "@dlh/agent-core";

interface CredentialFile {
  readonly version: 1;
  readonly credentials: Readonly<Record<string, Credential>>;
}

export class LocalPiCredentialStore {
  readonly #filePath: string;
  readonly #credentials = new Map<string, Credential>();
  readonly #locks = new Map<string, Promise<void>>();
  #loaded: Promise<void> | null = null;

  constructor(projectRoot: string) {
    this.#filePath = path.join(
      path.resolve(projectRoot),
      ".data",
      "provider-credentials.json",
    );
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
    return this.#credentials.get(connectionId);
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
    const previous = this.#locks.get(connectionId) ?? Promise.resolve();
    let release!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => currentLock);
    this.#locks.set(connectionId, queued);
    await previous;
    try {
      signal?.throwIfAborted();
      const next = await operation(this.#credentials.get(connectionId));
      signal?.throwIfAborted();
      if (next === undefined) return this.#credentials.get(connectionId);
      assertCredential(next);
      this.#credentials.set(connectionId, next);
      await this.#persist();
      return next;
    } finally {
      release();
      if (this.#locks.get(connectionId) === queued) {
        this.#locks.delete(connectionId);
      }
    }
  }

  async delete(connectionId: string, signal?: AbortSignal): Promise<void> {
    await this.#ensureLoaded();
    signal?.throwIfAborted();
    if (!this.#credentials.delete(connectionId)) return;
    await this.#persist();
  }

  async #ensureLoaded(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  async #load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isCredentialFile(parsed)) {
      throw new Error("Local provider credential store is invalid");
    }
    for (const [connectionId, credential] of Object.entries(
      parsed.credentials,
    )) {
      assertConnectionId(connectionId);
      assertCredential(credential);
      this.#credentials.set(connectionId, credential);
    }
  }

  async #persist(): Promise<void> {
    const directory = path.dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.#filePath}.${randomUUID()}.tmp`;
    const payload: CredentialFile = {
      version: 1,
      credentials: Object.fromEntries(this.#credentials),
    };
    try {
      await writeFile(temporaryPath, JSON.stringify(payload), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporaryPath, this.#filePath);
      await chmod(this.#filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

function isCredentialFile(value: unknown): value is CredentialFile {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { credentials?: unknown }).credentials === "object" &&
    (value as { credentials?: unknown }).credentials !== null &&
    !Array.isArray((value as { credentials?: unknown }).credentials)
  );
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

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
