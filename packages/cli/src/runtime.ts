import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { LOOPBACK_HOST, type ResolvedRuntimeConfig } from "./config.js";

export interface ServicePlan {
  readonly name: string;
  readonly entry: string;
  readonly args: readonly string[];
  readonly options: {
    readonly cwd: string;
    readonly env: Record<string, string | undefined>;
    readonly shell: false;
    readonly windowsHide?: boolean;
    readonly detached?: boolean;
    readonly stdio?: unknown;
  };
}

export interface LauncherApplication {
  stop: (code?: number) => void;
  waitForExit: (timeoutMs?: number) => Promise<boolean>;
}

export interface LauncherModule {
  createProductionServicePlans: (
    projectRoot: string,
    sourceEnvironment?: NodeJS.ProcessEnv,
    platform?: NodeJS.Platform,
  ) => ServicePlan[];
  launchProcessGroup: (
    plans: ServicePlan[],
    options?: {
      nodeExecutable?: string;
      platform?: NodeJS.Platform;
      spawnProcess?: typeof spawn;
      killProcess?: (pid: number, signal?: NodeJS.Signals) => void;
      logger?: Pick<Console, "error" | "log">;
      setExitCode?: (code: number) => void;
    },
  ) => LauncherApplication;
}

const launcherCandidates = [
  "../scripts/local-process-launcher.mjs",
  "../../../scripts/local-process-launcher.mjs",
];
export async function loadLauncherModule(
  projectRoot?: string,
): Promise<LauncherModule> {
  const base = typeof __dirname === "string" ? __dirname : process.cwd();
  const candidates = projectRoot
    ? [path.join(projectRoot, "scripts", "local-process-launcher.mjs")]
    : launcherCandidates.map((candidate) => path.resolve(base, candidate));
  const failures: string[] = [];
  for (const resolved of candidates) {
    try {
      // The launcher is selected from the verified release root at runtime.
      return (await import(
        pathToFileURL(resolved).href
      )) as unknown as LauncherModule;
    } catch (error) {
      failures.push(
        `${resolved}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `Unable to load local-process-launcher.mjs. Tried: ${failures.join("; ")}`,
  );
}

export function resolveProjectRoot(config: ResolvedRuntimeConfig): string {
  if (config.releaseRoot) return config.releaseRoot;
  throw new Error(
    "Aptiloop release root is not configured; refusing repository/package fallback.",
  );
}
export interface PidRecord {
  readonly pid: number;
  readonly webPort: number;
  readonly orchestratorPort: number;
  readonly dataDir: string;
  readonly startedAt: string;
}

export async function readPidRecord(
  pidFile: string,
): Promise<PidRecord | null> {
  try {
    const raw = await fs.readFile(pidFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<PidRecord>;
    if (
      typeof parsed.pid !== "number" ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0
    ) {
      return null;
    }
    return parsed as PidRecord;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function writePidRecord(
  pidFile: string,
  record: PidRecord,
): Promise<void> {
  await fs.mkdir(path.dirname(pidFile), { recursive: true });
  await fs.writeFile(pidFile, `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
  });
}

export async function removePidRecord(pidFile: string): Promise<void> {
  try {
    await fs.unlink(pidFile);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
}

export function isPortOccupied(host: string, port: number): Promise<boolean> {
  const { promise, resolve, reject } = Promise.withResolvers<boolean>();
  const server = net.createServer();
  server.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") resolve(true);
    else reject(error);
  });
  server.once("listening", () => server.close(() => resolve(false)));
  server.listen(port, host);
  return promise;
}

export async function assertPortsFree(
  config: ResolvedRuntimeConfig,
): Promise<void> {
  const conflicts: string[] = [];
  if (await isPortOccupied(LOOPBACK_HOST, config.webPort)) {
    conflicts.push(
      `port ${config.webPort} is occupied (web UI). Choose another with --port N or APTILOOP_PORT=N.`,
    );
  }
  if (await isPortOccupied(LOOPBACK_HOST, config.orchestratorPort)) {
    conflicts.push(
      `port ${config.orchestratorPort} is occupied (orchestrator). Choose another with --orch-port M or APTILOOP_ORCHESTRATOR_PORT=M.`,
    );
  }
  if (conflicts.length > 0) {
    throw new Error(`Cannot start: ${conflicts.join(" ")}`);
  }
}

export async function probeHttp(
  url: string,
  timeoutMs = 3000,
): Promise<{ ok: boolean; status: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}

export interface HealthSnapshot {
  readonly web: { ok: boolean; status: number | null };
  readonly orchestrator: { ok: boolean; status: number | null };
  readonly ready: boolean;
}

export async function checkHealth(
  config: ResolvedRuntimeConfig,
): Promise<HealthSnapshot> {
  const [web, orchestrator] = await Promise.all([
    probeHttp(config.webOrigin),
    probeHttp(`${config.orchestratorUrl}/health/ready`),
  ]);
  return { web, orchestrator, ready: web.ok && orchestrator.ok };
}

export function stopProcessTree(pid: number, platformName: string): void {
  if (platformName === "win32") {
    const taskkill = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    taskkill.on("error", () => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Best effort: the PID may already be gone.
      }
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Best effort: the PID may already be gone.
    }
  }
}

export async function spawnDetached(
  executable: string,
  args: readonly string[],
  options: { cwd: string; stdoutLog: string; stderrLog: string },
): Promise<ChildProcess> {
  await fs.mkdir(path.dirname(options.stdoutLog), { recursive: true });
  const stdout = await fs.open(options.stdoutLog, "a");
  const stderr =
    options.stderrLog === options.stdoutLog
      ? stdout
      : await fs.open(options.stderrLog, "a");
  try {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      shell: false,
      detached: true,
      stdio: ["ignore", stdout.fd, stderr.fd],
      windowsHide: true,
    });
    child.unref();
    return child;
  } finally {
    await stdout.close().catch(() => undefined);
    if (stderr !== stdout) await stderr.close().catch(() => undefined);
  }
}

export interface ReadyWaitOptions {
  readonly timeoutMs?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly probe?:
    ((config: ResolvedRuntimeConfig) => Promise<HealthSnapshot>) | undefined;
}

/**
 * Wait until both services answer healthy. Bind/start success observed here
 * is the authority for port selection; callers treat timeout as failure and
 * fully clean up before any retry. Throws on timeout.
 */
export async function waitForReady(
  config: ResolvedRuntimeConfig,
  options: ReadyWaitOptions = {},
): Promise<HealthSnapshot> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 500;
  const probe = options.probe ?? checkHealth;
  const deadline = Date.now() + timeoutMs;
  let latest: HealthSnapshot;
  for (;;) {
    latest = await probe(config);
    if (latest.ready) return latest;
    if (Date.now() >= deadline) {
      throw new Error(
        `Services did not become ready within ${Math.round(timeoutMs / 1000)}s ` +
          `(web=${latest.web.ok ? "up" : "down"} ${config.webOrigin}, ` +
          `orchestrator=${latest.orchestrator.ok ? "up" : "down"} ${config.orchestratorUrl}). ` +
          `See ${config.webLog} and ${config.orchestratorLog}.`,
      );
    }
    const gate = Promise.withResolvers<void>();
    setTimeout(gate.resolve, intervalMs);
    await gate.promise;
  }
}
/**
 * Bounded tail of a child log for failure diagnosis. Reads at most
 * `maxBytes` from the end; returns "" when the log is absent. Never throws
 * for missing files so failure paths keep their original reason.
 */
export async function readLogTail(
  logFile: string,
  maxBytes = 4096,
): Promise<string> {
  try {
    const handle = await fs.open(logFile, "r");
    try {
      const stat = await handle.stat();
      const size = Math.min(stat.size, maxBytes);
      if (size === 0) return "";
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, stat.size - size);
      return buffer.toString("utf8");
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch {
    return "";
  }
}
