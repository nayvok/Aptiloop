import type {
  AgentEvent,
  AgentErrorCode,
  AgentModel,
  AgentSession,
  CreateAgentSessionInput,
  ProviderId,
  ProviderStatus,
  StreamAgentMessageInput,
} from "@aptiloop/shared";

export interface AgentProvider {
  readonly id: ProviderId;
  getStatus(signal?: AbortSignal): Promise<ProviderStatus>;
  listModels(signal?: AbortSignal): Promise<AgentModel[]>;
  createSession(input: CreateAgentSessionInput): Promise<AgentSession>;
  streamMessage(input: StreamAgentMessageInput): AsyncIterable<AgentEvent>;
  cancelSession(sessionId: string): Promise<void>;
}

export class AgentProviderError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable: boolean;

  constructor(
    code: AgentErrorCode,
    message: string,
    retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}
