import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { platform } from "node:os";
import path from "node:path";

import {
  DEFAULT_ORCHESTRATOR_PORT,
  DEFAULT_WEB_PORT,
  LOOPBACK_HOST,
  resolveRuntimeConfig,
  type ResolvedRuntimeConfig,
} from "./config.js";
import {
  acquireInstanceLock,
  candidatePortPairs,
  isAddrInUseMessage,
  pointerFileForOsDefault,
  probeAptiloopInstance,
  readDataDirPointer,
  readPersistedPortConfig,
  readRuntimeStatus,
  releaseInstanceLock,
  removeRuntimeStatus,
  resetPersistedPortConfig,
  resolvePortPlan,
  writeDataDirPointer,
  writePersistedPortConfig,
  writeRuntimeStatus,
  type PortPlan,
} from "./ports.js";
import { exportCourse, importCourse, listCourses } from "./courses.js";
import {
  checkHealth,
  isPortOccupied,
  isProcessAlive,
  loadLauncherModule,
  readLogTail,
  readPidRecord,
  removePidRecord,
  resolveProjectRoot,
  stopProcessTree,
  waitForReady,
  writePidRecord,
  type LauncherApplication,
  type LauncherModule,
} from "./runtime.js";
import {
  autostartStatus,
  buildAptiloopStartCommand,
  serviceInstall,
  serviceRestart,
  serviceStart,
  serviceStatus,
  serviceStop,
  serviceUninstall,
  setAutostart,
  type ServiceStartCommand,
} from "@aptiloop/os-service";
import { installShortcut, removeShortcut } from "@aptiloop/os-service";
import { orchestratorRequest } from "./update.js";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_BAD_ARGS = 64;

const HELP = `aptiloop — local-first Aptiloop launcher (loopback only, no auth, no cloud)

Usage: aptiloop <command> [options]

Commands:
  init                                   First run: check Node/ports, build if needed, pick data dir, print URL and next steps
  start [--port N] [--orch-port M] [--open] [--data-dir DIR]
                                         Foreground start of web + orchestrator; prints URL, version, PID; Ctrl+C stops the tree
  stop [--data-dir DIR]                  Stop the running tree started by aptiloop
  status [--json]                        Show {running, web, orchestrator, version, pid, ports}
  health | ready [--wait]                Liveness/readiness of both services (exit 0 ready, 1 not, 64 bad args)
  open | gui                             Open the web UI in the default browser
  service install|start|stop|restart|status|uninstall [--autostart] [--data-dir DIR]
                                         Background service surviving terminal close (launchd/systemd/Task Scheduler, user-level only)
  autostart on|off|status                Enable/disable autostart without uninstalling the service
  config show|reset-ports                Show persisted ports/data-dir state, or reset pinned ports back to automatic
  update check|apply [--version vX.Y.Z]  Check or apply a GitHub Releases update (explicit only, SHA-256 verified)
  courses list|export|import             Thin wrapper over orchestrator routes: export --course <key> [--revision <id>] [--with-progress --scope-note "..."] --out <file>; import <file> [--dry-run]
  doctor                                 Check Node version, ports, data dir, build artifacts, service health
  shortcuts install|remove               Desktop/Start Menu/Applications shortcuts (target: aptiloop open)
  uninstall                              Stop, remove service and shortcuts; never deletes data (prints the data path)

Global options: --data-dir DIR  --port N  --orch-port M  --json  --help
Data dir order: --data-dir > APTILOOP_DATA_DIR > persisted pointer > repo .data (source checkout only) > OS user-data
Ports: --port/--orch-port > APTILOOP_PORT/APTILOOP_ORCHESTRATOR_PORT > persisted config > defaults (${DEFAULT_WEB_PORT}/${DEFAULT_ORCHESTRATOR_PORT}); loopback only.
Port modes: explicit flags, env overrides, or user-fixed config are pinned and fail closed when occupied (never hop).
Unpinned automatic setup (aptiloop init/first start/service install) hops within ${DEFAULT_WEB_PORT}-${DEFAULT_WEB_PORT + 10}/${DEFAULT_ORCHESTRATOR_PORT}-${DEFAULT_ORCHESTRATOR_PORT + 10} on collision,
persists the bound pair, and prints/opens the actual URL. Bind/start success is the authority; postinstall never touches ports.
An occupant that answers as Aptiloop is reused/opened, not treated as a collision. Reset pins with: aptiloop config reset-ports
`;

interface GlobalFlags {
  dataDir?: string | undefined;
  port?: number | undefined;
  orchPort?: number | undefined;
  json: boolean;
  help: boolean;
}

function fail(message: string, code: number = EXIT_FAILURE): never {
  process.stderr.write(`aptiloop: ${message}\n`);
  process.exitCode = code;
  throw new Error(`__exit_${code}__`);
}

function parseIntegerFlag(
  args: string[],
  names: readonly string[],
): { value?: number | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if ((names as readonly string[]).includes(name)) {
      const raw =
        equals === -1
          ? (args[index + 1] as string | undefined)
          : arg.slice(equals + 1);
      if (raw === undefined || raw.startsWith("--")) {
        fail(`${name} requires a value.`, EXIT_BAD_ARGS);
      }
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        fail(`${name} must be an integer TCP port 1-65535.`, EXIT_BAD_ARGS);
      }
      value = parsed;
      if (equals === -1) index += 1;
      continue;
    }
    rest.push(arg);
  }
  return { value, rest };
}

function takeStringFlag(
  args: string[],
  names: readonly string[],
): { value?: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if ((names as readonly string[]).includes(name)) {
      const raw =
        equals === -1
          ? (args[index + 1] as string | undefined)
          : arg.slice(equals + 1);
      if (raw === undefined || raw.startsWith("--")) {
        fail(`${name} requires a value.`, EXIT_BAD_ARGS);
      }
      value = raw;
      if (equals === -1) index += 1;
      continue;
    }
    rest.push(arg);
  }
  return { value, rest };
}

function hasFlag(args: string[], names: readonly string[]): boolean {
  return args.some((arg) => (names as readonly string[]).includes(arg));
}

function parseGlobals(raw: string[]): { flags: GlobalFlags; rest: string[] } {
  const portParsed = parseIntegerFlag(raw, ["--port"]);
  const orchParsed = parseIntegerFlag(portParsed.rest, ["--orch-port"]);
  const dataParsed = takeStringFlag(orchParsed.rest, ["--data-dir"]);
  return {
    flags: {
      dataDir: dataParsed.value,
      port: portParsed.value,
      orchPort: orchParsed.value,
      json: hasFlag(dataParsed.rest, ["--json"]),
      help: hasFlag(dataParsed.rest, ["--help", "-h"]),
    },
    rest: dataParsed.rest.filter(
      (arg) => arg !== "--json" && arg !== "--help" && arg !== "-h",
    ),
  };
}

async function readCliVersion(): Promise<string> {
  const releaseRoot = process.env.APTILOOP_RELEASE_ROOT?.trim();
  const candidates = [
    ...(releaseRoot
      ? [path.join(path.resolve(releaseRoot), "version-manifest.json")]
      : []),
    path.join(process.cwd(), "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === "string") return parsed.version;
    } catch {
      // Try the next known metadata location.
    }
  }
  return "0.0.0";
}
async function loadPortPlan(
  flags: GlobalFlags,
  dataDir: string,
): Promise<PortPlan> {
  const persisted = await readPersistedPortConfig(dataDir);
  return resolvePortPlan({
    flags: { web: flags.port, orchestrator: flags.orchPort },
    env: process.env,
    persisted,
  });
}

async function preliminaryDataDir(flags: GlobalFlags): Promise<string> {
  const pointer = await readDataDirPointer(pointerFileForOsDefault());
  return resolveRuntimeConfig({
    dataDir: flags.dataDir,
    web: flags.port,
    orchestrator: flags.orchPort,
    fs: { existsSync },
    persistedDataDir: pointer,
  }).dataDir;
}

async function buildConfig(flags: GlobalFlags): Promise<ResolvedRuntimeConfig> {
  const dataDir = await preliminaryDataDir(flags);
  const plan = await loadPortPlan(flags, dataDir);
  return resolveRuntimeConfig({
    dataDir: flags.dataDir,
    web: flags.port,
    orchestrator: flags.orchPort,
    fs: { existsSync },
    persistedDataDir: await readDataDirPointer(pointerFileForOsDefault()),
    portPlan: plan,
  });
}

async function configWithCandidatePorts(
  flags: GlobalFlags,
  plan: PortPlan,
  webPort: number,
  orchestratorPort: number,
): Promise<ResolvedRuntimeConfig> {
  return resolveRuntimeConfig({
    dataDir: flags.dataDir,
    fs: { existsSync },
    persistedDataDir: await readDataDirPointer(pointerFileForOsDefault()),
    portPlan: {
      webPort,
      orchestratorPort,
      mode: plan.mode,
      source: plan.source,
    },
  });
}
export function cliEntryForService(): string {
  const stable = process.env.APTILOOP_BOOTSTRAP_ENTRY?.trim();
  if (stable) return path.resolve(stable);
  const explicit = process.env.APTILOOP_CLI_ENTRY?.trim();
  if (explicit && !path.basename(explicit).startsWith("runtime-cli"))
    return path.resolve(explicit);
  const releaseRoot = process.env.APTILOOP_RELEASE_ROOT?.trim();
  if (!releaseRoot)
    return path.resolve(
      process.cwd(),
      "packages",
      "cli",
      "dist",
      "bootstrap.cjs",
    );
  throw new Error(
    "Installed runtime is missing APTILOOP_BOOTSTRAP_ENTRY; refusing to pin a service to a versioned release CLI.",
  );
}

function envWithPorts(config: ResolvedRuntimeConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APTILOOP_PORT: String(config.webPort),
    APTILOOP_ORCHESTRATOR_PORT: String(config.orchestratorPort),
    APTILOOP_DATA_DIR: config.dataDir,
    APTILOOP_RUNTIME_ROOT: config.runtimeRoot,
    ...(config.releaseRoot
      ? { APTILOOP_RELEASE_ROOT: config.releaseRoot }
      : {}),
    APTILOOP_CLI_ENTRY: cliEntryForService(),
    APTILOOP_BOOTSTRAP_ENTRY: cliEntryForService(),
  };
}

async function reuseKnownInstance(
  config: ResolvedRuntimeConfig,
): Promise<boolean> {
  const identity = await probeAptiloopInstance(config.orchestratorUrl);
  if (!identity) return false;
  const record = await readPidRecord(config.pidFile);
  const pidNote =
    record && isProcessAlive(record.pid) ? ` (pid ${record.pid})` : "";
  process.stdout.write(
    `Aptiloop ${identity.version} is already running at ${config.webOrigin}${pidNote}. Reusing it instead of starting a new instance.\n`,
  );
  return true;
}

async function selectServicePorts(
  flags: GlobalFlags,
  preferred: ResolvedRuntimeConfig,
): Promise<ResolvedRuntimeConfig> {
  const plan = resolvePortPlan({
    flags: { web: flags.port, orchestrator: flags.orchPort },
    env: process.env,
    persisted: await readPersistedPortConfig(preferred.dataDir),
  });
  // Installation records the chosen preference only; service-run performs the
  // real bind/readiness attempt and persists the winner afterwards.
  await writePersistedPortConfig(preferred.dataDir, {
    webPort: plan.webPort,
    orchestratorPort: plan.orchestratorPort,
    portsMode: plan.mode,
  });
  await writeDataDirPointer(pointerFileForOsDefault(), preferred.dataDir);
  return preferred;
}

async function commandConfig(
  flags: GlobalFlags,
  rest: string[],
): Promise<void> {
  const [subcommand, ...extra] = rest;
  if (extra.length > 0) {
    fail(`Unknown config option: ${extra.join(" ")}.`, EXIT_BAD_ARGS);
  }
  const dataDir = await preliminaryDataDir(flags);
  if (subcommand === "show") {
    const persisted = await readPersistedPortConfig(dataDir);
    const plan = resolvePortPlan({
      flags: { web: flags.port, orchestrator: flags.orchPort },
      env: process.env,
      persisted,
    });
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify({
          dataDir,
          persistedPorts: persisted,
          effective: {
            webPort: plan.webPort,
            orchestratorPort: plan.orchestratorPort,
          },
          portsMode: plan.mode,
          portSource: plan.source,
        })}\n`,
      );
      return;
    }
    process.stdout.write(
      [
        `data dir: ${dataDir}`,
        persisted
          ? `persisted ports: web=${persisted.webPort} orchestrator=${persisted.orchestratorPort} (${persisted.portsMode})`
          : "persisted ports: none (preferred defaults apply)",
        `effective: web=${plan.webPort} orchestrator=${plan.orchestratorPort} (${plan.mode}, ${plan.source})`,
      ].join("\n") + "\n",
    );
    return;
  }
  if (subcommand === "reset-ports") {
    const reset = await resetPersistedPortConfig(dataDir);
    process.stdout.write(
      `Ports reset to automatic preferred pair web=${reset.webPort} orchestrator=${reset.orchestratorPort} (data dir ${dataDir}).\n`,
    );
    return;
  }
  fail("Usage: aptiloop config show|reset-ports.", EXIT_BAD_ARGS);
}

async function openLiveUrl(flags: GlobalFlags): Promise<void> {
  const config = await buildConfig(flags);
  const record = await readPidRecord(config.pidFile);
  const live =
    record && isProcessAlive(record.pid)
      ? await readRuntimeStatus(config.dataDir)
      : null;
  const url = live?.webOrigin ?? config.webOrigin;
  process.stdout.write(`Opening ${url}\n`);
  await openBrowser(url);
}

async function selectInitPorts(
  plan: PortPlan,
  preferred: ResolvedRuntimeConfig,
): Promise<ResolvedRuntimeConfig> {
  // init records the user's explicit pin or automatic preference only; it
  // never probes or reserves a port.
  await writePersistedPortConfig(preferred.dataDir, {
    webPort: plan.webPort,
    orchestratorPort: plan.orchestratorPort,
    portsMode: plan.mode,
  });
  await writeDataDirPointer(pointerFileForOsDefault(), preferred.dataDir);
  process.stdout.write(
    plan.mode === "auto"
      ? `Persisted automatic port preference web ${plan.webPort} + orchestrator ${plan.orchestratorPort} (actual ports are selected when both services bind and become ready on first start).\n`
      : `Persisted fixed port pair web ${plan.webPort} + orchestrator ${plan.orchestratorPort} (service start will never hop).\n`,
  );
  return preferred;
}
async function commandInit(flags: GlobalFlags): Promise<void> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
    fail(
      `Node >=24 is required (running ${process.version}). Install Node 24+ and retry.`,
    );
  }
  const dataDir = await preliminaryDataDir(flags);
  const plan = await loadPortPlan(flags, dataDir);
  let config = await configWithCandidatePorts(
    flags,
    plan,
    plan.webPort,
    plan.orchestratorPort,
  );
  const existing = await readPidRecord(config.pidFile);
  if (existing && isProcessAlive(existing.pid)) {
    fail(
      `Already running (pid ${existing.pid}). Use "aptiloop status" or "aptiloop stop" first.`,
    );
  }
  await fs.mkdir(config.runtimeDir, { recursive: true });
  const projectRoot = resolveProjectRoot(config);
  const webArtifact = config.releaseRoot
    ? path.join(
        projectRoot,
        "apps",
        "web",
        ".next",
        "standalone",
        "apps",
        "web",
        "server.js",
      )
    : path.join(projectRoot, "apps", "web", ".next", "BUILD_ID");
  const orchArtifact = path.join(
    projectRoot,
    "apps",
    "orchestrator",
    "dist",
    "server.js",
  );
  let artifactsPresent = true;
  try {
    await fs.access(webArtifact);
    await fs.access(orchArtifact);
  } catch {
    artifactsPresent = false;
  }
  if (!artifactsPresent && config.sourceCheckoutRoot) {
    process.stdout.write("Building web + orchestrator artifacts...\n");
    const build = spawnSync(
      process.execPath,
      ["node_modules/turbo/bin/turbo", "run", "build"],
      {
        cwd: config.sourceCheckoutRoot,
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (build.status !== 0) {
      fail("Build failed. Fix the errors above and rerun aptiloop init.");
    }
  } else if (!artifactsPresent) {
    fail(
      "Built artifacts are missing and this is not a source checkout. Reinstall aptiloop from a release bundle.",
    );
  }
  config = await selectInitPorts(plan, config);
  const version = await readCliVersion();
  process.stdout.write(
    [
      `Aptiloop ${version} initialized.`,
      `Data dir: ${config.dataDir}`,
      `Runtime root: ${config.runtimeRoot}`,
      `Web UI: ${config.webOrigin} (orchestrator ${config.orchestratorUrl}, ${config.portsMode})`,
      "",
      "If an existing install left data elsewhere, migrate with a transfer file:",
      "  1. On the old machine: Courses → Transfer with progress (or: aptiloop courses export --with-progress)",
      "  2. Copy the transfer file to this machine and import it in Courses → Import.",
      "  Aptiloop never copies another data dir silently.",
      "",
      "Next: aptiloop start --open",
      "Background (survives terminal close): aptiloop service install --autostart && aptiloop service start",
    ].join("\n") + "\n",
  );
}

async function commandStart(
  flags: GlobalFlags,
  rest: string[],
  serviceRun: boolean,
): Promise<void> {
  const open = hasFlag(rest, ["--open"]);
  const extra = rest.filter(
    (arg) => arg !== "--open" && arg !== "--service-run",
  );
  if (extra.length > 0)
    fail(`Unknown start option: ${extra.join(" ")}.`, EXIT_BAD_ARGS);
  const dataDir = await preliminaryDataDir(flags);
  const plan = await loadPortPlan(flags, dataDir);
  const preferred = await configWithCandidatePorts(
    flags,
    plan,
    plan.webPort,
    plan.orchestratorPort,
  );
  const existing = await readPidRecord(preferred.pidFile);
  if (existing && isProcessAlive(existing.pid)) {
    const live = await readRuntimeStatus(preferred.dataDir);
    fail(
      `Already running (pid ${existing.pid}${live ? `, web ${live.webOrigin}` : ""}). Use "aptiloop stop" first.`,
    );
  }
  if (existing) await removePidRecord(preferred.pidFile);
  await removeRuntimeStatus(preferred.dataDir);
  await acquireInstanceLock(preferred.dataDir);
  let projectRoot: string;
  let launcher: LauncherModule;
  try {
    projectRoot = resolveProjectRoot(preferred);
    launcher = await loadLauncherModule(projectRoot);
    const samplePlans = launcher.createProductionServicePlans(
      projectRoot,
      envWithPorts(preferred),
      platform(),
    );
    for (const sample of samplePlans) {
      try {
        await fs.access(sample.entry);
      } catch {
        throw new Error(
          `Production build is missing ${sample.entry}. Run "aptiloop init" (source checkout) or reinstall.`,
        );
      }
    }
  } catch (error) {
    await releaseInstanceLock(preferred.dataDir);
    await removeRuntimeStatus(preferred.dataDir);
    throw error;
  }
  const version = await readCliVersion();
  try {
    if (serviceRun) {
      await serveServiceRun(flags, plan, launcher, version);
      return;
    }
    const candidates = candidatePortPairs(plan);
    for (const candidate of candidates) {
      const config = await configWithCandidatePorts(
        flags,
        plan,
        candidate.webPort,
        candidate.orchestratorPort,
      );
      if (await reuseKnownInstance(config)) {
        await releaseInstanceLock(preferred.dataDir);
        return;
      }
      if (plan.mode === "auto") {
        const webBusy = await isPortOccupied(LOOPBACK_HOST, config.webPort);
        const orchBusy = await isPortOccupied(
          LOOPBACK_HOST,
          config.orchestratorPort,
        );
        if (webBusy || orchBusy) continue;
      }
      const attempt = await tryForegroundCandidate(
        config,
        launcher,
        version,
        open,
        plan,
      );
      if (attempt === "started") return;
    }
    if (plan.mode === "fixed") {
      fail(
        `Cannot start: pinned ports web ${plan.webPort} + orchestrator ${plan.orchestratorPort} (${plan.source}) refused the bind. ` +
          `Free them or reset to automatic with "aptiloop config reset-ports".`,
      );
    }
    fail(
      `Cannot start: no free loopback pair in the automatic range web ${plan.webPort}-${plan.webPort + 10} / orchestrator ${plan.orchestratorPort}-${plan.orchestratorPort + 10}. Free a port and retry.`,
    );
  } catch (error) {
    await releaseInstanceLock(preferred.dataDir);
    await removeRuntimeStatus(preferred.dataDir);
    throw error;
  }
}

async function serveServiceRun(
  flags: GlobalFlags,
  plan: PortPlan,
  launcher: LauncherModule,
  version: string,
): Promise<void> {
  const candidates = candidatePortPairs(plan);
  for (const candidate of candidates) {
    const config = await configWithCandidatePorts(
      flags,
      plan,
      candidate.webPort,
      candidate.orchestratorPort,
    );
    if (await reuseKnownInstance(config)) {
      await releaseInstanceLock(config.dataDir);
      return;
    }
    if (plan.mode === "auto") {
      const webBusy = await isPortOccupied(LOOPBACK_HOST, config.webPort);
      const orchBusy = await isPortOccupied(
        LOOPBACK_HOST,
        config.orchestratorPort,
      );
      if (webBusy || orchBusy) continue;
    }
    const outcome = await tryServiceCandidate(config, launcher, version, plan);
    if (outcome === "started") return;
  }
  if (plan.mode === "fixed") {
    fail(
      `Service run cannot bind pinned ports web ${plan.webPort} + orchestrator ${plan.orchestratorPort} (${plan.source}). ` +
        `Free them or reset to automatic with "aptiloop config reset-ports".`,
    );
  }
  fail(
    `Service run found no free loopback pair in the automatic range web ${plan.webPort}-${plan.webPort + 10} / orchestrator ${plan.orchestratorPort}-${plan.orchestratorPort + 10}.`,
  );
}
const MAX_RUNTIME_LOG_BYTES = 4 * 1024 * 1024;
const RUNTIME_LOG_ROTATION_INTERVAL_MS = 30_000;

async function retainRuntimeLogTail(logPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(logPath, "r+");
    const stats = await handle.stat();
    if (stats.size <= MAX_RUNTIME_LOG_BYTES) return;
    const tail = Buffer.alloc(MAX_RUNTIME_LOG_BYTES);
    const offset = stats.size - MAX_RUNTIME_LOG_BYTES;
    let written = 0;
    while (written < tail.byteLength) {
      const chunk = await handle.read(
        tail,
        written,
        tail.byteLength - written,
        offset + written,
      );
      if (chunk.bytesRead === 0) break;
      written += chunk.bytesRead;
    }
    await handle.write(tail.subarray(0, written), 0, written, 0);
    await handle.truncate(written);
    await handle.sync();
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function openBoundedRuntimeLog(logPath: string): Promise<FileHandle> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await retainRuntimeLogTail(logPath);
  return fs.open(logPath, "a");
}

function scheduleRuntimeLogRotation(
  logPaths: readonly string[],
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void Promise.all(
      logPaths.map((logPath) => retainRuntimeLogTail(logPath)),
    ).catch(() => undefined);
  }, RUNTIME_LOG_ROTATION_INTERVAL_MS);
  timer.unref();
  return timer;
}

async function tryServiceCandidate(
  config: ResolvedRuntimeConfig,
  launcher: LauncherModule,
  version: string,
  plan: PortPlan,
): Promise<"started" | "collision"> {
  const handles: FileHandle[] = [];
  let rotationTimer: NodeJS.Timeout | undefined;
  try {
    const webLog = await openBoundedRuntimeLog(config.webLog);
    handles.push(webLog);
    const orchLog = await openBoundedRuntimeLog(config.orchestratorLog);
    handles.push(orchLog);
    const plans = launcher.createProductionServicePlans(
      resolveProjectRoot(config),
      envWithPorts(config),
      platform(),
    );
    const loggedPlans = plans.map((servicePlan) =>
      servicePlan.name === "orchestrator"
        ? {
            ...servicePlan,
            options: {
              ...servicePlan.options,
              stdio: ["ignore", orchLog.fd, orchLog.fd] as const,
            },
          }
        : {
            ...servicePlan,
            options: {
              ...servicePlan.options,
              stdio: ["ignore", webLog.fd, webLog.fd] as const,
            },
          },
    );
    const application = launcher.launchProcessGroup(
      loggedPlans as Parameters<typeof launcher.launchProcessGroup>[0],
    );
    rotationTimer = scheduleRuntimeLogRotation([
      config.webLog,
      config.orchestratorLog,
    ]);
    try {
      await waitForReady(config, { timeoutMs: 60_000 });
    } catch (readyError) {
      application.stop(0);
      await application.waitForExit();
      const [webTail, orchTail] = await Promise.all([
        readLogTail(config.webLog),
        readLogTail(config.orchestratorLog),
      ]);
      const evidence = `${readyError instanceof Error ? readyError.message : String(readyError)}\n${webTail}\n${orchTail}`;
      if (isAddrInUseMessage(evidence)) {
        if (plan.mode === "fixed") {
          fail(
            `Service run cannot bind pinned ports web ${config.webPort} + orchestrator ${config.orchestratorPort} (${plan.source}; never hops).`,
          );
        }
        return "collision";
      }
      const tails = [webTail.trim(), orchTail.trim()].filter(
        (tail) => tail !== "",
      );
      fail(
        `Service run failed to start on web ${config.webPort} + orchestrator ${config.orchestratorPort} (not a port collision: no bind error in child output).` +
          (tails.length > 0
            ? ` Child output tails:\n${tails.join("\n---\n")}`
            : ""),
      );
    }
    if (plan.mode === "auto") {
      await writePersistedPortConfig(config.dataDir, {
        webPort: config.webPort,
        orchestratorPort: config.orchestratorPort,
        portsMode: "auto",
        autoFallbackArmed: false,
      });
    }
    await writeDataDirPointer(pointerFileForOsDefault(), config.dataDir);
    const startedAt = new Date().toISOString();
    await writePidRecord(config.pidFile, {
      pid: process.pid,
      webPort: config.webPort,
      orchestratorPort: config.orchestratorPort,
      dataDir: config.dataDir,
      startedAt,
    });
    await writeRuntimeStatus(config.dataDir, {
      pid: process.pid,
      webPort: config.webPort,
      orchestratorPort: config.orchestratorPort,
      webOrigin: config.webOrigin,
      orchestratorUrl: config.orchestratorUrl,
      version,
      startedAt,
    });
    let resolveShutdown: (() => void) | undefined;
    let rejectShutdown: ((error: unknown) => void) | undefined;
    const shutdownPromise = new Promise<void>((resolve, reject) => {
      resolveShutdown = resolve;
      rejectShutdown = reject;
    });
    let shutdownTask: Promise<void> | undefined;
    const shutdown = (): void => {
      shutdownTask ??= (async () => {
        try {
          clearInterval(rotationTimer);
          application.stop(0);
          const exited = await application.waitForExit(10_000);
          if (!exited)
            throw new Error("Runtime children did not exit during shutdown.");
          for (const handle of handles)
            await handle.close().catch(() => undefined);
          await removePidRecord(config.pidFile);
          await removeRuntimeStatus(config.dataDir);
          await releaseInstanceLock(config.dataDir);
          resolveShutdown?.();
        } catch (error) {
          rejectShutdown?.(error);
        }
      })();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    await shutdownPromise;
    return "started";
  } finally {
    clearInterval(rotationTimer);
    for (const handle of handles) await handle.close().catch(() => undefined);
  }
}

async function tryForegroundCandidate(
  config: ResolvedRuntimeConfig,
  launcher: LauncherModule,
  version: string,
  open: boolean,
  plan: PortPlan,
): Promise<"started" | "collision"> {
  const plans = launcher.createProductionServicePlans(
    resolveProjectRoot(config),
    envWithPorts(config),
    platform(),
  );
  const application = launcher.launchProcessGroup(plans);
  let ready = false;
  try {
    await waitForReady(config, { timeoutMs: 45_000 });
    ready = true;
  } catch (readyError) {
    application.stop(0);
    await application.waitForExit();
    const [webTail, orchTail] = await Promise.all([
      readLogTail(config.webLog),
      readLogTail(config.orchestratorLog),
    ]);
    const evidence = `${readyError instanceof Error ? readyError.message : String(readyError)}\n${webTail}\n${orchTail}`;
    if (isAddrInUseMessage(evidence)) {
      if (plan.mode === "fixed") {
        fail(
          `Cannot start: web ${config.webPort} + orchestrator ${config.orchestratorPort} refused the bind (pinned ${plan.source}; never hops). ` +
            `Free the ports or reset to automatic with "aptiloop config reset-ports".`,
        );
      }
      return "collision";
    }
    const tails = [webTail.trim(), orchTail.trim()].filter(
      (tail) => tail !== "",
    );
    fail(
      `Services failed to start on web ${config.webPort} + orchestrator ${config.orchestratorPort} (not a port collision: no bind error in child output). ` +
        `See ${config.webLog} and ${config.orchestratorLog}.` +
        (tails.length > 0
          ? ` Child output tails:\n${tails.join("\n---\n")}`
          : ""),
    );
  } finally {
    if (!ready) {
      try {
        application.stop(1);
        await application.waitForExit();
      } catch {
        // Best effort: the attempt is already failed.
      }
    }
  }
  if (plan.mode === "auto") {
    await writePersistedPortConfig(config.dataDir, {
      webPort: config.webPort,
      orchestratorPort: config.orchestratorPort,
      portsMode: "auto",
      autoFallbackArmed: false,
    });
  }
  await writeDataDirPointer(pointerFileForOsDefault(), config.dataDir);
  const startedAt = new Date().toISOString();
  await writePidRecord(config.pidFile, {
    pid: process.pid,
    webPort: config.webPort,
    orchestratorPort: config.orchestratorPort,
    dataDir: config.dataDir,
    startedAt,
  });
  await writeRuntimeStatus(config.dataDir, {
    pid: process.pid,
    webPort: config.webPort,
    orchestratorPort: config.orchestratorPort,
    webOrigin: config.webOrigin,
    orchestratorUrl: config.orchestratorUrl,
    version,
    startedAt,
  });
  const hopped =
    config.webPort !== plan.webPort ||
    config.orchestratorPort !== plan.orchestratorPort;
  process.stdout.write(
    `Aptiloop ${version} ready (pid ${process.pid}): web ${config.webOrigin}, orchestrator ${config.orchestratorUrl}.${hopped ? " (automatic fallback pair, persisted)" : ""}\n`,
  );
  process.once("SIGINT", () => shutdownForeground(config, application));
  process.once("SIGTERM", () => shutdownForeground(config, application));
  if (open) await openBrowser(config.webOrigin);
  await new Promise(() => undefined);
  return "started";
}

function shutdownForeground(
  config: ResolvedRuntimeConfig,
  application: LauncherApplication,
): void {
  application.stop(0);
  void removePidRecord(config.pidFile);
  void removeRuntimeStatus(config.dataDir);
  void releaseInstanceLock(config.dataDir);
}

async function commandStop(flags: GlobalFlags): Promise<void> {
  const config = await buildConfig(flags);
  const record = await readPidRecord(config.pidFile);
  if (!record) {
    await removeRuntimeStatus(config.dataDir);
    process.stdout.write("Aptiloop is not running (no pidfile).\n");
    return;
  }
  if (!isProcessAlive(record.pid)) {
    await removePidRecord(config.pidFile);
    await removeRuntimeStatus(config.dataDir);
    process.stdout.write(
      `Stale pidfile (pid ${record.pid} is gone) was removed. Aptiloop is not running.\n`,
    );
    return;
  }
  stopProcessTree(record.pid, platform());
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const gate = Promise.withResolvers<void>();
    setTimeout(gate.resolve, 500);
    await gate.promise;
    if (!isProcessAlive(record.pid)) break;
  }
  if (isProcessAlive(record.pid)) {
    fail(
      `PID ${record.pid} did not stop within 35s. Stop it manually, then rerun aptiloop stop.`,
    );
  }
  await removePidRecord(config.pidFile);
  await removeRuntimeStatus(config.dataDir);
  process.stdout.write("Aptiloop stopped.\n");
}

async function commandStatus(flags: GlobalFlags): Promise<void> {
  const config = await buildConfig(flags);
  const version = await readCliVersion();
  const record = await readPidRecord(config.pidFile);
  const pidAlive = record !== null && isProcessAlive(record.pid);
  const live = pidAlive ? await readRuntimeStatus(config.dataDir) : null;
  const effective =
    live !== null
      ? await configWithCandidatePorts(
          flags,
          {
            webPort: live.webPort,
            orchestratorPort: live.orchestratorPort,
            mode: config.portsMode,
            source: config.portSource,
          },
          live.webPort,
          live.orchestratorPort,
        )
      : config;
  const health = await checkHealth(effective);
  const payload = {
    running: pidAlive,
    web: health.web.ok,
    orchestrator: health.orchestrator.ok,
    version,
    pid: pidAlive && record ? record.pid : null,
    ports: { web: effective.webPort, orchestrator: effective.orchestratorPort },
    portsMode: config.portsMode,
    portSource: live !== null ? "runtime-state" : config.portSource,
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(
    [
      `running: ${payload.running ? `yes (pid ${payload.pid})` : "no"}`,
      `web: ${payload.web ? `up ${effective.webOrigin}` : `down ${effective.webOrigin}`}`,
      `orchestrator: ${payload.orchestrator ? `up ${effective.orchestratorUrl}` : `down ${effective.orchestratorUrl}`}`,
      `version: ${version}`,
      `ports: web=${effective.webPort} orchestrator=${effective.orchestratorPort} (${payload.portSource}${config.portsMode === "auto" ? ", automatic" : ", pinned"})`,
    ].join("\n") + "\n",
  );
}

async function commandHealth(flags: GlobalFlags, wait: boolean): Promise<void> {
  const config = await buildConfig(flags);
  const deadline = wait ? Date.now() + 120_000 : Date.now();
  for (;;) {
    const health = await checkHealth(config);
    if (health.ready) {
      process.stdout.write(
        `ready: web ${config.webOrigin} + orchestrator ${config.orchestratorUrl}.\n`,
      );
      process.exitCode = EXIT_OK;
      return;
    }
    if (Date.now() >= deadline) {
      process.stderr.write(
        `not ready: web=${health.web.ok ? "up" : "down"} orchestrator=${health.orchestrator.ok ? "up" : "down"}.\n`,
      );
      process.exitCode = EXIT_FAILURE;
      return;
    }
    const gate = Promise.withResolvers<void>();
    setTimeout(gate.resolve, 1000);
    await gate.promise;
  }
}

async function openBrowser(url: string): Promise<void> {
  const host = platform();
  if (host === "darwin") {
    spawnSync("open", [url], { shell: false, stdio: "ignore" });
    return;
  }
  if (host === "win32") {
    spawnSync("explorer.exe", [url], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  spawnSync("xdg-open", [url], { shell: false, stdio: "ignore" });
}
function serviceStartCommand(
  config: ResolvedRuntimeConfig,
): ServiceStartCommand {
  return buildAptiloopStartCommand(cliEntryForService(), config);
}

async function commandService(
  flags: GlobalFlags,
  action: string,
  rest: string[],
): Promise<void> {
  let config = await buildConfig(flags);
  const host = platform();
  const autostart = hasFlag(rest, ["--autostart"]);
  const leftover = rest.filter((arg) => arg !== "--autostart");
  if (leftover.length > 0)
    fail(`Unknown service option: ${leftover.join(" ")}.`, EXIT_BAD_ARGS);
  switch (action) {
    case "install": {
      config = await selectServicePorts(flags, config);
      const result = await serviceInstall(
        config,
        host,
        autostart,
        serviceStartCommand(config),
      );
      process.stdout.write(`${result.message}\n`);
      return;
    }
    case "start": {
      const result = await serviceStart(host);
      process.stdout.write(`${result.message}\n`);
      return;
    }
    case "stop": {
      const result = await serviceStop(host);
      process.stdout.write(`${result.message}\n`);
      return;
    }
    case "restart": {
      const result = await serviceRestart(host);
      process.stdout.write(`${result.message}\n`);
      return;
    }
    case "status": {
      const result = await serviceStatus(host);
      process.stdout.write(`${result.message}\n`);
      return;
    }
    case "uninstall": {
      const result = await serviceUninstall(host);
      process.stdout.write(`${result.message}\n`);
      return;
    }
    default:
      fail(
        `Unknown service action "${action}". Use install|start|stop|restart|status|uninstall.`,
        EXIT_BAD_ARGS,
      );
  }
}

async function commandAutostart(
  action: string,
  flags: GlobalFlags,
): Promise<void> {
  const config = await buildConfig(flags);
  const host = platform();
  if (action === "on") {
    const selected = await selectServicePorts(flags, config);
    const enabled = await setAutostart(
      selected,
      host,
      true,
      serviceStartCommand(selected),
    );
    process.stdout.write(`${enabled.message}\n`);
    try {
      const started = await serviceStart(host);
      process.stdout.write(`${started.message}\n`);
    } catch (error) {
      process.stdout.write(
        `Service enabled for login but the background start was not confirmed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return;
    }
    try {
      await waitForReady(selected, { timeoutMs: 60_000 });
      process.stdout.write(`Ready: web ${selected.webOrigin}.\n`);
    } catch (error) {
      process.stdout.write(
        `Service started but readiness was not confirmed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return;
  }
  if (action === "off") {
    const result = await setAutostart(
      config,
      host,
      false,
      serviceStartCommand(config),
    );
    process.stdout.write(`${result.message}\n`);
    return;
  }
  if (action === "status") {
    const result = await autostartStatus(host);
    process.stdout.write(`${result.message}\n`);
    return;
  }
  fail(
    `Unknown autostart action "${action}". Use on|off|status.`,
    EXIT_BAD_ARGS,
  );
}

async function commandUpdateCheck(flags: GlobalFlags): Promise<void> {
  const config = await buildConfig(flags);
  const result = await orchestratorRequest<{
    current: string;
    release: {
      version: string;
      tag: string;
      notes: string;
      publishedAt: string;
      assets: Array<{ name: string; size: number }>;
    } | null;
    newer: boolean;
  }>(config.orchestratorUrl, "/api/system/update/check");
  if (!result.release || !result.newer) {
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify({
          current: result.current,
          latest: result.release?.version ?? result.current,
          tag: result.release?.tag ?? null,
          newer: false,
          notes: "",
        })}\n`,
      );
      return;
    }
    process.stdout.write(
      `Aptiloop ${result.current} is up to date${result.release ? ` (latest ${result.release.tag})` : ""}.\n`,
    );
    return;
  }
  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({
        current: result.current,
        latest: result.release.version,
        tag: result.release.tag,
        newer: true,
        notes: result.release.notes,
      })}\n`,
    );
    return;
  }
  process.stdout.write(
    [
      `Update available: ${result.current} → ${result.release.version} (${result.release.tag}).`,
      `Published: ${result.release.publishedAt || "unknown date"}.`,
      `Assets: ${result.release.assets.map((asset) => `${asset.name} (${asset.size} bytes)`).join(", ") || "none listed"}.`,
      "",
      result.release.notes,
      "",
      `Apply with: aptiloop update apply --version ${result.release.tag}`,
    ].join("\n") + "\n",
  );
}

async function commandUpdateApply(
  flags: GlobalFlags,
  rest: string[],
): Promise<void> {
  const versionFlag = takeStringFlag(rest, ["--version"]);
  if (versionFlag.rest.length > 0) {
    fail(
      `Unknown update option: ${versionFlag.rest.join(" ")}.`,
      EXIT_BAD_ARGS,
    );
  }
  const config = await buildConfig(flags);
  if (config.sourceCheckoutRoot) {
    fail(
      'Source-checkout updates are disabled. Install the reviewed release with "npm install --global aptiloop@<version>" (or the reviewed runtime bundle), then run "aptiloop init" and restart the service; no git pull is performed.',
    );
  }
  const configuredDatabase = (
    process.env.DATABASE_PATH ??
    process.env.DATABASE_URL ??
    ""
  ).trim();
  if (
    configuredDatabase === ":memory:" ||
    configuredDatabase === "file::memory:"
  ) {
    fail(
      "Updates require a file-backed database; no runtime or database changes were made.",
    );
  }
  const checked = versionFlag.value
    ? null
    : await orchestratorRequest<{
        current: string;
        release: { version: string; tag: string } | null;
        newer: boolean;
      }>(config.orchestratorUrl, "/api/system/update/check");
  const tag = versionFlag.value ?? checked?.release?.tag;
  if (!tag) {
    process.stdout.write(
      `Aptiloop ${checked?.current ?? (await readCliVersion())} is already up to date.\n`,
    );
    return;
  }
  const operationId = randomUUID();
  const operation = await orchestratorRequest<{
    operationId: string;
    tag: string;
    state: "queued" | "running" | "succeeded" | "failed";
    phase?: string;
    message?: string;
  }>(config.orchestratorUrl, "/api/system/update/apply", {
    method: "POST",
    body: JSON.stringify({ operationId, tag }),
  });
  process.stdout.write(
    `Update ${operation.tag} queued (operation ${operation.operationId}).\n`,
  );
  const deadline = Date.now() + 10 * 60 * 1_000;
  let lastPhase: string | undefined = operation.phase;
  for (;;) {
    if (Date.now() >= deadline) {
      fail(
        `Update operation ${operationId} did not finish within ten minutes.`,
      );
    }
    try {
      const current = await orchestratorRequest<{
        state: "queued" | "running" | "succeeded" | "failed";
        phase?: string;
        message?: string;
      }>(
        config.orchestratorUrl,
        `/api/system/update/operations/${encodeURIComponent(operationId)}`,
      );
      if (current.phase && current.phase !== lastPhase) {
        process.stdout.write(`Update phase: ${current.phase}.\n`);
        lastPhase = current.phase;
      }
      if (current.state === "succeeded") {
        process.stdout.write(
          "Update succeeded; post-switch health was verified.\n",
        );
        return;
      }
      if (current.state === "failed") {
        fail(
          current.message ??
            "Update failed; inspect the operation evidence for rollback details.",
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("__exit_"))
        throw error;
      if (Date.now() >= deadline) throw error;
    }
    const delay = Promise.withResolvers<void>();
    setTimeout(delay.resolve, 750);
    await delay.promise;
  }
}

async function commandCourses(
  flags: GlobalFlags,
  subcommand: string,
  rest: string[],
): Promise<void> {
  const config = await buildConfig(flags);
  switch (subcommand) {
    case "list": {
      if (rest.length > 0)
        fail(`Unknown courses list option: ${rest.join(" ")}.`, EXIT_BAD_ARGS);
      process.stdout.write(`${await listCourses(config.orchestratorUrl)}\n`);
      return;
    }
    case "export": {
      const course = takeStringFlag(rest, ["--course"]);
      const revision = takeStringFlag(course.rest, ["--revision"]);
      const out = takeStringFlag(revision.rest, ["--out"]);
      const scopeNote = takeStringFlag(out.rest, ["--scope-note"]);
      const leftover = scopeNote.rest.filter(
        (arg) => arg !== "--with-progress",
      );
      if (leftover.length > 0)
        fail(
          `Unknown courses export option: ${leftover.join(" ")}.`,
          EXIT_BAD_ARGS,
        );
      if (!out.value)
        fail("courses export requires --out <file>.", EXIT_BAD_ARGS);
      const message = await exportCourse({
        orchestratorUrl: config.orchestratorUrl,
        courseKey: course.value,
        revisionId: revision.value,
        withProgress: hasFlag(rest, ["--with-progress"]),
        scopeNote: scopeNote.value,
        outPath: out.value,
      });
      process.stdout.write(`${message}\n`);
      return;
    }
    case "import": {
      const dryRun = hasFlag(rest, ["--dry-run"]);
      const positional = rest.filter((arg) => arg !== "--dry-run");
      if (positional.length !== 1 || !positional[0]) {
        fail(
          "Usage: aptiloop courses import <file> [--dry-run].",
          EXIT_BAD_ARGS,
        );
      }
      const message = await importCourse({
        orchestratorUrl: config.orchestratorUrl,
        filePath: positional[0] as string,
        dryRun,
      });
      process.stdout.write(`${message}\n`);
      return;
    }
    default:
      fail(
        `Unknown courses action "${subcommand}". Use list|export|import.`,
        EXIT_BAD_ARGS,
      );
  }
}

async function commandDoctor(flags: GlobalFlags): Promise<void> {
  const config = await buildConfig(flags);
  const lines: string[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  lines.push(
    `node: ${process.version} ${nodeMajor >= 24 ? "(ok, >=24)" : "(FAIL, need >=24)"}`,
  );
  const webBusy = await isPortOccupied("127.0.0.1", config.webPort);
  const orchBusy = await isPortOccupied("127.0.0.1", config.orchestratorPort);
  lines.push(`port ${config.webPort} (web): ${webBusy ? "occupied" : "free"}`);
  lines.push(
    `port ${config.orchestratorPort} (orchestrator): ${orchBusy ? "occupied" : "free"}`,
  );
  try {
    await fs.mkdir(config.runtimeDir, { recursive: true });
    await fs.access(config.runtimeDir);
    lines.push(`data dir: ${config.dataDir} (writable)`);
  } catch {
    lines.push(`data dir: ${config.dataDir} (FAIL, not writable)`);
  }
  const projectRoot = resolveProjectRoot(config);
  const webArtifact = config.releaseRoot
    ? path.join(
        projectRoot,
        "apps",
        "web",
        ".next",
        "standalone",
        "apps",
        "web",
        "server.js",
      )
    : path.join(projectRoot, "apps", "web", ".next", "BUILD_ID");
  for (const artifact of [
    path.join(projectRoot, "apps", "orchestrator", "dist", "server.js"),
    webArtifact,
  ]) {
    try {
      await fs.access(artifact);
      lines.push(`artifact: ${artifact} (present)`);
    } catch {
      lines.push(`artifact: ${artifact} (MISSING)`);
    }
  }
  const health = await checkHealth(config);
  lines.push(
    `health: web=${health.web.ok ? "up" : "down"} orchestrator=${health.orchestrator.ok ? "up" : "down"}`,
  );
  const record = await readPidRecord(config.pidFile);
  lines.push(
    `pidfile: ${record ? `pid ${record.pid} (${isProcessAlive(record.pid) ? "alive" : "stale"})` : "absent"}`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function commandUninstall(flags: GlobalFlags): Promise<void> {
  const config = await buildConfig(flags);
  const host = platform();
  await commandStop(flags);
  try {
    const result = await serviceUninstall(host);
    process.stdout.write(`${result.message}\n`);
  } catch {
    process.stdout.write(
      "No OS service was installed; skipping service removal.\n",
    );
  }
  try {
    process.stdout.write(`${await removeShortcut(host)}\n`);
  } catch {
    process.stdout.write(
      "No shortcuts were installed; skipping shortcut removal.\n",
    );
  }
  process.stdout.write(
    `Aptiloop uninstalled. User data was kept at ${config.dataDir} (delete it manually if intended).\n`,
  );
}

function iconPathForShortcuts(config: ResolvedRuntimeConfig): string | null {
  const root = config.releaseRoot ?? config.sourceCheckoutRoot;
  if (!root) return null;
  return config.releaseRoot
    ? path.join(
        root,
        "apps",
        "web",
        ".next",
        "standalone",
        "apps",
        "web",
        "app",
        "icon.svg",
      )
    : path.join(root, "apps", "web", "app", "icon.svg");
}

async function main(): Promise<void> {
  const [, , command, ...rawArgs] = process.argv;
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "-V" || command === "version") {
    process.stdout.write(`${await readCliVersion()}\n`);
    return;
  }
  const { flags, rest } = parseGlobals(rawArgs);
  if (flags.help) {
    process.stdout.write(HELP);
    return;
  }
  switch (command) {
    case "init":
      await commandInit(flags);
      return;
    case "start":
      await commandStart(flags, rest, hasFlag(rawArgs, ["--service-run"]));
      return;
    case "stop":
      await commandStop(flags);
      return;
    case "status":
      await commandStatus(flags);
      return;
    case "health":
    case "ready":
      if (hasFlag(rest, ["--wait"])) {
        const leftover = rest.filter((arg) => arg !== "--wait");
        if (leftover.length > 0)
          fail(`Unknown option: ${leftover.join(" ")}.`, EXIT_BAD_ARGS);
        await commandHealth(flags, true);
        return;
      }
      if (rest.length > 0)
        fail(`Unknown option: ${rest.join(" ")}.`, EXIT_BAD_ARGS);
      await commandHealth(flags, false);
      return;
    case "open":
    case "gui": {
      await openLiveUrl(flags);
      return;
    }
    case "service": {
      const [action, ...serviceArgs] = rest;
      if (!action)
        fail(
          "Usage: aptiloop service install|start|stop|restart|status|uninstall [--autostart].",
          EXIT_BAD_ARGS,
        );
      await commandService(flags, action, serviceArgs);
      return;
    }
    case "autostart": {
      const [action] = rest;
      if (!action)
        fail("Usage: aptiloop autostart on|off|status.", EXIT_BAD_ARGS);
      await commandAutostart(action, flags);
      return;
    }
    case "config": {
      await commandConfig(flags, rest);
      return;
    }
    case "update": {
      const [action, ...updateArgs] = rest;
      if (action === "check") {
        await commandUpdateCheck(flags);
        return;
      }
      if (action === "apply") {
        await commandUpdateApply(flags, updateArgs);
        return;
      }
      fail(
        "Usage: aptiloop update check|apply [--version vX.Y.Z].",
        EXIT_BAD_ARGS,
      );
      return;
    }
    case "courses": {
      const [subcommand, ...courseArgs] = rest;
      if (!subcommand) {
        fail("Usage: aptiloop courses list|export|import.", EXIT_BAD_ARGS);
      }
      await commandCourses(flags, subcommand, courseArgs);
      return;
    }
    case "doctor":
      await commandDoctor(flags);
      return;
    case "shortcuts": {
      const [action] = rest;
      const config = await buildConfig(flags);
      if (action === "install") {
        process.stdout.write(
          `${await installShortcut(platform(), iconPathForShortcuts(config), {
            executable: process.execPath,
            args: [cliEntryForService(), "open"],
          })}\n`,
        );
        return;
      }
      if (action === "remove") {
        process.stdout.write(`${await removeShortcut(platform())}\n`);
        return;
      }
      fail("Usage: aptiloop shortcuts install|remove.", EXIT_BAD_ARGS);
      return;
    }
    case "uninstall":
      await commandUninstall(flags);
      return;
    default:
      fail(
        `Unknown command "${command}". Run "aptiloop --help".`,
        EXIT_BAD_ARGS,
      );
  }
}

void main().catch((error: unknown) => {
  if (error instanceof Error && error.message.startsWith("__exit_")) {
    // fail() already set process.exitCode.
  } else {
    process.stderr.write(
      `aptiloop: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = EXIT_FAILURE;
  }
});
