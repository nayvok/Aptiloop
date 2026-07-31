import { spawn } from "node:child_process";

import { validateOpenCodeEndpoint } from "@dlh/opencode-provider/config";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const endpoint = validateOpenCodeEndpoint(
  process.env.OPENCODE_ENDPOINT ?? "http://127.0.0.1:4096",
);
const appEnvironment = { ...process.env, OPENCODE_ENDPOINT: endpoint };
const endpointUrl = new URL(endpoint);
const endpointHostname =
  endpointUrl.hostname === "[::1]" ? "::1" : endpointUrl.hostname;
let ownedOpenCode;
let app;
let stopping = false;

function spawnCommand(command, args, env = process.env) {
  if (process.platform === "win32") {
    return spawn(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", command, ...args],
      {
        env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
  }
  return spawn(command, args, {
    env,
    stdio: "inherit",
  });
}

function terminate(child) {
  if (!child || child.killed || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function isOpenCodeReady() {
  try {
    const response = await fetch(new URL("/global/health", endpoint), {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  terminate(app);
  terminate(ownedOpenCode);
  process.exitCode = exitCode;
}

if (await isOpenCodeReady()) {
  console.log(`[local] OpenCode уже доступен: ${endpoint}`);
} else {
  console.log(
    `[local] Запускаю OpenCode: ${endpointHostname}:${endpointUrl.port || "80"}`,
  );
  ownedOpenCode = spawnCommand("opencode", [
    "serve",
    "--hostname",
    endpointHostname,
    "--port",
    endpointUrl.port || "80",
  ]);
  ownedOpenCode.on("error", (error) => {
    console.warn(`[local] OpenCode не запущен: ${error.message}`);
    console.warn("[local] Приложение продолжит работу с Mock/Codex.");
  });
  ownedOpenCode.on("exit", (code) => {
    if (!stopping && code && code !== 0) {
      console.warn(`[local] OpenCode завершился с кодом ${code}.`);
    }
  });
}

app = process.env.npm_execpath
  ? spawn(process.execPath, [process.env.npm_execpath, "run", "dev"], {
      env: appEnvironment,
      stdio: "inherit",
      windowsHide: true,
    })
  : spawnCommand("npm", ["run", "dev"], appEnvironment);
app.on("error", (error) => {
  console.error(`[local] Не удалось запустить приложение: ${error.message}`);
  stop(1);
});
app.on("exit", (code) => stop(code ?? 0));

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
