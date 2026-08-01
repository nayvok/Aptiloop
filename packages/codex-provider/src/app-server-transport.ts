import { spawn as nodeSpawn } from "node:child_process";
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithStdioTuple,
} from "node:child_process";

import {
  CodexTransportError,
  type CodexAccountResponse,
  type CodexModel,
  type CodexModelListResponse,
  type CodexNotification,
  type CodexThreadResponse,
  type CodexTransport,
  type CodexTurnResponse,
  type InterruptTurnParams,
  type NotificationListener,
  type ResumeThreadParams,
  type StartThreadParams,
  type StartTurnParams,
} from "./protocol.js";
import { redactSensitiveText, safeToolStatus } from "./sanitization.js";

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<"pipe", "pipe", "pipe">,
) => ChildProcessWithoutNullStreams;

interface RpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

const MAX_JSONL_LINE_BYTES = 1024 * 1024;

export interface CodexAppServerOptions {
  command?: string;
  cwd?: string;
  requestTimeoutMs?: number;
  spawn?: SpawnProcess;
}

/** A deliberately narrow client: raw app-server RPC never crosses this boundary. */
export class CodexAppServerTransport implements CodexTransport {
  readonly #command: string;
  readonly #cwd: string | undefined;
  readonly #requestTimeoutMs: number;
  readonly #spawn: SpawnProcess;
  readonly #listeners = new Set<NotificationListener>();
  readonly #pending = new Map<number, PendingRequest>();

  #child: ChildProcessWithoutNullStreams | undefined;
  #connectPromise: Promise<void> | undefined;
  #nextId = 1;
  #stdoutBuffer = "";
  #stdoutBufferBytes = 0;
  #closed = false;
  #failed = false;

  constructor(options: CodexAppServerOptions = {}) {
    this.#command = options.command ?? "codex";
    this.#cwd = options.cwd;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.#spawn = options.spawn ?? nodeSpawn;
  }

  async connect(): Promise<void> {
    if (this.#closed) {
      throw new CodexTransportError(
        "closed",
        "Codex transport is already shut down",
      );
    }
    this.#connectPromise ??= this.#startAndInitialize();
    return this.#connectPromise;
  }

  async readAccount(): Promise<CodexAccountResponse> {
    await this.connect();
    const result = await this.#request("account/read", { refreshToken: false });
    if (!isRecord(result) || typeof result.requiresOpenaiAuth !== "boolean") {
      throw new CodexTransportError(
        "protocol",
        "Codex returned an invalid account/read response",
      );
    }
    return {
      account: result.account ?? null,
      requiresOpenaiAuth: result.requiresOpenaiAuth,
    };
  }

  async listModels(): Promise<CodexModel[]> {
    await this.connect();
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const result = await this.#request("model/list", {
        cursor,
        includeHidden: false,
      });
      const page = parseModelPage(result);
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return models;
  }

  async startThread(params: StartThreadParams): Promise<CodexThreadResponse> {
    await this.connect();
    return parseThreadResponse(await this.#request("thread/start", params));
  }

  async resumeThread(params: ResumeThreadParams): Promise<CodexThreadResponse> {
    await this.connect();
    return parseThreadResponse(await this.#request("thread/resume", params));
  }

  async startTurn(params: StartTurnParams): Promise<CodexTurnResponse> {
    await this.connect();
    const result = await this.#request("turn/start", params);
    if (
      !isRecord(result) ||
      !isRecord(result.turn) ||
      typeof result.turn.id !== "string"
    ) {
      throw new CodexTransportError(
        "protocol",
        "Codex returned an invalid turn/start response",
      );
    }
    return { turn: { ...result.turn, id: result.turn.id } };
  }

  async interruptTurn(params: InterruptTurnParams): Promise<void> {
    await this.connect();
    await this.#request("turn/interrupt", params);
  }

  subscribe(listener: NotificationListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const child = this.#child;
    this.#child = undefined;
    this.#rejectPending(
      new CodexTransportError("closed", "Codex transport was shut down"),
    );
    if (!child || child.exitCode !== null) return;

    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1_000);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async #startAndInitialize(): Promise<void> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.#spawn(
        this.#command,
        ["app-server", "--listen", "stdio://"],
        {
          cwd: this.#cwd,
          env: process.env,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (error) {
      throw unavailableError(this.#command, error);
    }
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#onStdout(chunk));
    // Drain diagnostics so the process cannot block, but never surface them: they may
    // contain local paths or authentication details.
    child.stderr.resume();
    child.once("error", (error) => {
      this.#fail(unavailableError(this.#command, error));
    });
    child.once("exit", (code, signal) => {
      if (this.#closed) return;
      this.#fail(
        new CodexTransportError(
          "unavailable",
          `Codex app-server exited (${signal ?? String(code)})`,
        ),
      );
    });

    try {
      await this.#request("initialize", {
        clientInfo: {
          name: "dev-learning-harness",
          title: "Dev Learning Harness",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: false },
      });
      this.#notify("initialized");
    } catch (error) {
      if (error instanceof CodexTransportError) throw error;
      throw new CodexTransportError(
        "misconfigured",
        "Codex app-server initialization failed",
        {
          cause: error,
        },
      );
    }
  }

  #request(method: string, params: object): Promise<unknown> {
    const child = this.#child;
    if (!child || child.stdin.destroyed) {
      return Promise.reject(
        new CodexTransportError(
          "unavailable",
          "Codex app-server is not running",
        ),
      );
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new CodexTransportError(
            "unavailable",
            `Codex RPC timed out: ${method}`,
          ),
        );
      }, this.#requestTimeoutMs);
      timeout.unref();
      this.#pending.set(id, { resolve, reject, timeout });
      child.stdin.write(
        `${JSON.stringify({ id, method, params })}\n`,
        (error) => {
          if (!error) return;
          const request = this.#pending.get(id);
          if (!request) return;
          this.#pending.delete(id);
          clearTimeout(request.timeout);
          request.reject(
            new CodexTransportError(
              "unavailable",
              "Could not write to Codex app-server",
              { cause: error },
            ),
          );
        },
      );
    });
  }

  #notify(method: "initialized"): void {
    this.#child?.stdin.write(`${JSON.stringify({ method })}\n`);
  }

  #onStdout(chunk: string): void {
    if (this.#failed || this.#closed) return;
    let offset = 0;
    let newline = chunk.indexOf("\n", offset);
    while (newline >= 0) {
      if (!this.#appendStdout(chunk.slice(offset, newline))) return;
      const line = this.#stdoutBuffer.trim();
      this.#stdoutBuffer = "";
      this.#stdoutBufferBytes = 0;
      if (line) this.#handleLine(line);
      if (this.#failed || this.#closed) return;
      offset = newline + 1;
      newline = chunk.indexOf("\n", offset);
    }
    this.#appendStdout(chunk.slice(offset));
  }

  #appendStdout(value: string): boolean {
    const valueBytes = Buffer.byteLength(value, "utf8");
    if (this.#stdoutBufferBytes + valueBytes > MAX_JSONL_LINE_BYTES) {
      this.#stdoutBuffer = "";
      this.#stdoutBufferBytes = 0;
      this.#fail(
        new CodexTransportError(
          "protocol",
          "Codex app-server response exceeded the safe size limit",
        ),
      );
      return false;
    }
    this.#stdoutBuffer += value;
    this.#stdoutBufferBytes += valueBytes;
    return true;
  }

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) return;

    if (
      (typeof message.id === "number" || typeof message.id === "string") &&
      typeof message.method === "string"
    ) {
      // The harness never grants app-server initiated tools, writes, prompts, or approvals.
      this.#child?.stdin.write(
        `${JSON.stringify({
          id: message.id,
          error: {
            code: -32601,
            message: `Client method is not available: ${message.method}`,
          },
        })}\n`,
      );
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (isRpcError(message.error)) {
        pending.reject(
          new CodexTransportError(
            "protocol",
            `Codex RPC request failed (${message.error.code})`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string" && isRecord(message.params)) {
      const notification = sanitizeNotification(message.method, message.params);
      if (!notification) return;
      for (const listener of this.#listeners) listener(notification);
    }
  }

  #rejectPending(error: Error): void {
    for (const request of this.#pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.#pending.clear();
  }

  #fail(error: Error): void {
    if (this.#failed || this.#closed) return;
    this.#failed = true;
    this.#rejectPending(error);
    const child = this.#child;
    if (child && child.exitCode === null && !child.killed) child.kill();
    const notification: CodexNotification = {
      method: "transport/error",
      params: { message: "Codex app-server became unavailable" },
    };
    for (const listener of this.#listeners) listener(notification);
  }
}

function sanitizeNotification(
  method: string,
  params: Record<string, unknown>,
): CodexNotification | undefined {
  const identifiers = notificationIdentifiers(params);

  if (method === "item/agentMessage/delta") {
    if (typeof params.delta !== "string") return undefined;
    return {
      method,
      params: {
        ...identifiers,
        delta: redactSensitiveText(params.delta),
      },
    };
  }

  if (
    (method === "item/started" || method === "item/completed") &&
    isRecord(params.item)
  ) {
    const item = sanitizeItem(params.item);
    if (!item) return undefined;
    return { method, params: { ...identifiers, item } };
  }

  if (method === "turn/completed" && isRecord(params.turn)) {
    const id = safeProtocolId(params.turn.id);
    const status = safeTurnStatus(params.turn.status);
    if (!id || !status) return undefined;
    return {
      method,
      params: {
        ...identifiers,
        turn: {
          id,
          status,
          ...(status === "failed" ? { error: {} } : {}),
        },
      },
    };
  }

  if (method === "error") {
    return {
      method,
      params: {
        ...identifiers,
        error: {},
        willRetry: params.willRetry === true,
      },
    };
  }

  return undefined;
}

function sanitizeItem(
  item: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const id = safeProtocolId(item.id);
  if (!id || typeof item.type !== "string") return undefined;

  if (item.type === "agentMessage") {
    if (typeof item.text !== "string") return undefined;
    return { id, type: item.type, text: redactSensitiveText(item.text) };
  }

  const status = safeToolStatus(item.status);
  switch (item.type) {
    case "commandExecution":
      return {
        id,
        type: item.type,
        status,
        ...(typeof item.exitCode === "number" &&
        Number.isSafeInteger(item.exitCode)
          ? { exitCode: item.exitCode }
          : {}),
      };
    case "fileChange":
    case "mcpToolCall":
      return { id, type: item.type, status };
    case "dynamicToolCall":
      return {
        id,
        type: item.type,
        status,
        ...(typeof item.success === "boolean" ? { success: item.success } : {}),
      };
    default:
      return undefined;
  }
}

function notificationIdentifiers(
  params: Record<string, unknown>,
): Record<string, string> {
  const identifiers: Record<string, string> = {};
  for (const key of ["threadId", "turnId", "itemId"] as const) {
    const value = safeProtocolId(params[key]);
    if (value) identifiers[key] = value;
  }
  return identifiers;
}

function safeProtocolId(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : undefined;
}

function safeTurnStatus(value: unknown): string | undefined {
  return typeof value === "string" &&
    ["completed", "failed", "interrupted"].includes(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRpcError(value: unknown): value is RpcErrorShape {
  return (
    isRecord(value) &&
    typeof value.code === "number" &&
    typeof value.message === "string"
  );
}

function parseThreadResponse(value: unknown): CodexThreadResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.thread) ||
    typeof value.thread.id !== "string"
  ) {
    throw new CodexTransportError(
      "protocol",
      "Codex returned an invalid thread response",
    );
  }
  return { thread: { ...value.thread, id: value.thread.id } };
}

function parseModelPage(value: unknown): CodexModelListResponse {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new CodexTransportError(
      "protocol",
      "Codex returned an invalid model/list response",
    );
  }
  const data = value.data.filter(isCodexModel);
  if (data.length !== value.data.length) {
    throw new CodexTransportError(
      "protocol",
      "Codex returned an invalid model entry",
    );
  }
  return {
    data,
    nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : null,
  };
}

function isCodexModel(value: unknown): value is CodexModel {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.model === "string" &&
    typeof value.displayName === "string" &&
    typeof value.description === "string" &&
    typeof value.hidden === "boolean" &&
    typeof value.isDefault === "boolean"
  );
}

function unavailableError(
  _command: string,
  _error: unknown,
): CodexTransportError {
  return new CodexTransportError(
    "unavailable",
    "Could not start Codex app-server",
  );
}
