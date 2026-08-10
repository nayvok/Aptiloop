import { describe, expect, it } from "vitest";

import { validateOrchestratorUrl } from "../orchestrator-url";

describe("orchestrator rewrite boundary", () => {
  it("defaults to the direct loopback orchestrator", () => {
    expect(validateOrchestratorUrl({})).toBe("http://127.0.0.1:8787");
  });

  it.each([
    "http://127.0.0.1:1",
    "http://127.0.0.1:65535",
    "http://localhost:8787",
    "http://[::1]:8787",
  ])("accepts direct loopback origin %s", (value) => {
    expect(validateOrchestratorUrl({ ORCHESTRATOR_URL: value })).toBe(value);
  });

  it.each([
    "https://127.0.0.1:8787",
    "http://0.0.0.0:8787",
    "http://192.168.1.20:8787",
    "http://example.test:8787",
    "http://user:password@127.0.0.1:8787",
    "http://127.0.0.1:8787/",
    "http://127.0.0.1:8787/api",
    "http://127.0.0.1:8787?target=remote",
    "http://127.0.0.1:8787#fragment",
    "not-a-url",
  ])("rejects unsafe direct URL %j", (value) => {
    expect(() => validateOrchestratorUrl({ ORCHESTRATOR_URL: value })).toThrow(
      "ORCHESTRATOR_URL must be an HTTP loopback origin",
    );
  });

  it("accepts the exact internal service URL only in the explicit Compose mode", () => {
    const environment = {
      ORCHESTRATOR_BIND_MODE: "container-loopback-published",
      ORCHESTRATOR_URL: "http://orchestrator:8787",
    };
    expect(validateOrchestratorUrl(environment)).toBe(
      "http://orchestrator:8787",
    );
    expect(() =>
      validateOrchestratorUrl({
        ORCHESTRATOR_URL: "http://orchestrator:8787",
      }),
    ).toThrow("ORCHESTRATOR_URL must be an HTTP loopback origin");
  });

  it.each([
    "http://orchestrator",
    "http://orchestrator:0",
    "http://orchestrator:65536",
    "https://orchestrator:8787",
    "http://other-service:8787",
    "http://user@orchestrator:8787",
    "http://orchestrator:8787/",
    "http://orchestrator:8787/api",
    "http://orchestrator:8787?query=1",
    "http://orchestrator:8787#fragment",
  ])("rejects invalid explicit Compose URL %j", (value) => {
    expect(() =>
      validateOrchestratorUrl({
        ORCHESTRATOR_BIND_MODE: "container-loopback-published",
        ORCHESTRATOR_URL: value,
      }),
    ).toThrow(
      "ORCHESTRATOR_URL must be http://orchestrator:<port> in container-loopback-published mode",
    );
  });
});
