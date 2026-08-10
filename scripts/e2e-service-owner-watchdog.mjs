import { spawn } from "node:child_process";
import path from "node:path";
import { createOwnerWatchdogPolicy } from "./e2e-owner-watchdog.mjs";
import {
  assertCanonicalDirectoryPath,
  assertCanonicalDirectoryDescendantPath,
  assertValidE2ERunId,
  captureCanonicalDirectoryPath,
  createNextEnvLockOwner,
  nextEnvLauncherOwnerIsActive,
} from "./e2e-next-env-lock.mjs";

const runId = requiredEnvironment("E2E_RUN_ID");
assertValidE2ERunId(runId);
const runRoot = path.resolve(requiredEnvironment("E2E_RUN_ROOT"));
const runsRoot = path.dirname(runRoot);
if (runRoot !== path.join(runsRoot, runId)) {
  throw new Error("E2E service run ownership metadata is invalid");
}
const runsRootGuard = await captureCanonicalDirectoryPath(runsRoot);
const runRootGuard = await captureCanonicalDirectoryPath(runRoot);
await assertCanonicalDirectoryDescendantPath(runRootGuard, runsRootGuard);
const launcherPid = Number(requiredEnvironment("E2E_LAUNCHER_PID"));
const owner = createNextEnvLockOwner(runId, {
  pid: launcherPid,
  token: requiredEnvironment("E2E_LOCK_TOKEN"),
});

// Heartbeat replacement and inspection can be delayed briefly while Next.js
// compiles on Windows. Keep initial validation fail-closed, but require a
// sustained three-second loss after startup before killing healthy services.
const maximumConsecutiveOwnershipFailures = 12;
const failurePolicy = createOwnerWatchdogPolicy(
  maximumConsecutiveOwnershipFailures,
);
let checking = false;
let terminating = false;

async function verifyOwner({ initial = false } = {}) {
  if (checking || terminating) return;
  checking = true;
  let active = false;
  try {
    await assertCanonicalDirectoryPath(runsRootGuard);
    await assertCanonicalDirectoryPath(runRootGuard);
    active = await nextEnvLauncherOwnerIsActive({ owner, runsRoot });
  } catch {
    active = false;
  } finally {
    checking = false;
  }
  if (failurePolicy.observe(active, { initial })) {
    terminateOwnedServiceTree();
  }
}

function terminateOwnedServiceTree() {
  if (terminating) return;
  terminating = true;
  console.error(
    "[e2e:service] Suite launcher ownership was lost; terminating the service process tree",
  );
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/pid", String(process.pid), "/t", "/f"],
      { detached: true, shell: false, stdio: "ignore", windowsHide: true },
    );
    killer.unref();
    setTimeout(() => process.exit(1), 1_000);
    return;
  }
  try {
    process.kill(-process.pid, "SIGKILL");
  } catch {
    process.kill(process.pid, "SIGKILL");
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for E2E service ownership`);
  return value;
}

await verifyOwner({ initial: true });
if (terminating) {
  throw new Error("E2E suite launcher ownership was lost before service start");
}
const timer = setInterval(() => void verifyOwner(), 250);
timer.unref();
