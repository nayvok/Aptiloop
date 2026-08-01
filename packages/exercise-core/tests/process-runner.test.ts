import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { AllowedProcessRunner } from "../src/process-runner.js";

const cwd = await mkdtemp(path.join(tmpdir(), "dlh-process-runner-"));

afterAll(async () => await rm(cwd, { recursive: true, force: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AllowedProcessRunner", () => {
  it("does not inherit provider credentials or other secret environment values", async () => {
    const runner = new AllowedProcessRunner(
      {
        environment: {
          executable: process.execPath,
          args: [
            "-e",
            "process.stdout.write(JSON.stringify({ path: Boolean(process.env.PATH), token: process.env.OPENAI_API_KEY, password: process.env.DLH_TEST_PASSWORD, auth: process.env.PROVIDER_AUTH }))",
          ],
        },
      },
      {
        baseEnv: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          OPENAI_API_KEY: "provider-secret",
          DLH_TEST_PASSWORD: "password-secret",
          PROVIDER_AUTH: "auth-secret",
        },
      },
    );

    const result = await runner.run("environment", { cwd });
    expect(JSON.parse(result.stdout)).toEqual({ path: true });
  });

  it("rejects explicitly configured secret-shaped environment variables", () => {
    expect(
      () =>
        new AllowedProcessRunner({
          unsafe: {
            executable: process.execPath,
            args: ["--version"],
            env: { PROVIDER_TOKEN: "must-not-leak" },
          },
        }),
    ).toThrow("Sensitive child environment variable is not allowed");
  });

  it("runs only the fixed executable and arguments configured by the server", async () => {
    const runner = new AllowedProcessRunner({
      unit: {
        executable: process.execPath,
        args: [
          "-e",
          "process.stdout.write(process.argv[1])",
          "safe;not-a-shell",
        ],
      },
    });

    await expect(runner.run("arbitrary-user-value", { cwd })).rejects.toThrow(
      "not allowlisted",
    );
    await expect(runner.run("unit", { cwd })).resolves.toMatchObject({
      exitCode: 0,
      stdout: "safe;not-a-shell",
      terminationReason: "exit",
    });
  });

  it("terminates commands at the output cap", async () => {
    const runner = new AllowedProcessRunner({
      noisy: {
        executable: process.execPath,
        args: [
          "-e",
          "process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000)",
        ],
        maxOutputBytes: 64,
      },
    });
    const result = await runner.run("noisy", { cwd });
    expect(
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
    ).toBeLessThanOrEqual(64);
    expect(result).toMatchObject({
      terminationReason: "output_limit",
      truncated: true,
    });
  });

  it("terminates a command when its timeout expires", async () => {
    const runner = new AllowedProcessRunner({
      timeout: {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        timeoutMs: 1_000,
      },
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = runner.run("timeout", { cwd });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({
      terminationReason: "timeout",
    });
  });

  it("supports AbortSignal cancellation", async () => {
    const runner = new AllowedProcessRunner({
      cancelled: {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      },
    });

    const controller = new AbortController();
    const pending = runner.run("cancelled", { cwd, signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      terminationReason: "cancelled",
    });
  });

  it("does not spawn a command for an already-aborted signal", async () => {
    const marker = path.join(cwd, `pre-aborted-${crypto.randomUUID()}`);
    const runner = new AllowedProcessRunner({
      "side-effect": {
        executable: process.execPath,
        args: [
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
        ],
      },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      runner.run("side-effect", { cwd, signal: controller.signal }),
    ).resolves.toMatchObject({ terminationReason: "cancelled" });
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("clears a pending force-kill timer when the original child exits", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const runner = new AllowedProcessRunner({
      cancelled: {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      },
    });
    const controller = new AbortController();
    const pending = runner.run("cancelled", { cwd, signal: controller.signal });

    controller.abort();
    await expect(pending).resolves.toMatchObject({
      terminationReason: "cancelled",
    });

    const forceKillCallIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, delay]) => delay === 1_000,
    );
    if (process.platform === "win32") {
      expect(forceKillCallIndex).toBe(-1);
    } else {
      expect(forceKillCallIndex).toBeGreaterThanOrEqual(0);
      const forceKillTimer = setTimeoutSpy.mock.results[forceKillCallIndex]
        ?.value as NodeJS.Timeout;
      expect(clearTimeoutSpy).toHaveBeenCalledWith(forceKillTimer);
    }
  });
});
