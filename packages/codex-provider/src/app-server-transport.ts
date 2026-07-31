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
  #closed = false;

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
    this.#stdoutBuffer += chunk;
    let newline = this.#stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#stdoutBuffer.slice(0, newline).trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (line) this.#handleLine(line);
      newline = this.#stdoutBuffer.indexOf("\n");
    }
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
            `Codex RPC error ${message.error.code}: ${message.error.message}`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string" && isRecord(message.params)) {
      const notification: CodexNotification = {
        method: message.method,
        params: message.params,
      };
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
    this.#rejectPending(error);
    const notification: CodexNotification = {
      method: "transport/error",
      params: { message: "Codex app-server became unavailable" },
    };
    for (const listener of this.#listeners) listener(notification);
  }
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
  command: string,
  error: unknown,
): CodexTransportError {
  const detail = error instanceof Error ? error.message : String(error);
  return new CodexTransportError(
    "unavailable",
    `Could not start ${command}: ${detail}`,
    { cause: error },
  );
}
