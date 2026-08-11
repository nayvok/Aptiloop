import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { weekOneCurriculum } from "@aptiloop/curriculum";
import type {
  DatabaseConnection,
  LearningRepository,
} from "@aptiloop/database";
import { afterEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";

import { createApp, type AppOptions } from "../src/app.js";

interface TestRuntime {
  app: Hono;
  state: {
    connection: DatabaseConnection;
    repository: LearningRepository;
  };
  close(): Promise<void>;
}

const runtimes: TestRuntime[] = [];
const roots: string[] = [];
const webOrigin = "http://127.0.0.1:3000";
const directAuthority = "127.0.0.1:8787";
const composeAuthority = "orchestrator:8787";
const directStartup = {
  bindMode: "direct",
  hostname: "127.0.0.1",
  port: 8787,
} as const;
const composeStartup = {
  bindMode: "container-loopback-published",
  hostname: "0.0.0.0",
  port: 8787,
} as const;
const browserMutationHeaders = {
  "Content-Type": "application/json",
  Origin: webOrigin,
  "X-Aptiloop-Client": "web",
};
const legacyLearningMutationError = {
  error: "Legacy learning mutations are frozen; use /api/learning/sessions/v2",
} as const;
const canonicalNextProxyHeaders = {
  "X-Forwarded-For": "::ffff:127.0.0.1",
  "X-Forwarded-Host": "127.0.0.1:3000",
  "X-Forwarded-Port": "3000",
  "X-Forwarded-Proto": "http",
};
const settingsMutation = { theme: "dark" } as const;

function productionRuntime(
  startupConfig: NonNullable<AppOptions["startupConfig"]> = directStartup,
): TestRuntime {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-http-boundary-"));
  roots.push(root);
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const created = createApp({
      projectRoot: path.resolve("../.."),
      databasePath: path.join(root, "test.sqlite"),
      databaseMode: "disposable",
      webOrigin,
      startupConfig,
    });
    runtimes.push(created);
    return created;
  } finally {
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
}

function apiRequest(
  app: Hono,
  authority: string,
  pathname: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  if (!headers.has("Host")) headers.set("Host", authority);
  return app.request(`http://${authority}${pathname}`, { ...init, headers });
}

function mutation(
  app: Hono,
  authority = directAuthority,
  extraHeaders: RequestInit["headers"] = {},
) {
  const headers = new Headers(browserMutationHeaders);
  new Headers(extraHeaders).forEach((value, name) => headers.set(name, value));
  return apiRequest(app, authority, "/api/boundary-probe", {
    method: "POST",
    headers,
    body: "{}",
  });
}

function saveSettings(
  app: Hono,
  authority: string,
  forwardingHeaders: RequestInit["headers"] = {},
) {
  const headers = new Headers(browserMutationHeaders);
  new Headers(forwardingHeaders).forEach((value, name) =>
    headers.set(name, value),
  );
  return apiRequest(app, authority, "/api/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify(settingsMutation),
  });
}

function totalChanges(runtime: TestRuntime): number {
  const result = runtime.state.connection.sqlite
    .prepare("SELECT total_changes() AS changes")
    .get();
  if (
    !result ||
    typeof result !== "object" ||
    !("changes" in result) ||
    typeof result.changes !== "number"
  ) {
    throw new Error("SQLite did not return total_changes()");
  }
  return result.changes;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("production HTTP boundary", () => {
  it.each<[string, string, NonNullable<AppOptions["startupConfig"]>]>([
    [
      "IPv4 loopback",
      "127.0.0.1:8787",
      { bindMode: "direct", hostname: "127.0.0.1", port: 8787 },
    ],
    [
      "localhost with a configured port",
      "localhost:4317",
      { bindMode: "direct", hostname: "localhost", port: 4317 },
    ],
    [
      "localhost with the default HTTP port",
      "localhost:80",
      { bindMode: "direct", hostname: "localhost", port: 80 },
    ],
    [
      "bracketed IPv6 loopback",
      "[::1]:65535",
      { bindMode: "direct", hostname: "::1", port: 65_535 },
    ],
  ])(
    "accepts the exact configured direct %s authority",
    async (_label, authority, startupConfig) => {
      const { app } = productionRuntime(startupConfig);
      const read = await apiRequest(app, authority, "/api/settings");
      expect(read.status).toBe(200);
      expect(read.headers.get("Cache-Control")).toBe("no-store");
      expect((await saveSettings(app, authority)).status).toBe(200);
    },
  );

  it("blocks DNS-rebinding-shaped reads and mutations before routing", async () => {
    const runtime = productionRuntime();
    const attackerAuthority = "attacker.example:8787";
    const beforeMutation = totalChanges(runtime);

    const read = await runtime.app.request(
      `http://${attackerAuthority}/api/settings`,
      { headers: { Host: attackerAuthority } },
    );
    expect(read.status).toBe(400);
    expect(await read.json()).toEqual({
      error: "Request authority is invalid",
    });
    expect(read.headers.get("Cache-Control")).toBe("no-store");

    const mutationHeaders = new Headers(browserMutationHeaders);
    mutationHeaders.set("Host", attackerAuthority);
    const write = await runtime.app.request(
      `http://${attackerAuthority}/api/settings`,
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify(settingsMutation),
      },
    );
    expect(write.status).toBe(400);
    expect(await write.json()).toEqual({
      error: "Request authority is invalid",
    });
    expect(totalChanges(runtime)).toBe(beforeMutation);
  });

  it.each<[string, string | undefined]>([
    ["missing", undefined],
    ["suffix-shaped", "127.0.0.1.attacker.example:8787"],
    ["other loopback spelling", "localhost:8787"],
    ["other loopback family", "[::1]:8787"],
    ["wrong-port", "127.0.0.1:8788"],
    ["comma-joined", "127.0.0.1:8787, attacker.example:8787"],
    ["malformed", "127.0.0.1:8787:443"],
  ])("rejects a %s direct Host header", async (_label, host) => {
    const { app } = productionRuntime();
    const headers = new Headers();
    if (host !== undefined) headers.set("Host", host);
    const response = await app.request(
      `http://${directAuthority}/api/settings`,
      { headers },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request authority is invalid",
    });
  });

  it("rejects duplicated Host and mismatched request URL authority", async () => {
    const { app } = productionRuntime();
    const duplicatedHost = new Headers({ Host: directAuthority });
    duplicatedHost.append("Host", directAuthority);
    const duplicated = await app.request(
      `http://${directAuthority}/api/settings`,
      { headers: duplicatedHost },
    );
    expect(duplicated.status).toBe(400);

    const mismatchedUrl = await app.request(
      "http://attacker.example:8787/api/settings",
      { headers: { Host: directAuthority } },
    );
    expect(mismatchedUrl.status).toBe(400);
    expect(await mismatchedUrl.json()).toEqual({
      error: "Request authority is invalid",
    });
  });

  it("preserves the exact host-only marker emitted by Next 16.3 in direct mode", async () => {
    const { app } = productionRuntime();
    const forwardedHost = { "X-Forwarded-Host": "127.0.0.1:3000" };
    const read = await apiRequest(app, directAuthority, "/api/settings", {
      headers: forwardedHost,
    });
    expect(read.status).toBe(200);
    expect(
      (await saveSettings(app, directAuthority, forwardedHost)).status,
    ).toBe(200);
  });

  it.each<[string, NonNullable<RequestInit["headers"]>]>([
    [
      "mismatched host-only marker",
      { "X-Forwarded-Host": "evil.example:3000" },
    ],
    [
      "comma-joined host-only marker",
      { "X-Forwarded-Host": "127.0.0.1:3000, evil.example:3000" },
    ],
    ["partial forwarding", { "X-Forwarded-Port": "3000" }],
    ["full proxy tuple", canonicalNextProxyHeaders],
    ["standard Forwarded header", { Forwarded: "for=127.0.0.1" }],
    ["real-IP header", { "X-Real-IP": "127.0.0.1" }],
    ["extra forwarded header", { "X-Forwarded-Server": "proxy" }],
  ])("rejects direct-mode %s", async (_label, headers) => {
    const { app } = productionRuntime();
    const response = await mutation(app, directAuthority, headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Forwarding headers are invalid",
    });
  });

  it.each<[string, NonNullable<RequestInit["headers"]>]>([
    [
      "Next 16.3 host-only forwarding",
      { "X-Forwarded-Host": "127.0.0.1:3000" },
    ],
    ["the full canonical tuple", canonicalNextProxyHeaders],
  ])(
    "accepts the explicit Compose authority with %s",
    async (_label, forwardingHeaders) => {
      const { app } = productionRuntime(composeStartup);
      const read = await apiRequest(app, composeAuthority, "/api/settings", {
        headers: forwardingHeaders,
      });
      expect(read.status).toBe(200);
      expect(
        (await saveSettings(app, composeAuthority, forwardingHeaders)).status,
      ).toBe(200);
    },
  );

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "172.18.0.1"])(
    "accepts one private Compose proxy address %s",
    async (forwardedFor) => {
      const { app } = productionRuntime(composeStartup);
      const response = await mutation(app, composeAuthority, {
        ...canonicalNextProxyHeaders,
        "X-Forwarded-For": forwardedFor,
      });
      expect(response.status).toBe(404);
    },
  );

  it("rejects missing and incomplete Compose forwarding", async () => {
    const { app } = productionRuntime(composeStartup);
    const absent = await apiRequest(app, composeAuthority, "/api/settings");
    expect(absent.status).toBe(400);

    const mixed = await apiRequest(app, composeAuthority, "/api/settings", {
      headers: {
        "X-Forwarded-For": "127.0.0.1",
        "X-Forwarded-Host": "127.0.0.1:3000",
      },
    });
    expect(mixed.status).toBe(400);

    for (const name of Object.keys(canonicalNextProxyHeaders)) {
      const headers = new Headers(canonicalNextProxyHeaders);
      headers.delete(name);
      const incomplete = await apiRequest(
        app,
        composeAuthority,
        "/api/settings",
        { headers },
      );
      expect(incomplete.status).toBe(400);
      expect(await incomplete.json()).toEqual({
        error: "Forwarding headers are invalid",
      });
    }
  });

  it.each<[string, Record<string, string>]>([
    ["public client address", { "X-Forwarded-For": "203.0.113.10" }],
    [
      "multiple client addresses",
      { "X-Forwarded-For": "127.0.0.1, 203.0.113.10" },
    ],
    ["forwarded host", { "X-Forwarded-Host": "evil.example:3000" }],
    [
      "comma-joined forwarded host",
      { "X-Forwarded-Host": "127.0.0.1:3000, evil.example:3000" },
    ],
    ["forwarded port", { "X-Forwarded-Port": "8787" }],
    ["forwarded protocol", { "X-Forwarded-Proto": "https" }],
    ["standard Forwarded header", { Forwarded: "for=127.0.0.1" }],
    ["real-IP header", { "X-Real-IP": "127.0.0.1" }],
    ["extra forwarded header", { "X-Forwarded-Server": "proxy" }],
  ])("rejects spoofed Compose %s", async (_label, spoofedHeader) => {
    const { app } = productionRuntime(composeStartup);
    const response = await mutation(app, composeAuthority, {
      ...canonicalNextProxyHeaders,
      ...spoofedHeader,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Forwarding headers are invalid",
    });
  });

  it("rejects duplicated Compose forwarding headers", async () => {
    const { app } = productionRuntime(composeStartup);
    const headers = new Headers(canonicalNextProxyHeaders);
    headers.append("X-Forwarded-Host", "127.0.0.1:3000");
    const response = await apiRequest(app, composeAuthority, "/api/settings", {
      headers,
    });
    expect(response.status).toBe(400);
  });

  it("blocks wrong Compose internal authority for reads and mutations", async () => {
    const runtime = productionRuntime(composeStartup);
    const wrongAuthority = "attacker.example:8787";
    const beforeMutation = totalChanges(runtime);
    const forwardedHeaders = new Headers(canonicalNextProxyHeaders);
    forwardedHeaders.set("Host", wrongAuthority);

    const read = await runtime.app.request(
      `http://${wrongAuthority}/api/settings`,
      { headers: forwardedHeaders },
    );
    expect(read.status).toBe(400);
    expect(await read.json()).toEqual({
      error: "Request authority is invalid",
    });

    const mutationHeaders = new Headers(browserMutationHeaders);
    new Headers(canonicalNextProxyHeaders).forEach((value, name) =>
      mutationHeaders.set(name, value),
    );
    mutationHeaders.set("Host", wrongAuthority);
    const write = await runtime.app.request(
      `http://${wrongAuthority}/api/settings`,
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify(settingsMutation),
      },
    );
    expect(write.status).toBe(400);
    expect(totalChanges(runtime)).toBe(beforeMutation);
  });

  it("requires the exact browser mutation marker, Origin, and JSON media type", async () => {
    const { app } = productionRuntime();

    const accepted = await mutation(app);
    expect(accepted.status).toBe(404);
    expect(accepted.headers.get("Cache-Control")).toBe("no-store");

    const missingClient = await apiRequest(
      app,
      directAuthority,
      "/api/boundary-probe",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: webOrigin },
        body: "{}",
      },
    );
    expect(missingClient.status).toBe(403);

    expect(
      (
        await mutation(app, directAuthority, {
          "X-Aptiloop-Client": "desktop",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await mutation(app, directAuthority, {
          Origin: "http://localhost:3000",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await mutation(app, directAuthority, {
          Origin: "http://127.0.0.1:3001",
        })
      ).status,
    ).toBe(403);

    const missingOrigin = await apiRequest(
      app,
      directAuthority,
      "/api/boundary-probe",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Aptiloop-Client": "web",
        },
        body: "{}",
      },
    );
    expect(missingOrigin.status).toBe(403);
    expect(
      (
        await mutation(app, directAuthority, {
          "Content-Type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect(missingClient.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps authority-checked GETs and health requests functional", async () => {
    const { app } = productionRuntime();
    const settings = await apiRequest(app, directAuthority, "/api/settings", {
      headers: { Origin: "http://untrusted.example" },
    });
    expect(settings.status).toBe(200);
    expect(settings.headers.get("Cache-Control")).toBe("no-store");

    const health = await app.request("/health/ready");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      status: "ready",
      database: "connected",
    });
  });

  it("never uses Compose forwarding to replace browser inputs", async () => {
    const { app } = productionRuntime(composeStartup);
    const wrongOrigin = await mutation(app, composeAuthority, {
      ...canonicalNextProxyHeaders,
      Origin: "http://evil.example:3000",
    });
    expect(wrongOrigin.status).toBe(403);

    const missingClientHeaders = new Headers(canonicalNextProxyHeaders);
    missingClientHeaders.set("Content-Type", "application/json");
    missingClientHeaders.set("Origin", webOrigin);
    const missingClient = await apiRequest(
      app,
      composeAuthority,
      "/api/boundary-probe",
      {
        method: "POST",
        headers: missingClientHeaders,
        body: "{}",
      },
    );
    expect(missingClient.status).toBe(403);
  });
});

describe("legacy v1 learning freeze", () => {
  it("returns 410 before all three mutations and preserves historical reads", async () => {
    const runtime = productionRuntime();
    const beforeStart = totalChanges(runtime);
    const start = await apiRequest(
      runtime.app,
      directAuthority,
      "/api/learning/sessions",
      {
        method: "POST",
        headers: browserMutationHeaders,
        body: JSON.stringify({ dayNumber: 1 }),
      },
    );
    expect(start.status).toBe(410);
    expect(await start.json()).toEqual({
      error:
        "Legacy learning mutations are frozen; use /api/learning/sessions/v2",
    });
    expect(totalChanges(runtime)).toBe(beforeStart);

    const fixture = await runtime.state.repository.startSession({
      dayId: weekOneCurriculum.days[0]!.id,
      idempotencyKey: "legacy-read-fixture",
    });
    const sessionId = fixture.session.id;
    const questionId = fixture.questions[0]!.id;
    const beforeMutation = totalChanges(runtime);
    const sessionBefore = runtime.state.connection.sqlite
      .prepare(
        `SELECT status, current_step AS currentStep,
                completed_at AS completedAt, updated_at AS updatedAt
         FROM learning_sessions WHERE id = ?`,
      )
      .get(sessionId);

    const answer = await apiRequest(
      runtime.app,
      directAuthority,
      `/api/learning/sessions/${sessionId}/answers`,
      {
        method: "POST",
        headers: browserMutationHeaders,
        body: JSON.stringify({ questionId, answer: "must not persist" }),
      },
    );
    const complete = await apiRequest(
      runtime.app,
      directAuthority,
      `/api/learning/sessions/${sessionId}/complete`,
      {
        method: "POST",
        headers: browserMutationHeaders,
        body: "{}",
      },
    );
    expect(answer.status).toBe(410);
    expect(complete.status).toBe(410);
    expect(totalChanges(runtime)).toBe(beforeMutation);
    expect(
      runtime.state.connection.sqlite
        .prepare(
          `SELECT status, current_step AS currentStep,
                  completed_at AS completedAt, updated_at AS updatedAt
           FROM learning_sessions WHERE id = ?`,
        )
        .get(sessionId),
    ).toEqual(sessionBefore);

    const historical = await apiRequest(
      runtime.app,
      directAuthority,
      `/api/learning/sessions/${sessionId}`,
    );
    expect(historical.status).toBe(200);
    expect(await historical.json()).toMatchObject({
      id: sessionId,
      status: "active",
      question: { id: questionId },
    });
  });
});

describe("legacy session mutation reachability", () => {
  it("rejects migrated snapshots and shared exercise side effects before work", async () => {
    const runtime = productionRuntime();
    const day = runtime.state.connection.sqlite
      .prepare(
        `SELECT day.id
         FROM curriculum_days_v2 day
         JOIN curriculum_versions version ON version.id = day.version_id
         WHERE version.status = 'published' AND version.id != 'legacy-v1'
         ORDER BY version.revision DESC, day.order_index, day.id
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    if (!day) throw new Error("Missing versioned day fixture");

    const versioned =
      await runtime.state.repository.startOrResumeVersionedSession({
        dayId: day.id,
      });
    runtime.state.connection.sqlite.exec(`
      INSERT INTO curricula
        (id, slug, title, description, active_version_id, created_at, updated_at)
      VALUES
        ('legacy-curriculum', 'legacy-mutation-fixture', 'Legacy fixture',
         NULL, NULL, 1, 1);
      INSERT INTO curriculum_versions
        (id, curriculum_id, revision, parent_version_id, status, title,
         description, content_hash, created_at, published_at, archived_at,
         updated_at)
      VALUES
        ('legacy-v1', 'legacy-curriculum', 1, NULL, 'archived',
         'Legacy fixture', NULL, '${"a".repeat(64)}', 1, 1, 1, 1);
    `);
    const snapshotRow = runtime.state.connection.sqlite
      .prepare(
        "SELECT snapshot_json FROM session_snapshots WHERE session_id = ?",
      )
      .get(versioned.session.id) as { snapshot_json: string };
    const snapshot = JSON.parse(snapshotRow.snapshot_json) as Record<
      string,
      unknown
    >;
    snapshot.curriculumVersionId = "legacy-v1";
    runtime.state.connection.sqlite.exec(
      "DROP TRIGGER session_snapshots_immutable_update_guard",
    );
    runtime.state.connection.sqlite
      .prepare(
        `UPDATE session_snapshots
         SET curriculum_version_id = 'legacy-v1', snapshot_json = ?
         WHERE session_id = ?`,
      )
      .run(JSON.stringify(snapshot), versioned.session.id);

    const beforeVersionedMutation = totalChanges(runtime);
    const unitMutation = await apiRequest(
      runtime.app,
      directAuthority,
      `/api/learning/sessions/v2/${versioned.session.id}/units/${versioned.snapshot.units[0]!.id}`,
      {
        method: "PATCH",
        headers: browserMutationHeaders,
        body: "{}",
      },
    );
    expect(unitMutation.status).toBe(410);
    expect(await unitMutation.json()).toEqual(legacyLearningMutationError);
    expect(totalChanges(runtime)).toBe(beforeVersionedMutation);

    const versionedRead = await apiRequest(
      runtime.app,
      directAuthority,
      `/api/learning/sessions/v2/${versioned.session.id}`,
    );
    expect(versionedRead.status).toBe(400);

    runtime.state.connection.sqlite
      .prepare("UPDATE learning_sessions SET status = 'abandoned' WHERE id = ?")
      .run(versioned.session.id);
    const legacy = await runtime.state.repository.startSession({
      dayId: weekOneCurriculum.days[0]!.id,
      idempotencyKey: "legacy-shared-mutation-fixture",
    });
    const exercise = legacy.exercises[0]!;
    const legacyAttemptId = "legacy-attempt-fixture";
    runtime.state.connection.sqlite
      .prepare(
        `INSERT INTO exercise_attempts
         (id, session_id, exercise_id, status, workspace_path, baseline_path,
          baseline_hash, started_at, completed_at, updated_at)
         VALUES (?, ?, ?, 'active', 'untrusted', 'untrusted', 'untrusted',
                 1, NULL, 1)`,
      )
      .run(legacyAttemptId, legacy.session.id, exercise.id);

    const beforeSharedMutations = totalChanges(runtime);
    const sharedMutations = await Promise.all([
      apiRequest(
        runtime.app,
        directAuthority,
        `/api/exercises/${exercise.id}/attempts`,
        {
          method: "POST",
          headers: browserMutationHeaders,
          body: JSON.stringify({ sessionId: legacy.session.id }),
        },
      ),
      apiRequest(
        runtime.app,
        directAuthority,
        `/api/exercise-attempts/${legacyAttemptId}/checks`,
        {
          method: "POST",
          headers: browserMutationHeaders,
          body: "{}",
        },
      ),
      apiRequest(
        runtime.app,
        directAuthority,
        `/api/exercise-attempts/${legacyAttemptId}/reviews`,
        {
          method: "POST",
          headers: browserMutationHeaders,
          body: "{}",
        },
      ),
      apiRequest(
        runtime.app,
        directAuthority,
        `/api/exercise-attempts/${legacyAttemptId}/open`,
        {
          method: "POST",
          headers: browserMutationHeaders,
          body: "{}",
        },
      ),
    ]);
    for (const response of sharedMutations) {
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual(legacyLearningMutationError);
    }
    expect(totalChanges(runtime)).toBe(beforeSharedMutations);
  });
});
