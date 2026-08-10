import { isIP } from "node:net";

import type { OrchestratorStartupConfig } from "./startup-boundary.js";

const canonicalForwardedHeaders: Readonly<Record<string, true>> = {
  "x-forwarded-for": true,
  "x-forwarded-host": true,
  "x-forwarded-port": true,
  "x-forwarded-proto": true,
};

export interface ApiRequestBoundary {
  bindMode: OrchestratorStartupConfig["bindMode"];
  requestAuthority: string;
  requestUrlAuthority: string;
  forwardedHost: string;
  forwardedPort: string;
  forwardedProtocol: string;
}

export type ApiRequestBoundaryError =
  "Request authority is invalid" | "Forwarding headers are invalid";

export function createApiRequestBoundary(
  startup: OrchestratorStartupConfig,
  webOrigin: string,
): ApiRequestBoundary {
  const requestAuthority = requestAuthorityForStartup(startup);
  const origin = new URL(webOrigin);
  return {
    bindMode: startup.bindMode,
    requestAuthority,
    requestUrlAuthority: new URL(`http://${requestAuthority}`).host,
    forwardedHost: origin.host,
    forwardedPort: origin.port || "80",
    forwardedProtocol: origin.protocol.slice(0, -1),
  };
}

export function apiRequestBoundaryError(
  request: Request,
  boundary: ApiRequestBoundary,
): ApiRequestBoundaryError | undefined {
  if (!hasExpectedRequestAuthority(request, boundary)) {
    return "Request authority is invalid";
  }
  if (!hasExpectedForwarding(request.headers, boundary)) {
    return "Forwarding headers are invalid";
  }
  return undefined;
}

function requestAuthorityForStartup(
  startup: OrchestratorStartupConfig,
): string {
  if (
    !Number.isInteger(startup.port) ||
    startup.port < 1 ||
    startup.port > 65_535
  ) {
    throw new Error(
      "HTTP boundary port must be an integer from 1 through 65535",
    );
  }
  if (
    startup.bindMode !== "direct" &&
    startup.bindMode !== "container-loopback-published"
  ) {
    throw new Error("HTTP boundary bind mode is invalid");
  }

  if (startup.bindMode === "container-loopback-published") {
    if (startup.hostname !== "0.0.0.0") {
      throw new Error("Compose HTTP boundary requires the 0.0.0.0 bind host");
    }
    return `orchestrator:${startup.port}`;
  }

  if (
    startup.hostname !== "127.0.0.1" &&
    startup.hostname !== "localhost" &&
    startup.hostname !== "::1"
  ) {
    throw new Error(
      "Direct HTTP boundary requires an exact loopback bind host",
    );
  }
  const authorityHost = startup.hostname === "::1" ? "[::1]" : startup.hostname;
  return `${authorityHost}:${startup.port}`;
}

function hasExpectedRequestAuthority(
  request: Request,
  boundary: ApiRequestBoundary,
): boolean {
  if (request.headers.get("Host") !== boundary.requestAuthority) return false;

  try {
    const url = new URL(request.url);
    return (
      url.protocol === "http:" &&
      url.username === "" &&
      url.password === "" &&
      url.host === boundary.requestUrlAuthority
    );
  } catch {
    return false;
  }
}

function hasExpectedForwarding(
  headers: Headers,
  boundary: ApiRequestBoundary,
): boolean {
  if (headers.has("Forwarded") || headers.has("X-Real-IP")) return false;

  let hasExtraForwardedHeader = false;
  headers.forEach((_value, name) => {
    if (name.startsWith("x-forwarded-") && !canonicalForwardedHeaders[name]) {
      hasExtraForwardedHeader = true;
    }
  });
  if (hasExtraForwardedHeader) return false;

  const forwardedFor = headers.get("X-Forwarded-For");
  const forwardedHost = headers.get("X-Forwarded-Host");
  const forwardedPort = headers.get("X-Forwarded-Port");
  const forwardedProtocol = headers.get("X-Forwarded-Proto");
  const hasHostOnlyForwarding =
    forwardedHost === boundary.forwardedHost &&
    forwardedFor === null &&
    forwardedPort === null &&
    forwardedProtocol === null;
  if (hasHostOnlyForwarding) return true;

  if (boundary.bindMode === "direct") {
    return (
      forwardedFor === null &&
      forwardedHost === null &&
      forwardedPort === null &&
      forwardedProtocol === null
    );
  }

  return (
    forwardedFor !== null &&
    forwardedHost === boundary.forwardedHost &&
    forwardedPort === boundary.forwardedPort &&
    forwardedProtocol === boundary.forwardedProtocol &&
    isPrivateProxyAddress(forwardedFor)
  );
}

function isPrivateProxyAddress(value: string): boolean {
  if (value.includes(",") || value.trim() !== value) return false;
  if (isPrivateIpv4Address(value)) return true;
  if (value === "::1") return true;

  const normalized = value.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4Address(normalized.slice("::ffff:".length));
  }
  return (
    isIP(normalized) === 6 &&
    (normalized.startsWith("fc") || normalized.startsWith("fd"))
  );
}

function isPrivateIpv4Address(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  const first = octets[0]!;
  const second = octets[1]!;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
