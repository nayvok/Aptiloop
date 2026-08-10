import { spawn } from "node:child_process";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

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

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  terminate(app);
  process.exitCode = exitCode;
}

const localEnvironment = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "development",
};
const turboArguments = ["exec", "--", "turbo", "run", "dev", "--parallel"];

app = process.env.npm_execpath
  ? spawn(process.execPath, [process.env.npm_execpath, ...turboArguments], {
      env: localEnvironment,
      stdio: "inherit",
      windowsHide: true,
    })
  : spawnCommand("npm", turboArguments, localEnvironment);
app.on("error", (error) => {
  console.error(`[local] Failed to start Aptiloop: ${error.message}`);
  stop(1);
});
app.on("exit", (code) => stop(code ?? 0));

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
