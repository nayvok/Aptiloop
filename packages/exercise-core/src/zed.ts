import { spawn } from "node:child_process";
import path from "node:path";

export interface ZedCommandConfiguration {
  readonly executable?: string;
  readonly args?: readonly string[];
}

export interface ZedOpenPlan {
  readonly executable: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly absoluteWorkspacePath: string;
  readonly fallback: {
    readonly kind: "copy_path";
    readonly path: string;
    readonly message: string;
  };
}

export interface ZedOpenResult {
  readonly opened: boolean;
  readonly fallback: ZedOpenPlan["fallback"];
  readonly error?: string;
}

export function buildZedOpenPlan(
  absoluteWorkspacePath: string,
  configuration: ZedCommandConfiguration = {},
): ZedOpenPlan {
  if (!path.isAbsolute(absoluteWorkspacePath))
    throw new TypeError("Zed workspace path must be absolute.");
  const executable = configuration.executable ?? "zed";
  validateExecutable(executable);
  const configuredArgs = configuration.args ?? [];
  configuredArgs.forEach(validateArgument);
  const workspacePath = path.normalize(absoluteWorkspacePath);

  return Object.freeze({
    executable,
    args: Object.freeze([...configuredArgs, workspacePath]),
    shell: false as const,
    absoluteWorkspacePath: workspacePath,
    fallback: Object.freeze({
      kind: "copy_path" as const,
      path: workspacePath,
      message:
        "Zed could not be started. Copy this path and open it manually in Zed.",
    }),
  });
}

export async function openInZed(plan: ZedOpenPlan): Promise<ZedOpenResult> {
  return await new Promise<ZedOpenResult>((resolve) => {
    let settled = false;
    const child = spawn(plan.executable, [...plan.args], {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({ opened: false, fallback: plan.fallback, error: error.message });
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({ opened: true, fallback: plan.fallback });
    });
  });
}

function validateExecutable(executable: string): void {
  if (
    executable.length === 0 ||
    executable.trim() !== executable ||
    // eslint-disable-next-line no-control-regex -- executable tokens reject NUL and line breaks.
    /[\u0000\r\n]/u.test(executable)
  ) {
    throw new TypeError("Invalid Zed executable.");
  }
  // A setting is one executable token/path, never a shell command. Absolute
  // paths may legitimately contain spaces; relative command names may not.
  if (!path.isAbsolute(executable) && /\s|[;&|`$<>]/u.test(executable)) {
    throw new TypeError(
      "Zed executable must be a command name or absolute executable path, not a shell command.",
    );
  }
}

function validateArgument(argument: string): void {
  // eslint-disable-next-line no-control-regex -- argv values reject NUL and line breaks.
  if (/[\u0000\r\n]/u.test(argument))
    throw new TypeError("Invalid Zed argument.");
}
