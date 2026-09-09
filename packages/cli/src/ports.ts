import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  DEFAULT_ORCHESTRATOR_PORT,
  DEFAULT_WEB_PORT,
  defaultOsDataDir,
} from "./config.js";

/**
 * Port contract (auto-vs-fixed).
 *
 * Primary precedent: lidge-jun/opencodex. Its README states "Unpinned starts
 * may pick another free port if the preferred one is busy; an explicit
 * `--port` never hops" (https://github.com/lidge-jun/opencodex, README CLI
 * section; full reference https://opencodex.me/reference/cli/). Its
 * implementation (src/server/ports.ts) is the model for three rules applied
 * here:
 * - Only EADDRINUSE ("address in use") is safe to answer with a retry on
 *   another port (`isAddrInUse`); every other bind/start failure must fail
 *   with the child exit/log reason, never be mislabeled a collision.
 * - Explicit `--port` and service-baked pins disable fallback
 *   (`allowEphemeralFallback: false`, `PortUnavailableError`) so a restart
 *   can never silently hop (their PR #152 gap).
 * - A selected ephemeral port is resolved to a concrete port before anything
 *   persists or advertises it, and fallback selections are deliberately NOT
 *   written back over a live configured port (`shouldPersistSelectedPort`).
 * Where Aptiloop diverges, it does so on purpose: this is a single-user
 * local app with a documented stable URL, so unpinned setup falls back
 * within a small deterministic range (preferred..preferred+10 on both
 * services, kept boring at web 10101 / orchestrator 8787 because both are
 * already documented/bookmarked and outside the congested dev-tool range
 * 3000/5000/8000/8080/9000; loopback-only needs no IANA registration) and
 * persists the bound winner plus a runtime-state rendezvous that
 * status/shortcuts/service/UI consume. The two ranges (10101-10111 and
 * 8787-8797) never overlap, so no reserved-port exclusion is needed.
 * - Actual child bind + ready is the authority. Preflight probes may only
 *   optimize (skip obviously-busy pairs) or detect a live Aptiloop instance
 *   for reuse; they never reserve or persist.
 * - npm postinstall MUST NOT inspect or reserve ports.
 */
export const AUTO_FALLBACK_ATTEMPTS = 10;
export const CONFIG_FILE_NAME = "config.json";
export const DATA_DIR_POINTER_FILE = "last-data-dir.json";
const CONFIG_VERSION = 1;

export type PortsMode = "auto" | "fixed";

export interface PersistedPortConfig {
  readonly webPort: number;
  readonly orchestratorPort: number;
  readonly portsMode: PortsMode;
  /**
   * Omitted while the first unpinned bind is still armed. A successful
   * automatic bind writes false so later starts never hop until reset.
   */
  readonly autoFallbackArmed?: boolean | undefined;
}

export type PortSource = "flag" | "env" | "persisted" | "default";

export interface PortPlan {
  readonly webPort: number;
  readonly orchestratorPort: number;
  readonly mode: PortsMode;
  readonly source: PortSource;
}

export interface PortFlagInput {
  readonly web?: number | undefined;
  readonly orchestrator?: number | undefined;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function configFileForDataDir(dataDir: string): string {
  return path.join(dataDir, CONFIG_FILE_NAME);
}

export function pointerFileForOsDefault(platformName?: string): string | null {
  try {
    return path.join(defaultOsDataDir(platformName), DATA_DIR_POINTER_FILE);
  } catch {
    return null;
  }
}

export async function readPersistedPortConfig(
  dataDir: string,
): Promise<PersistedPortConfig | null> {
  try {
    const raw = await fs.readFile(configFileForDataDir(dataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedPortConfig>;
    if (
      typeof parsed.webPort !== "number" ||
      typeof parsed.orchestratorPort !== "number" ||
      !isValidPort(parsed.webPort) ||
      !isValidPort(parsed.orchestratorPort) ||
      (parsed.portsMode !== "auto" && parsed.portsMode !== "fixed") ||
      (parsed.autoFallbackArmed !== undefined &&
        typeof parsed.autoFallbackArmed !== "boolean")
    ) {
      return null;
    }
    return {
      webPort: parsed.webPort,
      orchestratorPort: parsed.orchestratorPort,
      portsMode: parsed.portsMode,
      ...(typeof parsed.autoFallbackArmed === "boolean"
        ? { autoFallbackArmed: parsed.autoFallbackArmed }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Atomic temp + rename so readers never see a half-written config. */
export async function writePersistedPortConfig(
  dataDir: string,
  config: PersistedPortConfig,
): Promise<void> {
  if (!isValidPort(config.webPort) || !isValidPort(config.orchestratorPort)) {
    throw new Error("Refusing to persist an out-of-range port pair.");
  }
  if (config.portsMode !== "auto" && config.portsMode !== "fixed") {
    throw new Error("Refusing to persist an unknown ports mode.");
  }
  await fs.mkdir(dataDir, { recursive: true });
  const target = configFileForDataDir(dataDir);
  const temp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(
    temp,
    `${JSON.stringify({ version: CONFIG_VERSION, ...config }, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temp, target);
}

/** Forget a user-fixed pin and return to preferred automatic ports. */
export async function resetPersistedPortConfig(
  dataDir: string,
): Promise<PersistedPortConfig> {
  const config: PersistedPortConfig = {
    webPort: DEFAULT_WEB_PORT,
    orchestratorPort: DEFAULT_ORCHESTRATOR_PORT,
    portsMode: "auto",
  };
  await writePersistedPortConfig(dataDir, config);
  return config;
}

export async function readDataDirPointer(
  pointerFile: string | null,
): Promise<string | null> {
  if (!pointerFile) return null;
  try {
    const raw = await fs.readFile(pointerFile, "utf8");
    const parsed = JSON.parse(raw) as { dataDir?: unknown };
    if (typeof parsed.dataDir !== "string" || parsed.dataDir.trim() === "") {
      return null;
    }
    return path.resolve(parsed.dataDir);
  } catch {
    return null;
  }
}

/** Best-effort pointer so a custom data dir is found on the next run. */
export async function writeDataDirPointer(
  pointerFile: string | null,
  dataDir: string,
): Promise<void> {
  if (!pointerFile) return;
  try {
    if (path.resolve(dataDir) === path.resolve(path.dirname(pointerFile)))
      return;
    await fs.mkdir(path.dirname(pointerFile), { recursive: true });
    const temp = `${pointerFile}.tmp-${process.pid}`;
    await fs.writeFile(
      temp,
      `${JSON.stringify({ dataDir }, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(temp, pointerFile);
  } catch {
    // Pointer loss only costs convenience; the explicit/env resolution still works.
  }
}

function portFromEnv(
  env: NodeJS.ProcessEnv | undefined,
  name: string,
): number | undefined {
  const raw = env?.[name]?.trim();
  if (!raw) return undefined;
  const port = Number(raw);
  if (!isValidPort(port)) {
    throw new Error(`${name} must be an integer TCP port 1-65535`);
  }
  return port;
}

export function resolvePortPlan(options: {
  readonly flags?: PortFlagInput | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly persisted?: PersistedPortConfig | null | undefined;
}): PortPlan {
  const env = options.env;
  const envWeb = portFromEnv(env, "APTILOOP_PORT");
  const envOrch = portFromEnv(env, "APTILOOP_ORCHESTRATOR_PORT");
  const persisted = options.persisted ?? null;
  const webPort =
    options.flags?.web ?? envWeb ?? persisted?.webPort ?? DEFAULT_WEB_PORT;
  const orchestratorPort =
    options.flags?.orchestrator ??
    envOrch ??
    persisted?.orchestratorPort ??
    DEFAULT_ORCHESTRATOR_PORT;
  const pinned =
    options.flags?.web !== undefined ||
    options.flags?.orchestrator !== undefined ||
    envWeb !== undefined ||
    envOrch !== undefined ||
    persisted?.portsMode === "fixed" ||
    persisted?.autoFallbackArmed === false;
  const source: PortSource =
    options.flags?.web !== undefined ||
    options.flags?.orchestrator !== undefined
      ? "flag"
      : envWeb !== undefined || envOrch !== undefined
        ? "env"
        : persisted
          ? "persisted"
          : "default";
  return {
    webPort,
    orchestratorPort,
    mode: pinned ? "fixed" : "auto",
    source,
  };
}

/**
 * Deterministic candidate pairs: the preferred pair first, then +1/+1 steps.
 * Fixed plans yield exactly one candidate (never hop).
 */
export function candidatePortPairs(
  plan: PortPlan,
  attempts: number = AUTO_FALLBACK_ATTEMPTS,
): readonly { webPort: number; orchestratorPort: number }[] {
  if (plan.mode === "fixed") {
    return [{ webPort: plan.webPort, orchestratorPort: plan.orchestratorPort }];
  }
  const pairs: { webPort: number; orchestratorPort: number }[] = [];
  for (let step = 0; step <= attempts; step += 1) {
    const webPort = plan.webPort + step;
    const orchestratorPort = plan.orchestratorPort + step;
    if (!isValidPort(webPort) || !isValidPort(orchestratorPort)) break;
    pairs.push({ webPort, orchestratorPort });
  }
  return pairs;
}

export interface RuntimeStatusRecord {
  readonly pid: number;
  readonly webPort: number;
  readonly orchestratorPort: number;
  readonly webOrigin: string;
  readonly orchestratorUrl: string;
  readonly version: string;
  readonly startedAt: string;
}

export function statusFileForDataDir(dataDir: string): string {
  return path.join(dataDir, "runtime-state", "status.json");
}

export async function readRuntimeStatus(
  dataDir: string,
): Promise<RuntimeStatusRecord | null> {
  try {
    const raw = await fs.readFile(statusFileForDataDir(dataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeStatusRecord>;
    if (
      typeof parsed.pid !== "number" ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.webPort !== "number" ||
      typeof parsed.orchestratorPort !== "number" ||
      parsed.webPort < 1 ||
      parsed.webPort > 65_535 ||
      parsed.orchestratorPort < 1 ||
      parsed.orchestratorPort > 65_535 ||
      typeof parsed.webOrigin !== "string" ||
      typeof parsed.orchestratorUrl !== "string"
    ) {
      return null;
    }
    return parsed as RuntimeStatusRecord;
  } catch {
    return null;
  }
}

/** Atomic temp + rename so status readers never see a half-written rendezvous. */
export async function writeRuntimeStatus(
  dataDir: string,
  record: RuntimeStatusRecord,
): Promise<void> {
  const dir = path.join(dataDir, "runtime-state");
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, "status.json");
  const temp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await fs.rename(temp, target);
}

export async function removeRuntimeStatus(dataDir: string): Promise<void> {
  try {
    await fs.unlink(statusFileForDataDir(dataDir));
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

export interface AptiloopInstanceIdentity {
  readonly version: string;
  readonly webOrigin: string;
  readonly deploymentProfile?: string | undefined;
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "::1") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

/**
 * Identify a running Aptiloop orchestrator by its explicit version identity
 * and actual loopback web origin. Returns null for strangers/unreachable
 * hosts. This is reuse detection only — never a reservation.
 */
export async function probeAptiloopInstance(
  orchestratorUrl: string,
  timeoutMs = 2000,
): Promise<AptiloopInstanceIdentity | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${orchestratorUrl}/api/version`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      product?: unknown;
      appVersion?: unknown;
      webOrigin?: unknown;
      deploymentProfile?: unknown;
    };
    if (body.product !== "Aptiloop") return null;
    if (typeof body.appVersion !== "string" || body.appVersion.trim() === "")
      return null;
    if (typeof body.webOrigin !== "string" || !isLoopbackOrigin(body.webOrigin))
      return null;
    return {
      version: body.appVersion,
      webOrigin: body.webOrigin,
      ...(typeof body.deploymentProfile === "string"
        ? { deploymentProfile: body.deploymentProfile }
        : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
const ADDR_IN_USE_PATTERN =
  /eaddrinuse|address in use|only one usage of each socket address/i;

/**
 * Mirror of opencodex `isAddrInUse`, adapted to grandchildren: we cannot see
 * their listen errors directly, so we classify captured child stderr/log
 * text. Only a positive match may be treated as a port collision; anything
 * else is a genuine startup failure and must keep its own reason.
 */
export function isAddrInUseMessage(text: string): boolean {
  return ADDR_IN_USE_PATTERN.test(text);
}

export interface InstanceLock {
  readonly pid: number;
  readonly startedAt: string;
}

export function lockFileForDataDir(dataDir: string): string {
  return path.join(dataDir, "runtime-state", "instance.lock");
}

function lockIsAlive(lock: InstanceLock): boolean {
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLockFile(lockFile: string): Promise<InstanceLock | null> {
  try {
    const raw = await fs.readFile(lockFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<InstanceLock>;
    if (
      typeof parsed.pid !== "number" ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    };
  } catch {
    return null;
  }
}

/**
 * Atomically acquire the single-instance lock (create-only) before launching
 * any child. A lock held by a live PID means a duplicate start: fail instead
 * of launching. A stale lock (dead PID or unreadable body) is removed and
 * acquisition retried exactly once. Callers MUST release on every failure
 * path and on shutdown signals; the lock stays held while running.
 */
export async function acquireInstanceLock(
  dataDir: string,
): Promise<InstanceLock> {
  const dir = path.join(dataDir, "runtime-state");
  await fs.mkdir(dir, { recursive: true });
  const lockFile = lockFileForDataDir(dataDir);
  const record: InstanceLock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.writeFile(lockFile, `${JSON.stringify(record, null, 2)}\n`, {
        flag: "wx",
      });
      return record;
    } catch (error) {
      lastError = error;
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      if (code !== "EEXIST") throw error;
      const existing = await readLockFile(lockFile);
      if (existing && lockIsAlive(existing)) {
        throw new Error(
          `Already running (pid ${existing.pid}). Use "aptiloop status" or "aptiloop stop" first.`,
          { cause: error },
        );
      }
      const quarantine = `${lockFile}.stale-${process.pid}-${randomUUID()}`;
      try {
        // Rename is the atomic compare-and-reclaim operation. Never unlink
        // the original pathname after observing a stale body: another
        // contender may have replaced it with a live lock in the meantime.
        await fs.rename(lockFile, quarantine);
        await fs.rm(quarantine, { force: true });
      } catch (reclaimError) {
        const reclaimCode =
          reclaimError instanceof Error && "code" in reclaimError
            ? reclaimError.code
            : null;
        if (reclaimCode !== "ENOENT") throw reclaimError;
        // Another contender won the rename; retry create-only acquisition.
      }
    }
  }
  throw new Error(
    "Could not acquire the Aptiloop instance lock after a stale-lock retry. " +
      "Inspect and remove it manually if no instance is running, then retry.",
    { cause: lastError },
  );
}

export async function releaseInstanceLock(dataDir: string): Promise<void> {
  try {
    const existing = await readLockFile(lockFileForDataDir(dataDir));
    if (existing && existing.pid !== process.pid) return;
    await fs.unlink(lockFileForDataDir(dataDir));
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
