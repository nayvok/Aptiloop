const LAUNCHER_OWNED_ENVIRONMENT = [
  "APTILOOP_RELEASE_ROOT",
  "APTILOOP_DATA_DIR",
  "APTILOOP_RUNTIME_LAUNCHER",
  "APTILOOP_BOOTSTRAP_ENTRY",
  "APTILOOP_CLI_ENTRY",
  "DATABASE_PATH",
  "DATABASE_URL",
  "APTILOOP_PORT",
  "APTILOOP_ORCHESTRATOR_PORT",
  "HOST",
  "PORT",
  "WEB_ORIGIN",
  "ORCHESTRATOR_URL",
];

export function stableLauncherEnvironment(inherited, runtimeRoot, launcher) {
  const environment = { ...inherited };
  for (const key of LAUNCHER_OWNED_ENVIRONMENT) delete environment[key];
  return {
    ...environment,
    APTILOOP_RUNTIME_ROOT: runtimeRoot,
    APTILOOP_RUNTIME_LAUNCHER: launcher,
    APTILOOP_BOOTSTRAP_ENTRY: launcher,
  };
}
