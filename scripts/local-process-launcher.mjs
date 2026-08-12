import { spawn } from "node:child_process";
import path from "node:path";

const PRODUCTION_ENVIRONMENT_ALLOWLIST = [
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WINDIR",
];
const UNIX_ORCHESTRATOR_ENVIRONMENT_ALLOWLIST = [
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
];
const UNIX_GRACEFUL_SHUTDOWN_MS = 30_000;
const WINDOWS_GRACEFUL_SHUTDOWN_MS = 30_000;

export function createProductionServicePlans(
  projectRoot,
  sourceEnvironment = process.env,
  platform = process.platform,
) {
  const environment = createProductionEnvironment(
    projectRoot,
    sourceEnvironment,
    platform,
  );
  const orchestratorEnvironment =
    platform === "win32"
      ? environment
      : {
          ...environment,
          ...copyAllowedEnvironment(
            sourceEnvironment,
            UNIX_ORCHESTRATOR_ENVIRONMENT_ALLOWLIST,
            platform,
          ),
        };
  const common = {
    shell: false,
    stdio: "inherit",
    windowsHide: true,
    detached: platform !== "win32",
  };

  return [
    {
      name: "orchestrator",
      entry: path.join(
        projectRoot,
        "apps",
        "orchestrator",
        "dist",
        "server.js",
      ),
      args: [],
      options: {
        ...common,
        cwd: projectRoot,
        env: {
          ...orchestratorEnvironment,
          HOST: "127.0.0.1",
          HOSTNAME: "127.0.0.1",
          PORT: "8787",
        },
      },
    },
    {
      name: "web",
      entry: path.join(
        projectRoot,
        "node_modules",
        "next",
        "dist",
        "bin",
        "next",
      ),
      args: ["start", "--hostname", "127.0.0.1"],
      options: {
        ...common,
        cwd: path.join(projectRoot, "apps", "web"),
        env: {
          ...environment,
          HOST: "127.0.0.1",
          HOSTNAME: "127.0.0.1",
          PORT: "3000",
        },
      },
    },
  ];
}

export function createProductionBuildPlan(
  projectRoot,
  sourceEnvironment = process.env,
  platform = process.platform,
) {
  return {
    entry: path.join(projectRoot, "node_modules", "turbo", "bin", "turbo"),
    args: ["run", "build"],
    options: {
      cwd: projectRoot,
      env: createProductionEnvironment(
        projectRoot,
        sourceEnvironment,
        platform,
      ),
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  };
}

function createProductionEnvironment(projectRoot, sourceEnvironment, platform) {
  return {
    ...copyAllowedProductionEnvironment(sourceEnvironment, platform),
    NODE_ENV: "production",
    ORCHESTRATOR_BIND_MODE: "direct",
    ORCHESTRATOR_URL: "http://127.0.0.1:8787",
    WEB_ORIGIN: "http://127.0.0.1:3000",
    DATABASE_PATH: path.join(
      projectRoot,
      ".data",
      "dev-learning-harness.sqlite",
    ),
    DATABASE_URL: path.join(
      projectRoot,
      ".data",
      "dev-learning-harness.sqlite",
    ),
    WORKSPACE_ROOT: path.join(projectRoot, "workspaces", "exercises"),
    EXERCISE_ATTEMPTS_ROOT: path.join(
      projectRoot,
      ".data",
      "exercise-attempts",
    ),
    ZED_EXECUTABLE: "zed",
    NEXT_DIST_DIR: ".next",
  };
}

function copyAllowedProductionEnvironment(sourceEnvironment, platform) {
  return copyAllowedEnvironment(
    sourceEnvironment,
    PRODUCTION_ENVIRONMENT_ALLOWLIST,
    platform,
  );
}

function copyAllowedEnvironment(sourceEnvironment, allowlist, platform) {
  const entries = new Map(
    Object.entries(sourceEnvironment).map(([name, value]) => [
      platform === "win32" ? name.toUpperCase() : name,
      value,
    ]),
  );
  const environment = {};
  for (const name of allowlist) {
    const value = entries.get(name);
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

export function launchProcessGroup(
  plans,
  {
    nodeExecutable = process.execPath,
    platform = process.platform,
    spawnProcess = spawn,
    killProcess = process.kill,
    logger = console,
    setExitCode = (code) => {
      process.exitCode = code;
    },
  } = {},
) {
  const children = [];
  const exitedChildren = new Set();
  let stopping = false;
  let forceWindowsCleanup = false;

  const terminate = (child) => {
    if (exitedChildren.has(child) || child.killed || child.pid === undefined) {
      return;
    }
    if (platform === "win32") {
      const pid = child.pid;
      const forceCleanup = () => {
        if (exitedChildren.has(child) || child.killed) return;
        let cleanupReported = false;
        let cleanupTimeout;
        const clearCleanupTimeout = () => {
          if (cleanupTimeout === undefined) return;
          clearTimeout(cleanupTimeout);
          cleanupTimeout = undefined;
        };
        const fallback = (reason) => {
          if (cleanupReported) return;
          cleanupReported = true;
          clearCleanupTimeout();
          logger.error(
            `[local] Windows process-tree cleanup failed for PID ${pid}: ${reason}. Descendant cleanup could not be verified; force-stopping the tracked service process.`,
          );
          safelyKillServiceProcess(child, logger);
        };
        let killer;
        try {
          killer = spawnProcess(
            "taskkill.exe",
            ["/pid", String(pid), "/t", "/f"],
            {
              shell: false,
              stdio: "ignore",
              windowsHide: true,
            },
          );
        } catch (error) {
          fallback(`could not start taskkill (${String(error)})`);
          return;
        }
        child.once("exit", () => {
          cleanupReported = true;
          clearCleanupTimeout();
        });
        killer.once("error", (error) => fallback(error.message));
        killer.once("exit", (code, signal) => {
          if (cleanupReported || code === 0) return;
          fallback(
            signal
              ? `taskkill stopped after signal ${signal}`
              : `taskkill exited with code ${code ?? 1}`,
          );
        });
        cleanupTimeout = setTimeout(
          () => fallback("taskkill did not stop the service within 1 second"),
          1_000,
        );
        cleanupTimeout.unref();
      };
      if (forceWindowsCleanup) {
        forceCleanup();
      } else {
        const grace = setTimeout(forceCleanup, WINDOWS_GRACEFUL_SHUTDOWN_MS);
        grace.unref();
        child.once("exit", () => clearTimeout(grace));
      }
      return;
    }

    try {
      killProcess(-child.pid, "SIGTERM");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      )) {
        logger.error(`[local] Failed to stop process group: ${String(error)}`);
      }
      return;
    }
    const forceKill = setTimeout(() => {
      if (exitedChildren.has(child)) return;
      try {
        killProcess(-child.pid, "SIGKILL");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        )) {
          logger.error(
            `[local] Failed to force-stop process group: ${String(error)}`,
          );
        }
      }
    }, UNIX_GRACEFUL_SHUTDOWN_MS);
    forceKill.unref();
  };

  const stop = (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) terminate(child);
    setExitCode(exitCode);
  };

  for (const plan of plans) {
    const child = spawnProcess(
      nodeExecutable,
      [plan.entry, ...plan.args],
      plan.options,
    );
    children.push(child);
    child.on("error", (error) => {
      logger.error(`[local] Failed to start ${plan.name}: ${error.message}`);
      forceWindowsCleanup = true;
      stop(1);
    });
    child.on("exit", (code, signal) => {
      exitedChildren.add(child);
      if (stopping) return;
      if (signal) {
        logger.error(`[local] ${plan.name} stopped after signal ${signal}.`);
      } else if (code !== 0) {
        logger.error(`[local] ${plan.name} exited with code ${code ?? 1}.`);
      }
      forceWindowsCleanup = true;
      stop(code === 0 ? 1 : (code ?? 1));
    });
  }

  return { children, stop };
}

function safelyKillServiceProcess(child, logger) {
  if (child.killed || child.pid === undefined) return;
  try {
    child.kill("SIGKILL");
  } catch (error) {
    logger.error(
      `[local] Failed to stop service process PID ${child.pid}: ${String(error)}`,
    );
  }
}
