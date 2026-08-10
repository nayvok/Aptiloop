const directLoopbackHosts: Readonly<Record<string, true>> = {
  "127.0.0.1": true,
  "::1": true,
  localhost: true,
};

export type OrchestratorBindMode = "direct" | "container-loopback-published";

export interface OrchestratorStartupConfig {
  bindMode: OrchestratorBindMode;
  hostname: string;
  port: number;
}

export function parseOrchestratorStartupConfig(
  environment: Readonly<Record<string, string | undefined>>,
): OrchestratorStartupConfig {
  const rawPort = environment.PORT ?? "8787";
  if (!/^[1-9]\d{0,4}$/u.test(rawPort)) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }

  const bindMode = environment.ORCHESTRATOR_BIND_MODE ?? "direct";
  if (bindMode !== "direct" && bindMode !== "container-loopback-published") {
    throw new Error(
      "ORCHESTRATOR_BIND_MODE must be direct or container-loopback-published",
    );
  }

  const hostname = environment.HOST ?? "127.0.0.1";
  if (bindMode === "direct" && !Object.hasOwn(directLoopbackHosts, hostname)) {
    throw new Error("HOST must be a loopback host in direct mode");
  }
  if (bindMode === "container-loopback-published" && hostname !== "0.0.0.0") {
    throw new Error(
      "HOST must be 0.0.0.0 in container-loopback-published mode",
    );
  }

  return { bindMode, hostname, port };
}
