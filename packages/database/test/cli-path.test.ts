import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabasePath } from "../src/cli/path.js";

describe("database CLI path", () => {
  it("resolves the default database from the project root, not workspace cwd", () => {
    expect(
      getDatabasePath({ projectRoot: "C:/project/dev-learning-harness" }),
    ).toBe(
      resolve(
        "C:/project/dev-learning-harness",
        ".data/dev-learning-harness.sqlite",
      ),
    );
  });

  it("keeps explicit absolute, file and in-memory database paths", () => {
    const absolute = resolve("C:/fixtures/user.sqlite");
    expect(
      getDatabasePath({ configuredPath: absolute, projectRoot: "C:/project" }),
    ).toBe(absolute);
    expect(
      getDatabasePath({
        configuredPath: `file:${absolute}`,
        projectRoot: "C:/project",
      }),
    ).toBe(absolute);
    expect(
      getDatabasePath({
        configuredPath: ":memory:",
        projectRoot: "C:/project",
      }),
    ).toBe(":memory:");
  });
});
