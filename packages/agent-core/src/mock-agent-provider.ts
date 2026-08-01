import {
  AgentSessionSchema,
  type AgentEvent,
  type AgentModel,
  type AgentRole,
  type AgentSession,
  type CreateAgentSessionInput,
  type ProviderStatus,
  type ReviewResult,
  type StreamAgentMessageInput,
} from "@dlh/shared";

import { createAgentEventNormalizer } from "./event-normalizer.js";
import { AgentProviderError, type AgentProvider } from "./provider.js";

export interface MockAgentProviderOptions {
  readonly chunkSize?: number;
  readonly now?: () => Date;
  readonly delayMs?: number;
}

const MOCK_REVIEW: ReviewResult = {
  status: "changes_requested",
  summary: "The solution is close, but one edge case needs another attempt.",
  findings: [
    {
      severity: "warning",
      category: "edge_case",
      file: "src/solution.ts",
      line: 7,
      message: "Consider what happens when the input collection is empty.",
      hintLevel: 1,
    },
  ],
  strengths: ["The main path is readable and keeps the input immutable."],
  suggestedMasteryChanges: [
    {
      topicId: "javascript-arrays",
      dimension: "implementation",
      delta: 0.25,
      reason: "The main transformation is correct.",
      evidence: "The submitted diff uses an immutable array operation.",
    },
  ],
};

const MOCK_PASSED_REVIEW: ReviewResult = {
  status: "passed",
  summary:
    "The correction cycle is complete and the tested learner change now meets the exercise contract.",
  findings: [],
  strengths: [
    "The learner reran the allowlisted tests after the correction.",
    "The implementation keeps the input immutable and covers the requested edge case.",
  ],
  suggestedMasteryChanges: [
    {
      topicId: "javascript-arrays",
      dimension: "debugging",
      delta: 0.25,
      reason: "A persisted correction cycle ended with a fresh passing test.",
      evidence:
        "The second read-only review follows a new successful test run.",
    },
  ],
};

const responseFor = (role: AgentRole, message: string): string => {
  if (role === "reviewer") {
    const hasPriorReview = /"priorReviewCount"\s*:\s*[1-9]\d*/u.test(message);
    return JSON.stringify(hasPriorReview ? MOCK_PASSED_REVIEW : MOCK_REVIEW);
  }
  if (role === "interviewer")
    return "In 60 seconds, explain how the JavaScript event loop orders microtasks and macrotasks.";
  if (role === "teacher")
    return "What is one concrete difference between a shallow copy and a deep copy?";
  if (role === "curator")
    return "Today we will revisit the weakest topic before adding one small new concept.";
  return `Mock ${role} response to: ${message}`;
};

const chunksOf = (value: string, size: number): string[] => {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size)
    chunks.push(value.slice(index, index + size));
  return chunks;
};

export class MockAgentProvider implements AgentProvider {
  readonly id = "mock" as const;
  readonly #sessions = new Map<string, AgentSession>();
  readonly #cancelled = new Set<string>();
  readonly #chunkSize: number;
  readonly #delayMs: number;
  readonly #now: () => Date;
  #sessionCounter = 0;

  constructor(options: MockAgentProviderOptions = {}) {
    this.#chunkSize = options.chunkSize ?? 12;
    this.#delayMs = options.delayMs ?? 0;
    this.#now = options.now ?? (() => new Date());
  }

  async getStatus(): Promise<ProviderStatus> {
    return {
      providerId: this.id,
      state: "connected",
      checkedAt: this.#now().toISOString(),
      capabilities: [
        "streaming",
        "models",
        "structured-output",
        "cancellation",
      ],
    };
  }

  async listModels(): Promise<AgentModel[]> {
    return [
      {
        id: "mock-deterministic",
        providerId: this.id,
        name: "Deterministic Mock",
        supportsStreaming: true,
        available: true,
      },
    ];
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSession> {
    if (input.modelId !== "mock-deterministic")
      throw new AgentProviderError(
        "model_unavailable",
        `Unknown mock model: ${input.modelId}`,
      );
    const session = AgentSessionSchema.parse({
      id: `mock-session-${++this.#sessionCounter}`,
      providerId: this.id,
      role: input.role,
      modelId: input.modelId,
      status: "active",
      createdAt: this.#now().toISOString(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    this.#sessions.set(session.id, session);
    return session;
  }

  async *streamMessage(
    input: StreamAgentMessageInput,
  ): AsyncIterable<AgentEvent> {
    const session = this.#sessions.get(input.sessionId);
    if (!session)
      throw new AgentProviderError(
        "session_not_found",
        `Unknown session: ${input.sessionId}`,
      );
    if (session.status !== "active") {
      throw new AgentProviderError(
        "invalid_input",
        `Mock session is ${session.status}`,
      );
    }
    const normalizer = createAgentEventNormalizer(session.id, {
      now: this.#now,
    });
    if (input.message.includes("[[error]]")) {
      yield normalizer.normalize({
        type: "error",
        code: "provider_error",
        message: "Deterministic mock failure",
      })[0]!;
      yield normalizer.normalize({
        type: "session.completed",
        reason: "failed",
      })[0]!;
      session.status = "failed";
      return;
    }
    const response = responseFor(session.role, input.message);
    for (const chunk of chunksOf(response, this.#chunkSize)) {
      if (this.#cancelled.has(session.id)) {
        yield normalizer.normalize({
          type: "session.completed",
          reason: "cancelled",
        })[0]!;
        return;
      }
      if (this.#delayMs > 0)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, this.#delayMs),
        );
      yield normalizer.normalize({ type: "message.delta", delta: chunk })[0]!;
    }
    yield normalizer.normalize({
      type: "message.completed",
      content: response,
    })[0]!;
    yield normalizer.normalize({
      type: "session.completed",
      reason: "completed",
    })[0]!;
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session)
      throw new AgentProviderError(
        "session_not_found",
        `Unknown session: ${sessionId}`,
      );
    this.#cancelled.add(sessionId);
    session.status = "cancelled";
  }
}

export const mockReviewResult: ReviewResult = MOCK_REVIEW;
