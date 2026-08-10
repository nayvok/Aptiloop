import { describe, expect, it } from "vitest";

import { parseOrchestratorStartupConfig } from "../src/startup-boundary.js";

describe("orchestrator startup boundary", () => {
  it("defaults direct startup to the loopback interface", () => {
    expect(parseOrchestratorStartupConfig({})).toEqual({
      bindMode: "direct",
      hostname: "127.0.0.1",
      port: 8787,
    });
  });

  it.each(["127.0.0.1", "::1", "localhost"])(
    "accepts the direct loopback host %s",
    (hostname) => {
      expect(parseOrchestratorStartupConfig({ HOST: hostname })).toMatchObject({
        bindMode: "direct",
        hostname,
      });
    },
  );

  it.each([
    "0.0.0.0",
    "::",
    "192.168.1.20",
    "example.test",
    "127.0.0.1.example.test",
    "[::1]",
    "constructor",
    "toString",
    "__proto__",
    "",
  ])("rejects the non-loopback direct host %j", (hostname) => {
    expect(() => parseOrchestratorStartupConfig({ HOST: hostname })).toThrow(
      "HOST must be a loopback host in direct mode",
    );
  });

  it("allows only the explicit Compose wildcard mode", () => {
    expect(
      parseOrchestratorStartupConfig({
        HOST: "0.0.0.0",
        ORCHESTRATOR_BIND_MODE: "container-loopback-published",
      }),
    ).toEqual({
      bindMode: "container-loopback-published",
      hostname: "0.0.0.0",
      port: 8787,
    });
    expect(() =>
      parseOrchestratorStartupConfig({
        HOST: "127.0.0.1",
        ORCHESTRATOR_BIND_MODE: "container-loopback-published",
      }),
    ).toThrow("HOST must be 0.0.0.0 in container-loopback-published mode");
  });

  it.each([
    "0",
    "65536",
    "-1",
    "1.5",
    "NaN",
    "8787suffix",
    " 8787",
    "8787 ",
    "",
  ])("rejects the invalid port %j", (port) => {
    expect(() => parseOrchestratorStartupConfig({ PORT: port })).toThrow(
      "PORT must be an integer from 1 through 65535",
    );
  });

  it.each(["1", "65535"])("accepts boundary port %s", (port) => {
    expect(parseOrchestratorStartupConfig({ PORT: port }).port).toBe(
      Number(port),
    );
  });

  it("rejects an unknown bind mode", () => {
    expect(() =>
      parseOrchestratorStartupConfig({ ORCHESTRATOR_BIND_MODE: "proxy" }),
    ).toThrow(
      "ORCHESTRATOR_BIND_MODE must be direct or container-loopback-published",
    );
  });
});
