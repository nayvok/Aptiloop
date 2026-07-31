const ESSENTIAL_ENVIRONMENT_NAMES = new Set([
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);

const SECRET_ENVIRONMENT_NAME =
  /(?:^|_)(?:API_?KEY|AUTH|AUTHORIZATION|CREDENTIALS?|PASS(?:WORD|WD)?|PRIVATE_?KEY|SECRET|TOKEN)(?:_|$)/iu;

export interface SanitizedChildEnvironmentOptions {
  readonly source?: Readonly<NodeJS.ProcessEnv>;
  readonly overrides?: Readonly<Record<string, string>>;
}

/** Builds the minimal environment inherited by trusted exercise processes. */
export function createSanitizedChildEnvironment(
  options: SanitizedChildEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const environment: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      ESSENTIAL_ENVIRONMENT_NAMES.has(name.toUpperCase()) &&
      !isSensitiveEnvironmentName(name)
    ) {
      environment[name] = value;
    }
  }

  for (const [name, value] of Object.entries(options.overrides ?? {})) {
    assertSafeEnvironmentName(name);
    environment[name] = value;
  }

  return environment;
}

export function isSensitiveEnvironmentName(name: string): boolean {
  return SECRET_ENVIRONMENT_NAME.test(name);
}

export function assertSafeEnvironmentName(name: string): void {
  // eslint-disable-next-line no-control-regex -- environment keys must be plain names.
  if (name.length === 0 || name.includes("=") || /[\u0000\r\n]/u.test(name)) {
    throw new TypeError("Invalid child environment variable name.");
  }
  if (isSensitiveEnvironmentName(name)) {
    throw new TypeError(
      `Sensitive child environment variable is not allowed: ${name}`,
    );
  }
}
