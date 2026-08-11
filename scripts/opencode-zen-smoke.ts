import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Hono } from "hono";

import { createApp } from "../apps/orchestrator/src/app.js";

const modelId = "deepseek-v4-flash-free";
const connectionId = "conn:pi:opencode-zen";
const syntheticMessage =
  "Synthetic Aptiloop provider smoke. Reply with ZEN_SMOKE_OK and do not call tools.";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

if (!process.env.OPENCODE_API_KEY) {
  throw new Error(
    "OPENCODE_API_KEY is required in the process environment or root .env",
  );
}

const request = (app: Hono, requestPath: string, init?: RequestInit) =>
  app.request(`http://127.0.0.1:8787${requestPath}`, {
    ...init,
    headers: {
      Host: "127.0.0.1:8787",
      "X-Aptiloop-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });

const requireOk = async (response: Response, label: string) => {
  if (response.ok) return response;
  await response.body?.cancel();
  throw new Error(`${label} failed with HTTP ${response.status}`);
};

const root = await mkdtemp(path.join(tmpdir(), "aptiloop-opencode-zen-smoke-"));
const runtime = createApp({
  projectRoot: process.cwd(),
  databasePath: path.join(root, "smoke.sqlite"),
  databaseMode: "disposable",
  developmentMode: false,
});

try {
  const settings = await runtime.state.providerRuntime.settings();
  const connection = settings.connections.find(
    (candidate) => candidate.connectionId === connectionId,
  );
  const model = connection?.observedCapabilities?.models.find(
    (candidate) => candidate.modelId === modelId,
  );
  if (!connection || connection.adapterId !== "opencode") {
    throw new Error("OpenCode Zen connection is not registered through Pi");
  }
  if (!model?.available) {
    throw new Error(`OpenCode Zen model ${modelId} is not available`);
  }

  await runtime.state.providerRuntime.saveRoleProfiles(
    settings.roleProfiles.map((profile) =>
      profile.role === "tutor"
        ? {
            role: profile.role,
            mode: "connection" as const,
            connectionId,
            modelId,
          }
        : {
            role: profile.role,
            mode: profile.mode,
            connectionId: profile.connectionId,
            modelId: profile.modelId,
          },
    ),
  );

  const day = runtime.state.connection.sqlite
    .prepare(
      `SELECT day.id
       FROM curriculum_days_v2 day
       JOIN curriculum_versions version ON version.id = day.version_id
       JOIN curricula curriculum ON curriculum.id = version.curriculum_id
       WHERE version.status = 'published'
         AND version.id = curriculum.active_version_id
       ORDER BY curriculum.id, day.order_index, day.id
       LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (!day) throw new Error("Seeded Course revision has no learning day");
  const session = await runtime.state.repository.startOrResumeVersionedSession({
    dayId: day.id,
    idempotencyKey: "opencode-zen-smoke-session",
  });

  const disclosureResponse = await requireOk(
    await request(runtime.app, "/api/ai/disclosures", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId: session.session.id,
        message: syntheticMessage,
      }),
    }),
    "Disclosure preparation",
  );
  const preparation = (await disclosureResponse.json()) as {
    required?: boolean;
    disclosure?: { operationId?: string };
  };
  const disclosureOperationId = preparation.disclosure?.operationId;
  if (!preparation.required || !disclosureOperationId) {
    throw new Error("External provider disclosure was not required");
  }
  await requireOk(
    await request(
      runtime.app,
      `/api/ai/disclosures/${encodeURIComponent(disclosureOperationId)}/approve`,
      { method: "POST", body: "{}" },
    ),
    "Disclosure approval",
  );

  const streamResponse = await requireOk(
    await request(runtime.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId: session.session.id,
        message: syntheticMessage,
        disclosureOperationId,
      }),
    }),
    "Provider turn",
  );
  const streamBody = await streamResponse.text();
  if (!streamBody.includes('"reason":"completed"')) {
    throw new Error("Provider turn did not complete successfully");
  }

  const provenance = runtime.state.connection.sqlite
    .prepare(
      `SELECT connection_id, provider_type, adapter_id, model_id, role, status,
              disclosure_operation_id
       FROM provider_turn_provenance
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get() as
    | {
        connection_id: string;
        provider_type: string;
        adapter_id: string;
        model_id: string;
        role: string;
        status: string;
        disclosure_operation_id: string | null;
      }
    | undefined;
  if (
    !provenance ||
    provenance.connection_id !== connectionId ||
    provenance.provider_type !== "opencode" ||
    provenance.adapter_id !== "opencode" ||
    provenance.model_id !== modelId ||
    provenance.role !== "tutor" ||
    provenance.status !== "completed" ||
    provenance.disclosure_operation_id !== disclosureOperationId
  ) {
    throw new Error("Persisted provider-turn provenance is incomplete");
  }

  const provider = runtime.state.providers.opencode;
  const cancellationSession = await provider.createSession({
    role: "reviewer",
    modelId,
    systemPrompt:
      "This is an Aptiloop cancellation smoke. Do not call tools. Produce a long numbered list.",
  });
  const cancellationStream = provider
    .streamMessage({
      sessionId: cancellationSession.id,
      message: "List integers from 1 through 5000, one per line.",
      responseFormat: "text",
    })
    [Symbol.asyncIterator]();
  const firstEvent = await cancellationStream.next();
  if (firstEvent.done) {
    throw new Error("Cancellation smoke ended before an authenticated event");
  }
  await provider.cancelSession(cancellationSession.id);
  const cancellationEvents = [firstEvent.value];
  for (;;) {
    const next = await cancellationStream.next();
    if (next.done) break;
    cancellationEvents.push(next.value);
  }
  if (
    !cancellationEvents.some(
      (event) =>
        event.type === "session.completed" && event.reason === "cancelled",
    )
  ) {
    throw new Error("Pi did not observe the OpenCode Zen cancellation");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        provider: "OpenCode Zen via constrained Pi",
        modelId,
        authenticatedTurn: "completed",
        disclosure: "approved-and-consumed",
        provenance: "persisted",
        cancellation: "observed",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await runtime.close();
  await rm(root, { recursive: true, force: true });
}
