import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import {
  createProductionBuildPlan,
  createProductionServicePlans,
  launchProcessGroup,
} from "./local-process-launcher.mjs";

test("builds fixed production plans from hostile ambient configuration", () => {
  const projectRoot = path.resolve("C:/aptiloop-test-root");
  const plans = createProductionServicePlans(
    projectRoot,
    {
      PATH: "path-sentinel",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      NODE_ENV: "development",
      HOST: "0.0.0.0",
      HOSTNAME: "0.0.0.0",
      PORT: "9999",
      WEB_ORIGIN: "http://example.test",
      ORCHESTRATOR_URL: "http://example.test",
      ORCHESTRATOR_BIND_MODE: "container-loopback-published",
      DATABASE_PATH: "C:/wrong/database.sqlite",
      DATABASE_URL: "C:/wrong/database.sqlite",
      WORKSPACE_ROOT: "C:/wrong/workspaces",
      EXERCISE_ATTEMPTS_ROOT: "C:/wrong/attempts",
      ZED_EXECUTABLE: "C:/wrong/zed.exe",
      OPENCODE_ENDPOINT: "https://wrong.example.test",
      NEXT_DIST_DIR: ".wrong-next",
      OPENAI_API_KEY: "openai-secret-sentinel",
      OPENCODE_API_KEY: "opencode-secret-sentinel",
      SECRET: "generic-secret-sentinel",
      HTTPS_PROXY: "https://proxy-user:proxy-secret@example.test",
      HTTP_PROXY: "http://proxy-user:proxy-secret@example.test",
      ALL_PROXY: "socks5://proxy-user:proxy-secret@example.test",
      NO_PROXY: "metadata.internal",
      npm_config_proxy: "http://npm-proxy-secret@example.test",
      NODE_OPTIONS: "--require=C:/hostile/inject.cjs",
      SSH_AUTH_SOCK: "C:/hostile/agent.sock",
      UNRELATED_HOST_VALUE: "ambient-sentinel",
    },
    "win32",
  );

  assert.equal(plans.length, 2);
  for (const plan of plans) {
    assert.equal(plan.options.shell, false);
    assert.equal(plan.options.detached, false);
    assert.equal(plan.options.env.PATH, "path-sentinel");
    assert.equal(plan.options.env.SYSTEMROOT, "C:\\Windows");
    assert.equal(plan.options.env.TEMP, "C:\\Temp");
    assert.equal(plan.options.env.NODE_ENV, "production");
    assert.equal(plan.options.env.HOST, "127.0.0.1");
    assert.equal(plan.options.env.HOSTNAME, "127.0.0.1");
    assert.equal(plan.options.env.WEB_ORIGIN, "http://127.0.0.1:3000");
    assert.equal(plan.options.env.ORCHESTRATOR_URL, "http://127.0.0.1:8787");
    assert.equal(plan.options.env.ORCHESTRATOR_BIND_MODE, "direct");
    assert.equal(
      plan.options.env.DATABASE_PATH,
      path.join(projectRoot, ".data", "dev-learning-harness.sqlite"),
    );
    assert.equal(
      plan.options.env.DATABASE_URL,
      path.join(projectRoot, ".data", "dev-learning-harness.sqlite"),
    );
    assert.equal(
      plan.options.env.WORKSPACE_ROOT,
      path.join(projectRoot, "workspaces", "exercises"),
    );
    assert.equal(
      plan.options.env.EXERCISE_ATTEMPTS_ROOT,
      path.join(projectRoot, ".data", "exercise-attempts"),
    );
    assert.equal(plan.options.env.ZED_EXECUTABLE, "zed");
    assert.equal(plan.options.env.NEXT_DIST_DIR, ".next");
    for (const deniedName of [
      "OPENAI_API_KEY",
      "OPENCODE_API_KEY",
      "SECRET",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "npm_config_proxy",
      "NODE_OPTIONS",
      "SSH_AUTH_SOCK",
      "UNRELATED_HOST_VALUE",
      "OPENCODE_ENDPOINT",
    ]) {
      assert.equal(plan.options.env[deniedName], undefined, deniedName);
    }
  }
  assert.equal(plans[0].options.env.PORT, "8787");
  assert.equal(plans[0].options.cwd, projectRoot);
  assert.deepEqual(plans[1].args, ["start", "--hostname", "127.0.0.1"]);
  assert.equal(plans[1].options.env.PORT, "3000");
  assert.equal(plans[1].options.cwd, path.join(projectRoot, "apps", "web"));
});

test("preserves case-sensitive Unix runtime variables without widening the allowlist", () => {
  const projectRoot = path.resolve("/opt/aptiloop");
  const plans = createProductionServicePlans(
    projectRoot,
    {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/aptiloop",
      TMPDIR: "/tmp/aptiloop",
      LANG: "en_US.UTF-8",
      DISPLAY: ":1",
      WAYLAND_DISPLAY: "wayland-1",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      path: "hostile-lowercase-path",
      openai_api_key: "lowercase-secret-sentinel",
      HTTP_PROXY: "http://proxy-secret.example.test",
    },
    "linux",
  );

  for (const plan of plans) {
    assert.equal(plan.options.env.PATH, "/usr/local/bin:/usr/bin");
    assert.equal(plan.options.env.HOME, "/home/aptiloop");
    assert.equal(plan.options.env.TMPDIR, "/tmp/aptiloop");
    assert.equal(plan.options.env.LANG, "en_US.UTF-8");
    assert.equal(plan.options.env.path, undefined);
    assert.equal(plan.options.env.openai_api_key, undefined);
    assert.equal(plan.options.env.HTTP_PROXY, undefined);
  }
  assert.equal(plans[0].options.env.DISPLAY, ":1");
  assert.equal(plans[0].options.env.WAYLAND_DISPLAY, "wayland-1");
  assert.equal(plans[0].options.env.XDG_RUNTIME_DIR, "/run/user/1000");
  assert.equal(
    plans[0].options.env.DBUS_SESSION_BUS_ADDRESS,
    "unix:path=/run/user/1000/bus",
  );
  for (const name of [
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
  ]) {
    assert.equal(plans[1].options.env[name], undefined, name);
  }
});

test("builds production artifacts with the same fixed environment as runtime", () => {
  const projectRoot = path.resolve("C:/aptiloop-test-root");
  const plan = createProductionBuildPlan(
    projectRoot,
    {
      PATH: "path-sentinel",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      NODE_ENV: "development",
      ORCHESTRATOR_URL: "http://127.0.0.1:9999",
      NEXT_DIST_DIR: ".hostile-next",
      OPENAI_API_KEY: "openai-secret-sentinel",
      OPENCODE_API_KEY: "opencode-secret-sentinel",
      HTTPS_PROXY: "https://proxy-user:proxy-secret@example.test",
      NODE_OPTIONS: "--require=C:/hostile/inject.cjs",
    },
    "win32",
  );

  assert.equal(
    plan.entry,
    path.join(projectRoot, "node_modules", "turbo", "bin", "turbo"),
  );
  assert.deepEqual(plan.args, ["run", "build"]);
  assert.equal(plan.options.cwd, projectRoot);
  assert.equal(plan.options.shell, false);
  assert.equal(plan.options.env.PATH, "path-sentinel");
  assert.equal(plan.options.env.SYSTEMROOT, "C:\\Windows");
  assert.equal(plan.options.env.TEMP, "C:\\Temp");
  assert.equal(plan.options.env.NODE_ENV, "production");
  assert.equal(plan.options.env.ORCHESTRATOR_URL, "http://127.0.0.1:8787");
  assert.equal(plan.options.env.NEXT_DIST_DIR, ".next");
  for (const deniedName of [
    "OPENAI_API_KEY",
    "OPENCODE_API_KEY",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
  ]) {
    assert.equal(plan.options.env[deniedName], undefined, deniedName);
  }
});

test("stops the sibling process tree when a production service exits", () => {
  const serviceChildren = [new FakeChild(4101), new FakeChild(4102)];
  const calls = [];
  let exitCode;
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "taskkill.exe") return new FakeChild(5100);
    return serviceChildren.shift();
  };
  const plans = [
    fakePlan("orchestrator", "orchestrator.js"),
    fakePlan("web", "web.js"),
  ];

  const application = launchProcessGroup(plans, {
    nodeExecutable: "node.exe",
    platform: "win32",
    spawnProcess,
    logger: { error() {} },
    setExitCode(code) {
      exitCode = code;
    },
  });
  application.children[0].emit("exit", 17, null);

  assert.equal(exitCode, 17);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], {
    command: "node.exe",
    args: ["orchestrator.js"],
    options: plans[0].options,
  });
  assert.deepEqual(calls[1], {
    command: "node.exe",
    args: ["web.js"],
    options: plans[1].options,
  });
  assert.deepEqual(calls[2], {
    command: "taskkill.exe",
    args: ["/pid", "4102", "/t", "/f"],
    options: { shell: false, stdio: "ignore", windowsHide: true },
  });
});

test("gives shared-console Windows children time to stop before taskkill", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const services = [new FakeChild(5101), new FakeChild(5102)];
  const calls = [];
  const application = launchProcessGroup(
    [fakePlan("orchestrator", "a.js"), fakePlan("web", "b.js")],
    {
      nodeExecutable: "node.exe",
      platform: "win32",
      spawnProcess(command, args) {
        calls.push({ command, args });
        if (command === "taskkill.exe") return new FakeChild(6100);
        return services.shift();
      },
      logger: { error() {} },
      setExitCode() {},
    },
  );

  application.stop(0);
  assert.equal(calls.length, 2);
  context.mock.timers.tick(29_999);
  assert.equal(calls.length, 2);
  application.children[0].emit("exit", 0, null);
  context.mock.timers.tick(1);
  assert.deepEqual(calls.slice(2), [
    { command: "taskkill.exe", args: ["/pid", "5102", "/t", "/f"] },
  ]);
});

test("logs taskkill spawn errors and falls back without an unhandled error", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const services = [new FakeChild(5201), new FakeChild(5202)];
  const errors = [];
  const application = launchProcessGroup(
    [fakePlan("orchestrator", "a.js"), fakePlan("web", "b.js")],
    {
      nodeExecutable: "node.exe",
      platform: "win32",
      spawnProcess(command) {
        if (command === "taskkill.exe") {
          const killer = new FakeChild(6200);
          queueMicrotask(() =>
            killer.emit("error", new Error("taskkill missing")),
          );
          return killer;
        }
        return services.shift();
      },
      logger: {
        error(message) {
          errors.push(message);
        },
      },
      setExitCode() {},
    },
  );

  application.stop(0);
  context.mock.timers.tick(30_000);
  return new Promise((resolve) =>
    queueMicrotask(() => {
      assert.equal(
        application.children.every((child) => child.killed),
        true,
      );
      assert.equal(errors.length, 2);
      assert.equal(
        errors.every((message) => message.includes("taskkill missing")),
        true,
      );
      resolve();
    }),
  );
});

test("logs nonzero taskkill exits and falls back to the service process", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const services = [new FakeChild(5301), new FakeChild(5302)];
  const killers = [];
  const errors = [];
  const application = launchProcessGroup(
    [fakePlan("orchestrator", "a.js"), fakePlan("web", "b.js")],
    {
      nodeExecutable: "node.exe",
      platform: "win32",
      spawnProcess(command) {
        if (command === "taskkill.exe") {
          const killer = new FakeChild(6300 + killers.length);
          killers.push(killer);
          return killer;
        }
        return services.shift();
      },
      logger: {
        error(message) {
          errors.push(message);
        },
      },
      setExitCode() {},
    },
  );

  application.stop(0);
  context.mock.timers.tick(30_000);
  killers.forEach((killer) => killer.emit("exit", 5, null));
  assert.equal(
    application.children.every((child) => child.killed),
    true,
  );
  assert.equal(errors.length, 2);
  assert.equal(
    errors.every((message) => message.includes("exited with code 5")),
    true,
  );
});

test("uses a detached process group and escalates Unix cleanup", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const children = [new FakeChild(6101), new FakeChild(6102)];
  const signals = [];
  const plans = [fakePlan("orchestrator", "a.js"), fakePlan("web", "b.js")];
  const application = launchProcessGroup(plans, {
    nodeExecutable: "node",
    platform: "linux",
    spawnProcess() {
      return children.shift();
    },
    killProcess(pid, signal) {
      signals.push({ pid, signal });
    },
    logger: { error() {} },
    setExitCode() {},
  });

  application.stop(0);
  assert.deepEqual(signals, [
    { pid: -6101, signal: "SIGTERM" },
    { pid: -6102, signal: "SIGTERM" },
  ]);
  context.mock.timers.tick(29_999);
  assert.equal(signals.length, 2);
  context.mock.timers.tick(1);
  assert.deepEqual(signals.slice(2), [
    { pid: -6101, signal: "SIGKILL" },
    { pid: -6102, signal: "SIGKILL" },
  ]);
});

class FakeChild extends EventEmitter {
  killed = false;

  constructor(pid) {
    super();
    this.pid = pid;
  }

  kill() {
    this.killed = true;
    return true;
  }
}

function fakePlan(name, entry) {
  return {
    name,
    entry,
    args: [],
    options: { cwd: ".", env: {}, shell: false },
  };
}
