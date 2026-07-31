import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { AllowedProcessRunner } from "../src/process-runner.js";

const cwd = await mkdtemp(path.join(tmpdir(), "dlh-process-runner-"));

afterAll(async () => await rm(cwd, { recursive: true, force: true }));

describe("AllowedProcessRunner", () => {
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

  it("supports timeout and AbortSignal cancellation", async () => {
    const runner = new AllowedProcessRunner({
      timeout: {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        timeoutMs: 25,
      },
      cancelled: {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      },
    });
    await expect(runner.run("timeout", { cwd })).resolves.toMatchObject({
      terminationReason: "timeout",
    });

    const controller = new AbortController();
    const pending = runner.run("cancelled", { cwd, signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      terminationReason: "cancelled",
    });
  });
});
