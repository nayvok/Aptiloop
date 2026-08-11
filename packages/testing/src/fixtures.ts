import type {
  AgentEvent,
  AgentSession,
  ProviderStatus,
  ReviewResult,
} from "@aptiloop/shared";

type MessageDeltaEvent = Extract<
  AgentEvent,
  { readonly type: "message.delta" }
>;

const FIXED_TIME = "2026-07-31T12:00:00.000Z";

export const createProviderStatusFixture = (
  overrides: Partial<ProviderStatus> = {},
): ProviderStatus => ({
  providerId: "mock",
  state: "connected",
  checkedAt: FIXED_TIME,
  capabilities: ["streaming", "models", "structured-output", "cancellation"],
  ...overrides,
});

export const createAgentSessionFixture = (
  overrides: Partial<AgentSession> = {},
): AgentSession => ({
  id: "mock-session-1",
  providerId: "mock",
  role: "teacher",
  modelId: "mock-deterministic",
  status: "active",
  createdAt: FIXED_TIME,
  ...overrides,
});

export const createReviewResultFixture = (
  overrides: Partial<ReviewResult> = {},
): ReviewResult => ({
  status: "changes_requested",
  summary: "One edge case needs another attempt.",
  findings: [
    {
      severity: "warning",
      category: "edge_case",
      file: "src/solution.ts",
      line: 7,
      message: "Consider the empty-input case.",
      hintLevel: 1,
    },
  ],
  strengths: ["The main path is readable."],
  suggestedMasteryChanges: [],
  ...overrides,
});

export const createAgentEventFixture = (
  overrides: Partial<MessageDeltaEvent> = {},
): MessageDeltaEvent => ({
  type: "message.delta",
  sessionId: "mock-session-1",
  sequence: 0,
  timestamp: FIXED_TIME,
  delta: "Hello",
  ...overrides,
});

export const fixedTestClock = (): Date => new Date(FIXED_TIME);
