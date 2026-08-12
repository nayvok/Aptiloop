import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  createCatalogPiAgentProvider,
  PiAuthInteraction,
  PiCredential,
  PiAgentProvider,
} from "@aptiloop/agent-core";
import {
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  ProviderHubRepository,
  type DatabaseConnection,
} from "@aptiloop/database";
import { describe, expect, it } from "vitest";

import { LocalPiCredentialStore } from "../src/local-pi-credential-store.js";
import { ProviderManagementService } from "../src/provider-management.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createManagementHarness(options: {
  readonly root: string;
  readonly credentialStore: LocalPiCredentialStore;
  readonly createProvider: typeof createCatalogPiAgentProvider;
}) {
  const databasePath = path.join(options.root, "provider-management.sqlite");
  const connection = openDatabase(databasePath);
  migrateDatabase(connection);
  const repository = createLearningRepository(connection);
  const connectionProviders = new Map();
  const management = new ProviderManagementService({
    connection,
    repository,
    projectRoot: options.root,
    credentialStore: options.credentialStore,
    createProvider: options.createProvider,
    connectionProviders,
  });
  return { connection, repository, connectionProviders, management };
}

async function expectRemovedConnection(
  connection: DatabaseConnection,
  connectionId: string,
  credentialStore: LocalPiCredentialStore,
  management: ProviderManagementService,
  connectionProviders: Map<string, unknown>,
  repository: ReturnType<typeof createLearningRepository>,
): Promise<void> {
  expect(await credentialStore.has(connectionId)).toBe(false);
  expect(connectionProviders.has(connectionId)).toBe(false);
  expect((await management.describe()).connections).not.toContainEqual(
    expect.objectContaining({ connectionId }),
  );
  expect(
    await repository.getSetting<{
      readonly connections: ReadonlyArray<{ readonly connectionId: string }>;
    }>("providerHubManagedConnections"),
  ).not.toMatchObject({
    connections: expect.arrayContaining([
      expect.objectContaining({ connectionId }),
    ]),
  });
  expect(
    new ProviderHubRepository(connection).listConnections(),
  ).not.toContainEqual(expect.objectContaining({ connectionId }));
  expect(
    connection.sqlite
      .prepare(
        "SELECT retired_at AS retiredAt FROM provider_hub_connections WHERE connection_id = ?",
      )
      .get(connectionId),
  ).toMatchObject({ retiredAt: expect.any(String) });
}

describe("provider management credential retirement races", () => {
  it("does not retain an API key when removal begins during a credential write", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "aptiloop-api-key-race-"));
    const persistEntered = deferred<void>();
    const allowPersist = deferred<void>();
    let blockNextPersist = false;
    let blockedPersist = false;
    const credentialStore = new LocalPiCredentialStore(root, {
      beforePersist: async () => {
        if (!blockNextPersist || blockedPersist) return;
        blockedPersist = true;
        persistEntered.resolve();
        await allowPersist.promise;
      },
    });
    const createProvider = (() =>
      ({}) as PiAgentProvider) as unknown as typeof createCatalogPiAgentProvider;
    const { connection, repository, connectionProviders, management } =
      createManagementHarness({ root, credentialStore, createProvider });

    try {
      const created = await management.create({
        catalogId: "openai-api",
        displayName: "Race-safe API provider",
        apiKey: "initial-test-api-key",
        modelIds: [],
      });
      blockNextPersist = true;

      const setting = management.setApiKey(
        created.connectionId,
        "replacement-test-api-key",
      );
      await persistEntered.promise;
      const removal = management.remove(created.connectionId);

      allowPersist.resolve();
      await expect(setting).rejects.toThrow(
        "Provider connection is being removed",
      );
      await removal;

      await expectRemovedConnection(
        connection,
        created.connectionId,
        credentialStore,
        management,
        connectionProviders,
        repository,
      );
    } finally {
      connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("awaits a late OAuth credential write before retiring the connection", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "aptiloop-oauth-race-"));
    const credentialStore = new LocalPiCredentialStore(root);
    const loginStarted = deferred<void>();
    const abortObserved = deferred<void>();
    const allowLoginCompletion = deferred<void>();
    const lateCredential: PiCredential = {
      type: "oauth",
      access: "late-test-access",
      refresh: "late-test-refresh",
      expires: 1_900_000_000_000,
    };
    const createProvider = ((
      input: Parameters<typeof createCatalogPiAgentProvider>[0],
    ) =>
      ({
        async login(_kind: "oauth", interaction: PiAuthInteraction) {
          loginStarted.resolve();
          const signal = interaction.signal;
          if (!signal) throw new Error("Expected an app-owned login signal");
          signal.addEventListener("abort", () => abortObserved.resolve(), {
            once: true,
          });
          await allowLoginCompletion.promise;
          await input.credentials.modify(
            input.connectionId,
            async () => lateCredential,
          );
          return lateCredential;
        },
      }) as unknown as ReturnType<
        typeof createCatalogPiAgentProvider
      >) as typeof createCatalogPiAgentProvider;
    const { connection, repository, connectionProviders, management } =
      createManagementHarness({ root, credentialStore, createProvider });

    try {
      const created = await management.create({
        catalogId: "openai-subscription",
        displayName: "Race-safe OAuth provider",
        modelIds: [],
      });
      const operationId = await management.startLogin(created.connectionId);
      await loginStarted.promise;

      let removalSettled = false;
      const removal = management.remove(created.connectionId).then(() => {
        removalSettled = true;
      });
      await abortObserved.promise;
      expect(removalSettled).toBe(false);

      allowLoginCompletion.resolve();
      await removal;

      expect(() => management.loginStatus(operationId)).toThrow(
        "Unknown or expired sign-in operation",
      );
      await expectRemovedConnection(
        connection,
        created.connectionId,
        credentialStore,
        management,
        connectionProviders,
        repository,
      );
    } finally {
      connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
