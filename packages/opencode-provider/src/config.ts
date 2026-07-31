const DEFAULT_USERNAME = "opencode";

export const OPENCODE_ENDPOINT_ENV = "OPENCODE_ENDPOINT";
export const OPENCODE_USERNAME_ENV = "OPENCODE_SERVER_USERNAME";
export const OPENCODE_PASSWORD_ENV = "OPENCODE_SERVER_PASSWORD";

export interface OpenCodeEnvironment {
  readonly OPENCODE_ENDPOINT?: string;
  readonly OPENCODE_SERVER_USERNAME?: string;
  readonly OPENCODE_SERVER_PASSWORD?: string;
}

export interface OpenCodeConnectionConfig {
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export class OpenCodeConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpenCodeConfigurationError";
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (normalized === "localhost" || normalized === "[::1]") {
    return true;
  }

  const octets = normalized.split(".");
  if (octets.length !== 4 || octets[0] !== "127") {
    return false;
  }

  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) {
      return false;
    }

    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

/**
 * Accepts only an explicitly configured HTTP endpoint on the local machine.
 * Credentials and paths are intentionally excluded from the endpoint value.
 */
export function validateOpenCodeEndpoint(value: string): string {
  const trimmed = value.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new OpenCodeConfigurationError(
      "OpenCode endpoint must be a valid URL",
    );
  }

  if (url.protocol !== "http:") {
    throw new OpenCodeConfigurationError("OpenCode endpoint must use http");
  }

  if (!isLoopbackHostname(url.hostname)) {
    throw new OpenCodeConfigurationError(
      "OpenCode endpoint must use a loopback host",
    );
  }

  if (url.username !== "" || url.password !== "") {
    throw new OpenCodeConfigurationError(
      "OpenCode endpoint must not contain credentials",
    );
  }

  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new OpenCodeConfigurationError(
      "OpenCode endpoint must not contain a path, query, or fragment",
    );
  }

  return url.origin;
}

function encodeBasicCredentials(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, "utf8").toString("base64");
}

export function resolveOpenCodeConnection(
  endpoint: string | undefined,
  env: OpenCodeEnvironment = process.env,
): OpenCodeConnectionConfig {
  const configuredEndpoint = endpoint ?? env.OPENCODE_ENDPOINT;
  if (configuredEndpoint === undefined || configuredEndpoint.trim() === "") {
    throw new OpenCodeConfigurationError(
      `OpenCode endpoint is required (option or ${OPENCODE_ENDPOINT_ENV})`,
    );
  }

  const normalizedEndpoint = validateOpenCodeEndpoint(configuredEndpoint);
  const password = env.OPENCODE_SERVER_PASSWORD;

  if (password === undefined || password === "") {
    return { endpoint: normalizedEndpoint };
  }

  const username = env.OPENCODE_SERVER_USERNAME?.trim() || DEFAULT_USERNAME;
  return {
    endpoint: normalizedEndpoint,
    headers: {
      Authorization: `Basic ${encodeBasicCredentials(username, password)}`,
    },
  };
}
