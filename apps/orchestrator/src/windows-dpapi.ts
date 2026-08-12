import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const DPAPI_ENTROPY = "Aptiloop/provider-credentials/v2";
const MAX_DPAPI_PLAINTEXT_BYTES = 2 * 1024 * 1024;
const MAX_DPAPI_CIPHERTEXT_BYTES = 3 * 1024 * 1024;
const MAX_DPAPI_OUTPUT_BYTES = 3 * 1024 * 1024;
const MAX_DPAPI_ERROR_BYTES = 64 * 1024;
const DPAPI_TIMEOUT_MS = 10_000;
const WINDOWS_PROCESS_CLEANUP_TIMEOUT_MS = 2_000;
const WINDOWS_KERNEL_SYSTEM_ROOT = "\\\\?\\GLOBALROOT\\SystemRoot";

const PROTECT_SCRIPT = windowsDpapiScript("Protect");
const UNPROTECT_SCRIPT = windowsDpapiScript("Unprotect");

export interface WindowsCredentialProtection {
  protect(plaintext: Buffer, signal?: AbortSignal): Promise<Buffer>;
  unprotect(ciphertext: Buffer, signal?: AbortSignal): Promise<Buffer>;
}

interface WindowsDpapiOptions {
  /** @internal Deterministic abort-listener race seam. */
  readonly beforeAbortListener?: () => void;
}

/**
 * Current-user DPAPI bridge for Windows PowerShell 5.1. Credential bytes are
 * transported over anonymous pipes only; no secret is placed in argv or env.
 */
export function createWindowsCredentialProtection(
  options: WindowsDpapiOptions = {},
): WindowsCredentialProtection {
  return {
    protect: (plaintext, signal) =>
      runWindowsDpapi(
        "protect",
        plaintext,
        signal,
        options.beforeAbortListener,
      ),
    unprotect: (ciphertext, signal) =>
      runWindowsDpapi(
        "unprotect",
        ciphertext,
        signal,
        options.beforeAbortListener,
      ),
  };
}

async function runWindowsDpapi(
  operation: "protect" | "unprotect",
  input: Buffer,
  signal?: AbortSignal,
  beforeAbortListener?: () => void,
): Promise<Buffer> {
  const maximumInputBytes =
    operation === "protect"
      ? MAX_DPAPI_PLAINTEXT_BYTES
      : MAX_DPAPI_CIPHERTEXT_BYTES;
  if (input.length === 0 || input.length > maximumInputBytes) {
    throw protectionFailure();
  }
  if (signal?.aborted) throw abortFailure();

  let plan: Awaited<ReturnType<typeof resolveWindowsPowerShellPlan>>;
  try {
    plan = await resolveWindowsPowerShellPlan();
  } catch {
    throw protectionFailure();
  }

  return new Promise<Buffer>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        plan.executable,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          operation === "protect" ? PROTECT_SCRIPT : UNPROTECT_SCRIPT,
        ],
        {
          cwd: plan.windowsDirectory,
          env: plan.environment,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch {
      reject(protectionFailure());
      return;
    }

    const output: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let failure: Error | null = null;
    let closed = false;

    const finish = (result?: Buffer) => {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      clearTimeout(cleanupFallback);
      signal?.removeEventListener("abort", onAbort);
      if (failure) reject(failure);
      else if (result && result.length > 0) resolve(result);
      else reject(protectionFailure());
    };

    const terminate = (error: Error) => {
      if (failure) return;
      failure = error;
      terminateWindowsProcessTree(
        child,
        plan.taskkillExecutable,
        plan.environment,
      );
    };

    const onAbort = () => terminate(abortFailure());

    const timeout = setTimeout(() => {
      terminate(protectionFailure());
    }, DPAPI_TIMEOUT_MS);
    timeout.unref();

    const cleanupFallback = setTimeout(() => {
      if (!failure || closed) return;
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may already be gone.
      }
      finish();
    }, DPAPI_TIMEOUT_MS + WINDOWS_PROCESS_CLEANUP_TIMEOUT_MS);
    cleanupFallback.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_DPAPI_OUTPUT_BYTES) {
        terminate(protectionFailure());
        return;
      }
      output.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > MAX_DPAPI_ERROR_BYTES) {
        terminate(protectionFailure());
      }
    });
    child.once("error", () => {
      failure ??= protectionFailure();
      finish();
    });
    child.once("close", (code) => {
      if (failure || code !== 0 || errorBytes > MAX_DPAPI_ERROR_BYTES) {
        failure ??= protectionFailure();
        finish();
        return;
      }
      finish(Buffer.concat(output, outputBytes));
    });
    child.stdin?.once("error", () => {
      terminate(protectionFailure());
    });
    try {
      beforeAbortListener?.();
    } catch {
      terminate(protectionFailure());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (failure) child.stdin?.destroy();
    else child.stdin?.end(input);
  });
}

async function resolveWindowsPowerShellPlan(): Promise<{
  readonly executable: string;
  readonly taskkillExecutable: string;
  readonly windowsDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
}> {
  const canonicalRoot = await realpath(WINDOWS_KERNEL_SYSTEM_ROOT);
  const executableCandidate = path.win32.join(
    canonicalRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const taskkillCandidate = path.win32.join(
    canonicalRoot,
    "System32",
    "taskkill.exe",
  );
  const [rootStat, canonicalExecutable, canonicalTaskkill] = await Promise.all([
    stat(canonicalRoot),
    realpath(executableCandidate),
    realpath(taskkillCandidate),
  ]);
  const [executableStat, taskkillStat] = await Promise.all([
    stat(canonicalExecutable),
    stat(canonicalTaskkill),
  ]);
  if (
    !rootStat.isDirectory() ||
    !isRegularFileWithin(canonicalRoot, canonicalExecutable, executableStat) ||
    !isRegularFileWithin(canonicalRoot, canonicalTaskkill, taskkillStat)
  ) {
    throw protectionFailure();
  }

  return {
    executable: canonicalExecutable,
    taskkillExecutable: canonicalTaskkill,
    windowsDirectory: canonicalRoot,
    environment: {
      SystemRoot: canonicalRoot,
      WINDIR: canonicalRoot,
    },
  };
}

function isRegularFileWithin(
  root: string,
  candidate: string,
  candidateStat: { isFile(): boolean },
): boolean {
  const relative = path.win32.relative(root, candidate);
  return (
    candidateStat.isFile() &&
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.win32.isAbsolute(relative)
  );
}

function terminateWindowsProcessTree(
  child: ReturnType<typeof spawn>,
  taskkillExecutable: string,
  environment: NodeJS.ProcessEnv,
): void {
  if (child.pid === undefined) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process did not start.
    }
    return;
  }
  try {
    const cleanup = spawn(
      taskkillExecutable,
      ["/pid", String(child.pid), "/t", "/f"],
      {
        env: environment,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    cleanup.once("error", () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may already be gone.
      }
    });
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already be gone.
    }
  }
}

function windowsDpapiScript(operation: "Protect" | "Unprotect"): string {
  const source = [
    "$ErrorActionPreference = 'Stop'",
    "Set-StrictMode -Version 3.0",
    "Add-Type -AssemblyName System.Security",
    "$inputStream = [Console]::OpenStandardInput()",
    "$memoryStream = New-Object System.IO.MemoryStream",
    "$inputStream.CopyTo($memoryStream)",
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')`,
    `$result = [Security.Cryptography.ProtectedData]::${operation}($memoryStream.ToArray(), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "$outputStream = [Console]::OpenStandardOutput()",
    "$outputStream.Write($result, 0, $result.Length)",
    "$outputStream.Flush()",
  ].join("\n");
  return Buffer.from(source, "utf16le").toString("base64");
}

function protectionFailure(): Error {
  return new Error("Windows provider credential protection failed");
}

function abortFailure(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}
