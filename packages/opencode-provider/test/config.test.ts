import { describe, expect, it } from "vitest";

import {
  OpenCodeConfigurationError,
  resolveOpenCodeConnection,
  validateOpenCodeEndpoint,
} from "../src/config.js";

describe("validateOpenCodeEndpoint", () => {
  it.each([
    ["http://localhost:4096", "http://localhost:4096"],
    [" http://127.0.0.1:4096/ ", "http://127.0.0.1:4096"],
    ["http://127.42.0.9:8080", "http://127.42.0.9:8080"],
    ["http://[::1]:4096", "http://[::1]:4096"],
  ])("accepts loopback endpoint %s", (input, expected) => {
    expect(validateOpenCodeEndpoint(input)).toBe(expected);
  });

  it.each([
    "https://localhost:4096",
    "http://example.com:4096",
    "http://opencode.localhost:4096",
    "http://0.0.0.0:4096",
    "http://localhost:4096/api",
    "http://localhost:4096?token=secret",
    "http://user:password@localhost:4096",
  ])("rejects unsafe endpoint %s", (input) => {
    expect(() => validateOpenCodeEndpoint(input)).toThrow(
      OpenCodeConfigurationError,
    );
  });
});

describe("resolveOpenCodeConnection", () => {
  it("reads the endpoint and Basic auth credentials from the environment", () => {
    expect(
      resolveOpenCodeConnection(undefined, {
        OPENCODE_ENDPOINT: "http://localhost:4096",
        OPENCODE_SERVER_USERNAME: "teacher",
        OPENCODE_SERVER_PASSWORD: "local-secret",
      }),
    ).toEqual({
      endpoint: "http://localhost:4096",
      headers: {
        Authorization: "Basic dGVhY2hlcjpsb2NhbC1zZWNyZXQ=",
      },
    });
  });

  it("uses OpenCode's documented default username when only password is set", () => {
    expect(
      resolveOpenCodeConnection("http://127.0.0.1:4096", {
        OPENCODE_SERVER_PASSWORD: "secret",
      }).headers,
    ).toEqual({ Authorization: "Basic b3BlbmNvZGU6c2VjcmV0" });
  });

  it("does not add Authorization without a password", () => {
    expect(
      resolveOpenCodeConnection("http://127.0.0.1:4096", {
        OPENCODE_SERVER_USERNAME: "ignored",
      }),
    ).toEqual({ endpoint: "http://127.0.0.1:4096" });
  });
});
