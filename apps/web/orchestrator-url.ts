const defaultOrchestratorUrl = "http://127.0.0.1:8787";
const loopbackHostnames: Readonly<Record<string, true>> = {
  "127.0.0.1": true,
  "[::1]": true,
  localhost: true,
};

export function validateOrchestratorUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const mode = environment.ORCHESTRATOR_BIND_MODE ?? "direct";
  if (mode !== "direct" && mode !== "container-loopback-published") {
    throw new Error(
      "ORCHESTRATOR_BIND_MODE must be direct or container-loopback-published",
    );
  }

  const value = environment.ORCHESTRATOR_URL ?? defaultOrchestratorUrl;
  if (mode === "container-loopback-published") {
    const match = /^http:\/\/orchestrator:([1-9]\d{0,4})$/u.exec(value);
    const port = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(port) || port > 65_535) {
      throw new Error(
        "ORCHESTRATOR_URL must be http://orchestrator:<port> in container-loopback-published mode",
      );
    }
    return value;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !loopbackHostnames[url.hostname] ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.origin !== value
    ) {
      throw new Error("invalid direct orchestrator URL");
    }
    return value;
  } catch {
    throw new Error("ORCHESTRATOR_URL must be an HTTP loopback origin");
  }
}
