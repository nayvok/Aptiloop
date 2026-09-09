import { homedir, platform } from "node:os";
import path from "node:path";

import type { PortPlan, PortSource, PortsMode } from "./ports.js";

export const DEFAULT_WEB_PORT = 10101;
export const DEFAULT_ORCHESTRATOR_PORT = 8787;
export const LOOPBACK_HOST = "127.0.0.1";
export const RUNTIME_DIR_NAME = "runtime";
export const RUNTIME_STATE_DIR_NAME = "runtime-state";
export const STATUS_FILE_NAME = "status.json";
export const PID_FILE_NAME = "aptiloop.pid";
export const WEB_LOG_NAME = "web.log";
export const ORCHESTRATOR_LOG_NAME = "orchestrator.log";
export const CONFIG_FILE_NAME = "config.json";
export const GITHUB_OWNER = "nayvok";
export const GITHUB_REPO = "Aptiloop";
export interface ResolvedRuntimeConfig {
  readonly dataDir: string;
  readonly runtimeDir: string;
  readonly runtimeStateDir: string;
  readonly statusFile: string;
  readonly lockFile: string;
  readonly configFile: string;
  readonly updatesDir: string;
  readonly pidFile: string;
  readonly webLog: string;
  readonly orchestratorLog: string;
  readonly runtimeRoot: string;
  readonly releasesDir: string;
  readonly currentFile: string;
  readonly stableLauncherFile: string;
  readonly releaseRoot: string | null;
  readonly webPort: number;
  readonly orchestratorPort: number;
  readonly portsMode: PortsMode;
  readonly portSource: PortSource;
  readonly webOrigin: string;
  readonly orchestratorUrl: string;
  readonly sourceCheckoutRoot: string | null;
}

export interface FileSystemProbe {
  existsSync: (path: string) => boolean;
}

export function defaultOsDataDir(platformName: string = platform()): string {
  if (platformName === "win32") {
    const base =
      process.env.APPDATA ??
      (process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, "AppData", "Roaming")
        : null);
    return base
      ? path.join(base, "Aptiloop")
      : path.join(homedir(), "Aptiloop");
  }
  if (platformName === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "Aptiloop");
  }
  return path.join(homedir(), ".local", "share", "aptiloop");
}

export function parsePort(
  raw: string | undefined,
  variableName: string,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variableName} must be an integer TCP port 1-65535`);
  }
  return port;
}

export function resolveDataDir(options: {
  readonly explicit?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly persisted?: string | null | undefined;
  readonly sourceCheckoutRoot?: string | null | undefined;
}): string {
  const env = options.env ?? process.env;
  const explicit = options.explicit?.trim();
  if (explicit) return path.resolve(explicit);
  const fromEnv = env.APTILOOP_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const persisted = options.persisted?.trim();
  if (persisted) return path.resolve(persisted);
  if (options.sourceCheckoutRoot) {
    return path.join(options.sourceCheckoutRoot, ".data");
  }
  return defaultOsDataDir();
}

export interface PortOptions {
  readonly web?: number | undefined;
  readonly orchestrator?: number | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export function resolvePorts(options: PortOptions = {}): {
  web: number;
  orchestrator: number;
} {
  const env = options.env ?? process.env;
  return {
    web:
      options.web ??
      parsePort(env.APTILOOP_PORT, "APTILOOP_PORT", DEFAULT_WEB_PORT),
    orchestrator:
      options.orchestrator ??
      parsePort(
        env.APTILOOP_ORCHESTRATOR_PORT,
        "APTILOOP_ORCHESTRATOR_PORT",
        DEFAULT_ORCHESTRATOR_PORT,
      ),
  };
}

export function resolveRuntimeConfig(options: {
  readonly dataDir?: string | undefined;
  readonly web?: number | undefined;
  readonly orchestrator?: number | undefined;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly fs: FileSystemProbe;
  readonly persistedDataDir?: string | null | undefined;
  readonly portPlan?: PortPlan | undefined;
}): ResolvedRuntimeConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const installedReleaseRoot = env.APTILOOP_RELEASE_ROOT?.trim();
  const checkoutRoot = installedReleaseRoot
    ? null
    : findSourceCheckoutRoot(cwd, options.fs);
  const dataDir = resolveDataDir({
    explicit: options.dataDir,
    env,
    persisted: options.persistedDataDir,
    sourceCheckoutRoot: checkoutRoot,
  });
  const ports = resolvePorts({
    web: options.portPlan?.webPort ?? options.web,
    orchestrator: options.portPlan?.orchestratorPort ?? options.orchestrator,
    env: options.portPlan ? {} : env,
  });
  const runtimeRoot = resolveRuntimeRoot({ env });
  const runtimeStateDir = path.join(dataDir, RUNTIME_STATE_DIR_NAME);
  return {
    dataDir,
    runtimeDir: runtimeStateDir,
    runtimeStateDir,
    statusFile: path.join(runtimeStateDir, STATUS_FILE_NAME),
    lockFile: path.join(runtimeStateDir, "instance.lock"),
    configFile: path.join(dataDir, CONFIG_FILE_NAME),
    updatesDir: path.join(runtimeStateDir, "updates"),
    pidFile: path.join(runtimeStateDir, PID_FILE_NAME),
    webLog: path.join(runtimeStateDir, WEB_LOG_NAME),
    orchestratorLog: path.join(runtimeStateDir, ORCHESTRATOR_LOG_NAME),
    runtimeRoot,
    releasesDir: path.join(runtimeRoot, "releases"),
    currentFile: path.join(runtimeRoot, "current.json"),
    stableLauncherFile: path.join(runtimeRoot, "launcher.cjs"),
    releaseRoot: installedReleaseRoot
      ? path.resolve(installedReleaseRoot)
      : checkoutRoot,
    webPort: ports.web,
    orchestratorPort: ports.orchestrator,
    portsMode: options.portPlan?.mode ?? "fixed",
    portSource: options.portPlan?.source ?? "default",
    webOrigin: `http://${LOOPBACK_HOST}:${ports.web}`,
    orchestratorUrl: `http://${LOOPBACK_HOST}:${ports.orchestrator}`,
    sourceCheckoutRoot: checkoutRoot,
  };
}

export function defaultRuntimeRoot(
  platformName: string = platform(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platformName === "win32") {
    const base =
      env.LOCALAPPDATA ??
      (env.USERPROFILE ? path.join(env.USERPROFILE, "AppData", "Local") : null);
    return base
      ? path.join(base, "Aptiloop", "runtime")
      : path.join(homedir(), "Aptiloop", "runtime");
  }
  if (platformName === "darwin") {
    return path.join(
      homedir(),
      "Library",
      "Application Support",
      "Aptiloop",
      "runtime",
    );
  }
  const xdg = env.XDG_DATA_HOME?.trim();
  return xdg
    ? path.join(xdg, "aptiloop", "runtime")
    : path.join(homedir(), ".local", "share", "aptiloop", "runtime");
}

export function resolveRuntimeRoot(
  options: {
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly platformName?: string | undefined;
  } = {},
): string {
  const env = options.env ?? process.env;
  const explicit = env.APTILOOP_RUNTIME_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  return defaultRuntimeRoot(options.platformName ?? platform(), env);
}

export function findSourceCheckoutRoot(
  startDir: string,
  fs: FileSystemProbe,
): string | null {
  let current = path.resolve(startDir);
  for (;;) {
    try {
      if (
        fs.existsSync(path.join(current, "apps", "orchestrator")) &&
        fs.existsSync(path.join(current, "apps", "web")) &&
        fs.existsSync(path.join(current, "scripts"))
      ) {
        return current;
      }
    } catch {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
