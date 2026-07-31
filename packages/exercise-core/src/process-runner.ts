import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import {
  assertSafeEnvironmentName,
  createSanitizedChildEnvironment,
} from "./child-environment.js";

export interface AllowedProcessDefinition {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface RunAllowedProcessOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal;
}

export type ProcessTerminationReason =
  "exit" | "timeout" | "cancelled" | "output_limit" | "spawn_error";

export interface ProcessResult {
  readonly commandId: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly terminationReason: ProcessTerminationReason;
  readonly truncated: boolean;
}

export interface ProcessRunnerOptions {
  readonly defaultTimeoutMs?: number;
  readonly defaultMaxOutputBytes?: number;
  /** Source environment to sanitize. Defaults to process.env. */
  readonly baseEnv?: Readonly<NodeJS.ProcessEnv>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

export class AllowedProcessRunner {
  readonly #commands: ReadonlyMap<string, Readonly<AllowedProcessDefinition>>;
  readonly #defaultTimeoutMs: number;
  readonly #defaultMaxOutputBytes: number;
  readonly #baseEnv: Readonly<NodeJS.ProcessEnv>;

  constructor(
    commands: Readonly<Record<string, AllowedProcessDefinition>>,
    options: ProcessRunnerOptions = {},
  ) {
    this.#defaultTimeoutMs = positiveInteger(
      options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      "defaultTimeoutMs",
    );
    this.#defaultMaxOutputBytes = positiveInteger(
      options.defaultMaxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      "defaultMaxOutputBytes",
    );
    this.#baseEnv = Object.freeze(
      createSanitizedChildEnvironment(
        options.baseEnv === undefined ? {} : { source: options.baseEnv },
      ),
    );

    const entries = Object.entries(commands).map(([id, command]) => {
      if (!/^[a-z][a-z0-9:_-]*$/u.test(id))
        throw new TypeError(`Invalid command id: ${id}`);
      validateProcessToken(command.executable, "executable");
      command.args.forEach((argument) =>
        validateProcessToken(argument, "argument"),
      );
      Object.keys(command.env ?? {}).forEach(assertSafeEnvironmentName);
      const frozen: Readonly<AllowedProcessDefinition> = Object.freeze({
        executable: command.executable,
        args: Object.freeze([...command.args]),
        ...(command.env === undefined
          ? {}
          : { env: Object.freeze({ ...command.env }) }),
        ...(command.timeoutMs === undefined
          ? {}
          : {
              timeoutMs: positiveInteger(command.timeoutMs, `${id}.timeoutMs`),
            }),
        ...(command.maxOutputBytes === undefined
          ? {}
          : {
              maxOutputBytes: positiveInteger(
                command.maxOutputBytes,
                `${id}.maxOutputBytes`,
              ),
            }),
      });
      return [id, frozen] as const;
    });
    this.#commands = new Map(entries);
  }

  listCommandIds(): readonly string[] {
    return Object.freeze([...this.#commands.keys()]);
  }

  async run(
    commandId: string,
    options: RunAllowedProcessOptions,
  ): Promise<ProcessResult> {
    const command = this.#commands.get(commandId);
    if (command === undefined)
      throw new Error(`Command is not allowlisted: ${commandId}`);
    if (!path.isAbsolute(options.cwd))
      throw new TypeError("Process cwd must be an absolute path.");

    const timeoutMs = command.timeoutMs ?? this.#defaultTimeoutMs;
    const maxOutputBytes =
      command.maxOutputBytes ?? this.#defaultMaxOutputBytes;
    const startedAt = performance.now();

    return await new Promise<ProcessResult>((resolve) => {
      let child!: ChildProcess;
      let settled = false;
      let terminationReason: ProcessTerminationReason = "exit";
      let truncated = false;
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      // eslint-disable-next-line prefer-const -- assigned after spawn so the synchronous catch can call finish safely.
      let timeout: NodeJS.Timeout | undefined;

      const finish = (
        exitCode: number | null,
        exitSignal: NodeJS.Signals | null,
      ): void => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", cancel);
        resolve({
          commandId,
          exitCode,
          signal: exitSignal,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          terminationReason,
          truncated,
        });
      };

      const terminate = (
        reason: Exclude<ProcessTerminationReason, "exit" | "spawn_error">,
      ): void => {
        if (settled || terminationReason !== "exit") return;
        terminationReason = reason;
        terminateProcessTree(child, "SIGTERM");
        const forceTimer = setTimeout(
          () => terminateProcessTree(child, "SIGKILL"),
          1_000,
        );
        forceTimer.unref();
      };

      const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
        const used = stdout.byteLength + stderr.byteLength;
        const remaining = Math.max(0, maxOutputBytes - used);
        const kept = chunk.subarray(0, remaining);
        if (target === "stdout") stdout = Buffer.concat([stdout, kept]);
        else stderr = Buffer.concat([stderr, kept]);
        if (kept.byteLength < chunk.byteLength) {
          truncated = true;
          terminate("output_limit");
        }
      };

      const cancel = (): void => terminate("cancelled");

      try {
        child = spawn(command.executable, [...command.args], {
          cwd: options.cwd,
          env: { ...this.#baseEnv, ...command.env },
          detached: process.platform !== "win32",
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        terminationReason = "spawn_error";
        stderr = Buffer.from(
          error instanceof Error ? error.message : String(error),
        );
        finish(null, null);
        return;
      }

      child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", (error) => {
        terminationReason = "spawn_error";
        stderr = Buffer.concat([stderr, Buffer.from(error.message)]).subarray(
          0,
          maxOutputBytes,
        );
        finish(null, null);
      });
      child.once("close", finish);

      timeout = setTimeout(() => terminate("timeout"), timeoutMs);
      timeout.unref();
      if (options.signal?.aborted === true) cancel();
      else options.signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive integer.`);
  return value;
}

function validateProcessToken(value: string, label: string): void {
  // eslint-disable-next-line no-control-regex -- process tokens explicitly reject NUL and line breaks.
  if (value.length === 0 || /[\u0000\r\n]/u.test(value))
    throw new TypeError(`Invalid process ${label}.`);
}

function terminateProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    // A race where the child already exited is expected and harmless.
    killer.on("error", () => undefined);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
