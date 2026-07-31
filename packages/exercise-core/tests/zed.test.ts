import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildZedOpenPlan } from "../src/zed.js";

describe("buildZedOpenPlan", () => {
  it("builds a shell-free invocation and a copy-path fallback", () => {
    const workspace = path.resolve("exercise with spaces");
    const plan = buildZedOpenPlan(workspace, {
      executable: "zed",
      args: ["--new"],
    });
    expect(plan).toEqual({
      executable: "zed",
      args: ["--new", workspace],
      shell: false,
      absoluteWorkspacePath: workspace,
      fallback: {
        kind: "copy_path",
        path: workspace,
        message:
          "Zed could not be started. Copy this path and open it manually in Zed.",
      },
    });
  });

  it.each(["zed && calc", "zed; rm -rf /", "zed | other"])(
    "rejects a shell command in the executable setting: %s",
    (command) => {
      expect(() =>
        buildZedOpenPlan(path.resolve("exercise"), { executable: command }),
      ).toThrow("not a shell command");
    },
  );
});
