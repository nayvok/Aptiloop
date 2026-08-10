const E2E_BASE_ENVIRONMENT_NAMES = Object.freeze([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PLAYWRIGHT_BROWSERS_PATH",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

export function createE2EEnvironment(source, explicit = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("The E2E source environment must be an object");
  }
  if (!explicit || typeof explicit !== "object" || Array.isArray(explicit)) {
    throw new TypeError("The explicit E2E environment must be an object");
  }

  const environment = {};
  for (const name of E2E_BASE_ENVIRONMENT_NAMES) {
    const value = source[name];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new TypeError(`E2E environment ${name} must be a string`);
    }
    environment[name] = value;
  }
  for (const [name, value] of Object.entries(explicit)) {
    if (typeof value !== "string") {
      throw new TypeError(`Explicit E2E environment ${name} must be a string`);
    }
    environment[name] = value;
  }
  return environment;
}
