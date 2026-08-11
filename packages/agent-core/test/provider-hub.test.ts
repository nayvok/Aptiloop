import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  AgentEvent,
  AgentModel,
  AgentSession,
  ProviderConnection,
  ProviderStatus,
  RoleProfile,
} from "@aptiloop/shared";

import {
  CORE_TOOL_POLICIES,
  AptiloopTypedToolHost,
} from "../src/typed-tool-host.js";
import { ProviderHub, ProviderHubError } from "../src/provider-hub.js";
import type { AgentProvider } from "../src/provider.js";

const now = "2026-08-10T12:00:00.000Z";
const payloadSha256 = `sha256:${"a".repeat(64)}`;

function provider(
  options: {
    status?: ProviderStatus;
    models?: AgentModel[];
  } = {},
): AgentProvider {
  const status: ProviderStatus = options.status ?? {
    providerId: "codex",
    state: "connected",
    checkedAt: now,
    capabilities: ["streaming", "models", "tools", "cancellation"],
  };
  const defaultModels: AgentModel[] = [
    {
      id: "gpt-5.4",
      providerId: "codex",
      name: "GPT-5.4",
      supportsStreaming: true,
      available: true,
    },
  ];
  return {
    id: "codex",
    getStatus: vi.fn(async () => status),
    listModels: vi.fn(async () => options.models ?? defaultModels),
    createSession: vi.fn(async () => ({}) as AgentSession),
    streamMessage: vi.fn(async function* (): AsyncIterable<AgentEvent> {
      yield* [];
    }),
    cancelSession: vi.fn(async () => undefined),
  };
}

function connection(
  overrides: Partial<ProviderConnection> = {},
): ProviderConnection {
  return {
    connectionId: "conn:codex",
    adapterId: "codex",
    providerType: "openai",
    displayName: "OpenAI through Codex",
    credentialRef: null,
    endpointProfileId: null,
    enabled: true,
    external: true,
    state: "connected",
    observedCapabilities: null,
    lastCheckedAt: now,
    ...overrides,
  };
}

function profile(overrides: Partial<RoleProfile> = {}): RoleProfile {
  return {
    role: "reviewer",
    mode: "connection",
    connectionId: "conn:codex",
    modelId: "gpt-5.4",
    requiredCapabilities: ["streaming", "tools", "cancellation"],
    toolPolicyId: "apt.role.reviewer.v1",
    budgets: {
      maxInputBytes: 100_000,
      maxOutputBytes: 50_000,
      maxEvents: 1_000,
      maxToolCalls: 2,
      deadlineMs: 30_000,
    },
    ...overrides,
  };
}

function hub(
  providerInstance = provider(),
  profileOverrides: Partial<RoleProfile> = {},
) {
  return new ProviderHub({
    providers: { codex: providerInstance },
    connections: [connection()],
    roleProfiles: [profile(profileOverrides)],
    toolPolicies: CORE_TOOL_POLICIES,
    now: () => new Date(now),
  });
}

describe("ProviderHub", () => {
  it("requires exact explicit disclosure for an external provider turn", async () => {
    const target = hub();

    await expect(
      target.resolveTurn({ role: "reviewer" }),
    ).rejects.toMatchObject({
      failure: { code: "disclosure_required" },
    });

    const disclosure = {
      operationId: "disclosure:review:1",
      scope: {
        role: "reviewer" as const,
        connectionId: "conn:codex",
        providerType: "openai",
        modelId: "gpt-5.4",
        destination: "OpenAI API",
        payloadCategories: ["review-bundle" as const],
        entityIds: { attempt: "attempt:1" },
        exclusions: ["credentials", "protected answers"],
        byteCount: 1200,
        payloadSha256,
      },
      status: "approved" as const,
      createdAt: "2026-08-10T11:55:00.000Z",
      approvedAt: "2026-08-10T11:56:00.000Z",
      consumedAt: null,
      expiresAt: "2026-08-10T12:05:00.000Z",
    };

    await expect(
      target.resolveTurn({
        role: "reviewer",
        payloadSha256: `sha256:${"b".repeat(64)}`,
        disclosure,
      }),
    ).rejects.toMatchObject({
      failure: { code: "disclosure_mismatch" },
    });

    await expect(
      target.resolveTurn({ role: "reviewer", payloadSha256, disclosure }),
    ).resolves.toMatchObject({
      connection: { connectionId: "conn:codex" },
      modelId: "gpt-5.4",
      toolPolicy: { role: "reviewer" },
    });
  });

  it("fails explicitly when the configured model is unavailable", async () => {
    const target = hub(provider({ models: [] }));
    const disclosure = {
      operationId: "disclosure:review:2",
      scope: {
        role: "reviewer" as const,
        connectionId: "conn:codex",
        providerType: "openai",
        modelId: "gpt-5.4",
        destination: "OpenAI API",
        payloadCategories: ["review-bundle" as const],
        entityIds: { attempt: "attempt:2" },
        exclusions: [],
        byteCount: 100,
        payloadSha256,
      },
      status: "approved" as const,
      createdAt: "2026-08-10T11:55:00.000Z",
      approvedAt: "2026-08-10T11:56:00.000Z",
      consumedAt: null,
      expiresAt: "2026-08-10T12:05:00.000Z",
    };

    await expect(
      target.resolveTurn({ role: "reviewer", payloadSha256, disclosure }),
    ).rejects.toMatchObject({
      failure: { code: "model_unavailable" },
    });
  });

  it("uses structured failure codes for disabled AI", () => {
    const target = hub(provider(), {
      mode: "no-ai",
      connectionId: null,
      modelId: null,
    });

    expect(() => target.inspect("reviewer")).toThrow(ProviderHubError);
    try {
      target.inspect("reviewer");
    } catch (error) {
      expect((error as ProviderHubError).failure.code).toBe("ai_disabled");
    }
  });
});

describe("AptiloopTypedToolHost", () => {
  it.each([
    [
      "course-designer",
      "apt.role.course-designer.v2",
      [
        "course.readDraftSlice",
        "course.readApprovedSources",
        "course.proposeDraftPatch",
        "knowledge.readCapsule",
      ],
    ],
    [
      "tutor",
      "apt.role.tutor.v1",
      [
        "lesson.readLearnerSafeContext",
        "lesson.submitTutorMessage",
        "knowledge.readSnapshotSlice",
      ],
    ],
    [
      "evaluator",
      "apt.role.evaluator.v1",
      ["evaluation.readAttemptBundle", "evaluation.submitTypedResult"],
    ],
    [
      "reviewer",
      "apt.role.reviewer.v1",
      ["review.readBundle", "review.submitResult"],
    ],
  ] as const)(
    "exposes only the finite %s role tool matrix",
    (role, toolPolicyId, allowedTools) => {
      const policy = CORE_TOOL_POLICIES.find(
        (candidate) => candidate.role === role,
      );
      expect(policy).toEqual({ role, toolPolicyId, allowedTools });
      expect(policy?.allowedTools).not.toContain("bash");
      expect(policy?.allowedTools).not.toContain("read");
      expect(policy?.allowedTools).not.toContain("write");
      expect(policy?.allowedTools).not.toContain("edit");
      expect(policy?.allowedTools).not.toContain("network");
    },
  );

  it("enforces role allowlists and strict input/output schemas", async () => {
    const tool = {
      name: "review.readBundle" as const,
      input: z.object({ bundleId: z.string().min(1) }).strict(),
      output: z.object({ evidence: z.string() }).strict(),
      execute: vi.fn(async ({ bundleId }: { bundleId: string }) => ({
        evidence: `evidence:${bundleId}`,
      })),
    };
    const host = new AptiloopTypedToolHost([tool], CORE_TOOL_POLICIES);

    await expect(
      host.execute({
        role: "reviewer",
        toolPolicyId: "apt.role.reviewer.v1",
        toolName: "review.readBundle",
        arguments: { bundleId: "bundle:1", unexpected: true },
        context: { operationId: "operation:1", role: "reviewer" },
      }),
    ).rejects.toMatchObject({ failure: { code: "invalid_output" } });
    expect(tool.execute).not.toHaveBeenCalled();

    await expect(
      host.execute({
        role: "tutor",
        toolPolicyId: "apt.role.tutor.v1",
        toolName: "review.readBundle",
        arguments: { bundleId: "bundle:1" },
        context: { operationId: "operation:1", role: "tutor" },
      }),
    ).rejects.toMatchObject({
      failure: { code: "tool_policy_unavailable" },
    });

    await expect(
      host.execute({
        role: "reviewer",
        toolPolicyId: "apt.role.reviewer.v1",
        toolName: "review.readBundle",
        arguments: { bundleId: "bundle:1" },
        context: { operationId: "operation:1", role: "reviewer" },
      }),
    ).resolves.toEqual({ evidence: "evidence:bundle:1" });
  });
});
