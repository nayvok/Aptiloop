import {
  createOpencodeClient,
  type Event,
  type Message,
  type OpencodeClient,
  type Part,
  type Provider,
} from "@opencode-ai/sdk/v2";

import type { OpenCodeConnectionConfig } from "./config.js";

export interface OpenCodeHealth {
  readonly healthy: true;
  readonly version: string;
}

export interface OpenCodeModelRecord {
  readonly id: string;
  readonly name: string;
  readonly providerID: string;
  readonly capabilities: {
    readonly attachment: boolean;
    readonly reasoning: boolean;
    readonly temperature: boolean;
    readonly toolcall: boolean;
  };
}

export interface OpenCodeProviderRecord {
  readonly id: string;
  readonly name: string;
  readonly models: ReadonlyArray<OpenCodeModelRecord>;
}

export interface OpenCodeProviderSnapshot {
  readonly providers: ReadonlyArray<OpenCodeProviderRecord>;
  readonly connectedProviderIDs: ReadonlySet<string>;
  readonly defaults: Readonly<Record<string, string>>;
}

export interface OpenCodeSessionRecord {
  readonly id: string;
}

export interface OpenCodeMessageRecord {
  readonly id: string;
  readonly sessionID: string;
  readonly role: "user" | "assistant";
  readonly error?: unknown;
  readonly structured?: unknown;
  readonly parts: ReadonlyArray<Part>;
}

export interface CreateOpenCodeSessionInput {
  readonly directory: string;
  readonly title?: string;
  readonly permission?: ReadonlyArray<{
    readonly permission: string;
    readonly pattern: string;
    readonly action: "allow" | "ask" | "deny";
  }>;
}

export interface PromptOpenCodeSessionInput {
  readonly sessionID: string;
  readonly directory: string;
  readonly providerID: string;
  readonly modelID: string;
  readonly prompt: string;
  readonly responseFormat: "text" | "json";
  readonly system?: string;
  readonly agent?: string;
  readonly tools?: Readonly<Record<string, boolean>>;
}

export interface OpenCodeTransport {
  health(signal?: AbortSignal): Promise<OpenCodeHealth>;
  listProviders(
    directory: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeProviderSnapshot>;
  createSession(
    input: CreateOpenCodeSessionInput,
    signal?: AbortSignal,
  ): Promise<OpenCodeSessionRecord>;
  promptAsync(
    input: PromptOpenCodeSessionInput,
    signal?: AbortSignal,
  ): Promise<void>;
  subscribe(
    directory: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Event>>;
  getMessage(
    sessionID: string,
    messageID: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeMessageRecord>;
  listMessages(
    sessionID: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<OpenCodeMessageRecord>>;
  abortSession(
    sessionID: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<void>;
}

export class OpenCodeTransportError extends Error {
  public readonly operation: string;

  public constructor(operation: string, cause?: unknown) {
    super(`OpenCode request failed: ${operation}`, { cause });
    this.name = "OpenCodeTransportError";
    this.operation = operation;
  }
}

function unwrap<T>(
  operation: string,
  result:
    | { readonly data: T; readonly error: undefined }
    | { readonly data: undefined; readonly error: unknown },
): T {
  if (result.error !== undefined || result.data === undefined) {
    throw new OpenCodeTransportError(operation, result.error);
  }

  return result.data;
}

function requestOptions(signal?: AbortSignal): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function mapProvider(provider: Provider): OpenCodeProviderRecord {
  return {
    id: provider.id,
    name: provider.name,
    models: Object.values(provider.models).map((model) => ({
      id: model.id,
      name: model.name,
      providerID: provider.id,
      capabilities: {
        attachment: model.capabilities.attachment,
        reasoning: model.capabilities.reasoning,
        temperature: model.capabilities.temperature,
        toolcall: model.capabilities.toolcall,
      },
    })),
  };
}

function mapMessage(message: {
  readonly info: Message;
  readonly parts: ReadonlyArray<Part>;
}): OpenCodeMessageRecord {
  return {
    id: message.info.id,
    sessionID: message.info.sessionID,
    role: message.info.role,
    ...(message.info.role === "assistant" && message.info.error !== undefined
      ? { error: message.info.error }
      : {}),
    ...(message.info.role === "assistant" &&
    message.info.structured !== undefined
      ? { structured: message.info.structured }
      : {}),
    parts: message.parts,
  };
}

export class SdkOpenCodeTransport implements OpenCodeTransport {
  readonly #client: OpencodeClient;

  public constructor(connection: OpenCodeConnectionConfig) {
    this.#client = createOpencodeClient({
      baseUrl: connection.endpoint,
      ...(connection.headers === undefined
        ? {}
        : { headers: connection.headers }),
    });
  }

  public async health(signal?: AbortSignal): Promise<OpenCodeHealth> {
    const result = await this.#client.global.health(requestOptions(signal));
    return unwrap("global.health", result);
  }

  public async listProviders(
    directory: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeProviderSnapshot> {
    const result = await this.#client.provider.list(
      { directory },
      requestOptions(signal),
    );
    const data = unwrap("provider.list", result);

    return {
      providers: data.all.map(mapProvider),
      connectedProviderIDs: new Set(data.connected),
      defaults: data.default,
    };
  }

  public async createSession(
    input: CreateOpenCodeSessionInput,
    signal?: AbortSignal,
  ): Promise<OpenCodeSessionRecord> {
    const result = await this.#client.session.create(
      {
        directory: input.directory,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.permission === undefined
          ? {}
          : { permission: input.permission.map((rule) => ({ ...rule })) }),
      },
      requestOptions(signal),
    );
    const session = unwrap("session.create", result);
    return { id: session.id };
  }

  public async promptAsync(
    input: PromptOpenCodeSessionInput,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.#client.session.promptAsync(
      {
        sessionID: input.sessionID,
        directory: input.directory,
        model: {
          providerID: input.providerID,
          modelID: input.modelID,
        },
        parts: [{ type: "text", text: input.prompt }],
        format:
          input.responseFormat === "json"
            ? { type: "json_schema", schema: {} }
            : { type: "text" },
        ...(input.system === undefined ? {} : { system: input.system }),
        ...(input.agent === undefined ? {} : { agent: input.agent }),
        ...(input.tools === undefined ? {} : { tools: { ...input.tools } }),
      },
      requestOptions(signal),
    );

    if (result.error !== undefined) {
      throw new OpenCodeTransportError("session.promptAsync", result.error);
    }
  }

  public async subscribe(
    directory: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Event>> {
    const result = await this.#client.event.subscribe(
      { directory },
      { signal, sseMaxRetryAttempts: 0 },
    );
    return result.stream;
  }

  public async getMessage(
    sessionID: string,
    messageID: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeMessageRecord> {
    const result = await this.#client.session.message(
      { sessionID, messageID, directory },
      requestOptions(signal),
    );
    return mapMessage(unwrap("session.message", result));
  }

  public async listMessages(
    sessionID: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<OpenCodeMessageRecord>> {
    const result = await this.#client.session.messages(
      { sessionID, directory },
      requestOptions(signal),
    );
    return unwrap("session.messages", result).map(mapMessage);
  }

  public async abortSession(
    sessionID: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.#client.session.abort(
      { sessionID, directory },
      requestOptions(signal),
    );
    unwrap("session.abort", result);
  }
}
