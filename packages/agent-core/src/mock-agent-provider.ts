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
} from "@aptiloop/shared";

import { createAgentEventNormalizer } from "./event-normalizer.js";
import { AgentProviderError, type AgentProvider } from "./provider.js";

export interface MockAgentProviderOptions {
  readonly chunkSize?: number;
  readonly now?: () => Date;
  readonly delayMs?: number;
}

const MOCK_REVIEW: ReviewResult = {
  status: "changes_requested",
  summary: "Решение близко, но один краевой случай требует ещё одной попытки.",
  findings: [
    {
      severity: "warning",
      category: "edge_case",
      file: "src/normalize-profile.ts",
      message: "Подумай, что произойдёт, если входная коллекция будет пустой.",
      hintLevel: 1,
    },
  ],
  strengths: [
    "Основной путь читаемый и сохраняет входные данные неизменяемыми.",
  ],
  suggestedMasteryChanges: [
    {
      topicId: "mutation",
      dimension: "implementation",
      delta: 0.25,
      reason: "Основное преобразование корректно.",
      evidence:
        "Отправленный diff использует неизменяемую операцию над массивом.",
    },
  ],
};

const MOCK_PASSED_REVIEW: ReviewResult = {
  status: "passed",
  summary:
    "Цикл исправлений завершён: протестированное изменение теперь соответствует контракту упражнения.",
  findings: [],
  strengths: [
    "Ученик повторно запустил разрешённые тесты после исправления.",
    "Реализация сохраняет входные данные неизменяемыми и покрывает запрошенный краевой случай.",
  ],
  suggestedMasteryChanges: [
    {
      topicId: "mutation",
      dimension: "debugging",
      delta: 0.25,
      reason:
        "Завершённый цикл исправлений закончился свежим прохождением тестов.",
      evidence:
        "Второй проход проверки решения следует за новым успешным запуском тестов.",
    },
  ],
};

const responseFor = (role: AgentRole, message: string): string => {
  if (role === "reviewer") {
    const hasPriorReview = /"priorReviewCount"\s*:\s*[1-9]\d*/u.test(message);
    return JSON.stringify(hasPriorReview ? MOCK_PASSED_REVIEW : MOCK_REVIEW);
  }
  if (role === "interviewer")
    return "За 60 секунд объясни, как event loop в JavaScript упорядочивает microtasks и macrotasks.";
  if (role === "teacher")
    return "В чём одно конкретное отличие поверхностного копирования (shallow copy) от глубокого (deep copy)?";
  if (role === "curator")
    return "Сегодня мы повторим самую слабую тему, а затем добавим один небольшой новый концепт.";
  return `Mock-ответ для роли ${role} на сообщение: ${message}`;
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

  async createSession(
    input: CreateAgentSessionInput,
    signal?: AbortSignal,
  ): Promise<AgentSession> {
    signal?.throwIfAborted();
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
