import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, type TestContext } from "vitest";
import { z } from "zod";

import { createApp } from "../src/app.js";

const runtimes: Array<ReturnType<typeof createApp>> = [];
const roots: string[] = [];

function databaseFamilyBytes(databasePath: string): Array<Buffer | null> {
  return ["", "-wal", "-shm", "-journal"].map((suffix) => {
    const candidate = `${databasePath}${suffix}`;
    return existsSync(candidate) ? readFileSync(candidate) : null;
  });
}

function tryCreateDirectoryLink(
  context: TestContext,
  target: string,
  linkPath: string,
): boolean {
  try {
    symlinkSync(
      target,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (
      ["EACCES", "EINVAL", "ENOSYS", "ENOTSUP", "EPERM"].includes(code ?? "")
    ) {
      return context.skip("Directory links are not supported on this platform");
    }
    throw error;
  }
}

function withEnvironment<T>(
  values: Readonly<Record<string, string>>,
  callback: () => T,
): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function runtime(options: Parameters<typeof createApp>[0] = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-orchestrator-"));
  roots.push(root);
  const created = createApp({
    projectRoot: path.resolve("../.."),
    databasePath: path.join(root, "test.sqlite"),
    databaseMode: "disposable",
    ...options,
  });
  runtimes.push(created);
  return created;
}

const request = (
  app: ReturnType<typeof createApp>["app"],
  path: string,
  init?: RequestInit,
) =>
  app.request(`http://127.0.0.1:8787${path}`, {
    ...init,
    headers: {
      Host: "127.0.0.1:8787",
      "X-Aptiloop-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });

describe("orchestrator vertical flow", () => {
  it("rejects an alternate database before changing its bytes", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "aptiloop-db-guard-"));
    roots.push(projectRoot);
    const alternateDirectory = path.join(projectRoot, "data");
    const alternateDatabase = path.join(
      alternateDirectory,
      "dev-learning-harness.sqlite",
    );
    const original = Buffer.from("quarantined legacy database", "utf8");
    mkdirSync(alternateDirectory, { recursive: true });
    writeFileSync(alternateDatabase, original);

    expect(() =>
      createApp({ projectRoot, databasePath: alternateDatabase }),
    ).toThrow("may write only .data/dev-learning-harness.sqlite");
    expect(readFileSync(alternateDatabase)).toEqual(original);
  });

  it("rejects a stale exact-path database before app writable open", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "aptiloop-stale-db-"));
    roots.push(projectRoot);
    const dataDirectory = path.join(projectRoot, ".data");
    const databasePath = path.join(
      dataDirectory,
      "dev-learning-harness.sqlite",
    );
    mkdirSync(dataDirectory);
    const stale = new DatabaseSync(databasePath);
    stale.exec(`
      CREATE TABLE __dlh_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO __dlh_migrations (id, applied_at) VALUES ('0000_initial', 1);
      CREATE TABLE stale_payload (value TEXT NOT NULL);
      INSERT INTO stale_payload (value) VALUES ('must remain unchanged');
    `);
    stale.close();
    const before = databaseFamilyBytes(databasePath);

    expect(() => createApp({ projectRoot })).toThrow(
      /exact migration contract/u,
    );

    expect(databaseFamilyBytes(databasePath)).toEqual(before);
  });

  it("rejects a linked launcher-owned E2E run root before changing external bytes", (context) => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "aptiloop-e2e-guard-"));
    const externalRunRoot = mkdtempSync(
      path.join(tmpdir(), "aptiloop-e2e-external-"),
    );
    roots.push(projectRoot, externalRunRoot);
    const runId = "linked-run-12345678";
    const runsRoot = path.join(projectRoot, ".data", "e2e-runs");
    const runRoot = path.join(runsRoot, runId);
    const databasePath = path.join(runRoot, "database.sqlite");
    const externalDatabase = path.join(externalRunRoot, "database.sqlite");
    const original = Buffer.from("external E2E database", "utf8");
    mkdirSync(runsRoot, { recursive: true });
    writeFileSync(externalDatabase, original, { flag: "wx" });
    if (!tryCreateDirectoryLink(context, externalRunRoot, runRoot)) return;

    withEnvironment(
      {
        NODE_ENV: "test",
        E2E_RUN_ID: runId,
        E2E_RUN_ROOT: runRoot,
        E2E_DATABASE_PATH: databasePath,
      },
      () => {
        expect(() => createApp({ projectRoot, databasePath })).toThrow(
          /symbolic link|junction|reparse point/u,
        );
      },
    );
    expect(readFileSync(externalDatabase)).toEqual(original);
  });

  it("revalidates the active target before writable SQLite pragmas", (context) => {
    const projectRoot = mkdtempSync(
      path.join(tmpdir(), "aptiloop-open-guard-"),
    );
    const externalData = mkdtempSync(
      path.join(tmpdir(), "aptiloop-open-external-"),
    );
    roots.push(projectRoot, externalData);
    const dataDirectory = path.join(projectRoot, ".data");
    const displacedData = path.join(projectRoot, ".data-displaced");
    const externalDatabase = path.join(
      externalData,
      "dev-learning-harness.sqlite",
    );
    const external = new DatabaseSync(externalDatabase);
    external.exec("CREATE TABLE external_sentinel (value TEXT NOT NULL)");
    external.close();
    const before = readFileSync(externalDatabase);

    const probeLink = path.join(projectRoot, "junction-probe");
    if (!tryCreateDirectoryLink(context, externalData, probeLink)) return;
    rmSync(probeLink, { force: true });

    expect(() =>
      createApp({
        projectRoot,
        databaseTestHooks: {
          beforeOpen: () => {
            renameSync(dataDirectory, displacedData);
            symlinkSync(
              externalData,
              dataDirectory,
              process.platform === "win32" ? "junction" : "dir",
            );
          },
        },
      }),
    ).toThrow(/symbolic link|junction|reparse point/u);

    expect(readFileSync(externalDatabase)).toEqual(before);
    expect(existsSync(`${externalDatabase}-wal`)).toBe(false);
    expect(existsSync(`${externalDatabase}-shm`)).toBe(false);
  });

  it("retires the legacy dashboard and creates a resumable v2 session", async () => {
    const { app } = runtime();
    const dashboard = await request(app, "/api/dashboard");
    expect(dashboard.status).toBe(410);
    expect(await dashboard.json()).toEqual({
      error: "Legacy dashboard retired; use /api/home and /api/courses",
    });

    const learningPath = z
      .object({
        curriculum: z.object({
          weeks: z.array(
            z.object({ days: z.array(z.object({ id: z.string() })) }),
          ),
        }),
      })
      .parse(await (await request(app, "/api/learning/path")).json());
    const dayId = learningPath.curriculum.weeks[0]?.days[0]?.id;
    expect(dayId).toBeTruthy();

    const startBody = JSON.stringify({
      dayId,
      operationId: "app-integration-v2-session",
    });
    const started = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: startBody,
    });
    expect(started.status).toBe(201);
    const startedSession = z
      .object({ session: z.object({ id: z.string() }) })
      .parse(await started.json()).session;

    const resumed = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: startBody,
    });
    const resumedSession = z
      .object({ session: z.object({ id: z.string() }) })
      .parse(await resumed.json()).session;
    expect(resumedSession.id).toBe(startedSession.id);

    const detail = await request(
      app,
      `/api/learning/sessions/v2/${startedSession.id}`,
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      session: { id: startedSession.id, status: "active" },
    });
  });

  it("streams normalized mock events", async () => {
    const { app } = runtime();
    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Мой ответ" }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"message.delta"');
    expect(body).toContain('"content"');

    const history = await request(app, "/api/agent/history?role=teacher");
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(historyBody.messages).toHaveLength(2);
    expect(historyBody.messages[0]).toMatchObject({
      role: "user",
      content: "Мой ответ",
    });
    expect(historyBody.messages[1]?.role).toBe("assistant");
  });

  it("registers the pinned OpenCode Zen Pi provider", async () => {
    const previousApiKey = process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    try {
      const { state } = runtime();
      const status = await state.providers.opencode.getStatus();
      expect(status).toMatchObject({
        providerId: "opencode",
        state: "authentication-required",
      });
      await expect(
        state.providers.opencode.listModels(),
      ).resolves.toContainEqual(
        expect.objectContaining({
          id: "deepseek-v4-flash-free",
          providerId: "opencode",
          available: false,
        }),
      );
    } finally {
      if (previousApiKey === undefined) delete process.env.OPENCODE_API_KEY;
      else process.env.OPENCODE_API_KEY = previousApiKey;
    }
  });

  it("manages built-in, custom HTTPS, and loopback connections without exposing secrets", async () => {
    const { app } = runtime();

    const initial = await request(app, "/api/settings");
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as {
      ai: { management: { catalog: unknown[] } };
    };
    expect(initialBody.ai.management.catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "openai-api",
          authKind: "api-key",
        }),
        expect.objectContaining({ id: "ollama-local", authKind: "local" }),
        expect.objectContaining({
          id: "custom-openai-compatible",
          authKind: "api-key",
          endpointKind: "external",
        }),
      ]),
    );

    const rejected = await request(app, "/api/settings/ai/connections", {
      method: "POST",
      body: JSON.stringify({
        catalogId: "ollama-local",
        displayName: "Forged remote Ollama",
        baseUrl: "https://example.com/v1",
        modelIds: ["qwen2.5-coder"],
      }),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: expect.stringContaining("loopback HTTP URLs"),
    });

    for (const baseUrl of [
      "http://inference.example.com/v1",
      "https://127.0.0.1/v1",
      "https://gateway.local/v1",
      "https://user:secret@inference.example.com/v1",
    ]) {
      const customRejected = await request(
        app,
        "/api/settings/ai/connections",
        {
          method: "POST",
          body: JSON.stringify({
            catalogId: "custom-openai-compatible",
            displayName: "Unsafe custom endpoint",
            apiKey: "custom-test-secret",
            baseUrl,
            modelIds: ["reviewed-model"],
          }),
        },
      );
      expect(customRejected.status).toBe(400);
      expect(await customRejected.json()).toMatchObject({
        error: expect.stringContaining("public HTTPS hostnames"),
      });
    }

    const customCreated = await request(app, "/api/settings/ai/connections", {
      method: "POST",
      body: JSON.stringify({
        catalogId: "custom-openai-compatible",
        displayName: "Reviewed inference gateway",
        apiKey: "custom-test-secret",
        baseUrl: "https://inference.example.com/openai/v1",
        modelIds: ["reviewed-model"],
      }),
    });
    expect(customCreated.status).toBe(201);
    const customBody = await customCreated.json();
    expect(JSON.stringify(customBody)).not.toContain("custom-test-secret");
    const customConnectionId = z
      .object({ connection: z.object({ connectionId: z.string() }) })
      .parse(customBody).connection.connectionId;

    const localCreated = await request(app, "/api/settings/ai/connections", {
      method: "POST",
      body: JSON.stringify({
        catalogId: "ollama-local",
        displayName: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        modelIds: ["qwen2.5-coder"],
      }),
    });
    expect(localCreated.status).toBe(201);
    const local = z
      .object({ connection: z.object({ connectionId: z.string() }) })
      .parse(await localCreated.json()).connection;

    const apiCreated = await request(app, "/api/settings/ai/connections", {
      method: "POST",
      body: JSON.stringify({
        catalogId: "openai-api",
        displayName: "Personal OpenAI",
        apiKey: "sk-test-secret-value",
      }),
    });
    expect(apiCreated.status).toBe(201);
    const apiBody = await apiCreated.json();
    expect(JSON.stringify(apiBody)).not.toContain("sk-test-secret-value");
    const apiConnectionId = z
      .object({ connection: z.object({ connectionId: z.string() }) })
      .parse(apiBody).connection.connectionId;

    const configured = await request(app, "/api/settings");
    const configuredText = await configured.text();
    expect(configuredText).not.toContain("sk-test-secret-value");
    expect(configuredText).not.toContain("custom-test-secret");
    expect(JSON.parse(configuredText)).toMatchObject({
      ai: {
        management: {
          connections: expect.arrayContaining([
            expect.objectContaining({
              connectionId: local.connectionId,
              authKind: "local",
            }),
            expect.objectContaining({
              connectionId: apiConnectionId,
              authKind: "api-key",
              credentialConfigured: true,
            }),
            expect.objectContaining({
              connectionId: customConnectionId,
              authKind: "api-key",
              credentialConfigured: true,
              baseUrl: "https://inference.example.com/openai/v1",
              modelIds: ["reviewed-model"],
            }),
          ]),
        },
      },
    });

    const disabled = await request(
      app,
      `/api/settings/ai/connections/${encodeURIComponent(local.connectionId)}/disable`,
      { method: "POST", body: "{}" },
    );
    expect(disabled.status).toBe(200);
    const disabledSettings = await request(app, "/api/settings");
    expect(await disabledSettings.json()).toMatchObject({
      ai: {
        connections: expect.arrayContaining([
          expect.objectContaining({
            connectionId: local.connectionId,
            enabled: false,
            state: "disabled",
            observedCapabilities: null,
          }),
        ]),
      },
    });
    const enabled = await request(
      app,
      `/api/settings/ai/connections/${encodeURIComponent(local.connectionId)}/enable`,
      { method: "POST", body: "{}" },
    );
    expect(enabled.status).toBe(200);
  });

  it("rejects a forged OpenCode endpoint without sending environment credentials", async () => {
    const capturedRequests: Array<{
      authorization: string | undefined;
      url: string | undefined;
    }> = [];
    const credentialCapture = createServer((incoming, response) => {
      capturedRequests.push({
        authorization: incoming.headers.authorization,
        url: incoming.url,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve, reject) => {
      credentialCapture.once("error", reject);
      credentialCapture.listen(0, "127.0.0.1", resolve);
    });
    const address = credentialCapture.address();
    if (address === null || typeof address === "string") {
      throw new Error("Credential capture server did not expose a TCP port");
    }

    const previousEndpoint = process.env.OPENCODE_ENDPOINT;
    const previousUsername = process.env.OPENCODE_SERVER_USERNAME;
    const previousPassword = process.env.OPENCODE_SERVER_PASSWORD;
    delete process.env.OPENCODE_ENDPOINT;
    process.env.OPENCODE_SERVER_USERNAME = "capture-user";
    process.env.OPENCODE_SERVER_PASSWORD = "capture-secret";
    try {
      const { app, state } = runtime();
      const forgedEndpoint = `http://127.0.0.1:${address.port}`;
      const forged = await request(app, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          theme: "dark",
          opencodeBaseUrl: forgedEndpoint,
        }),
      });

      expect(forged.status).toBe(400);
      expect(capturedRequests).toEqual([]);
      expect(await state.repository.getSetting("theme")).toBeNull();
      expect(await state.repository.getSetting("opencodeBaseUrl")).toBeNull();

      const theme = await request(app, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({ theme: "dark" }),
      });
      expect(theme.status).toBe(200);
      expect(await theme.json()).toEqual({ saved: true });
      expect(await state.repository.getSetting("theme")).toBe("dark");
      expect(capturedRequests).toEqual([]);

      await state.repository.setSetting("opencodeBaseUrl", forgedEndpoint);
      const settings = await request(app, "/api/settings");
      expect(settings.status).toBe(200);
      const serverSettings = z
        .object({
          opencodeBaseUrl: z.string().url(),
          theme: z.literal("dark"),
          ai: z.object({
            connections: z.array(z.unknown()),
            roleProfiles: z.array(z.unknown()),
          }),
        })
        .passthrough()
        .parse(await settings.json());
      expect(serverSettings.opencodeBaseUrl).toBe("http://127.0.0.1:4096");
      expect(capturedRequests).toEqual([]);
    } finally {
      if (previousEndpoint === undefined) delete process.env.OPENCODE_ENDPOINT;
      else process.env.OPENCODE_ENDPOINT = previousEndpoint;
      if (previousUsername === undefined)
        delete process.env.OPENCODE_SERVER_USERNAME;
      else process.env.OPENCODE_SERVER_USERNAME = previousUsername;
      if (previousPassword === undefined)
        delete process.env.OPENCODE_SERVER_PASSWORD;
      else process.env.OPENCODE_SERVER_PASSWORD = previousPassword;
      await new Promise<void>((resolve, reject) => {
        credentialCapture.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
