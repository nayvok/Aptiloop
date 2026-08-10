import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { realpath as realpathCallback } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const lockDirectoryName = ".next-env.lock";
const lockOwnerVersion = "v1";
const runMarkerName = "run.json";
const recoveryJournalVersion = 1;
const maximumTargetBytes = 1024 * 1024;
const maximumOwnershipRecordBytes = 16 * 1024;
const maximumJournalBytes = 2 * 1024 * 1024;
const runIdPattern = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const tokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const heartbeatFileName = "launcher-heartbeat.json";
const heartbeatVersion = 1;
const heartbeatIntervalMs = 1_000;
export const maximumLauncherHeartbeatAgeMs = 5_000;
const maximumHeartbeatFutureSkewMs = 1_000;
const nativeRealpath = promisify(realpathCallback.native);
const issuedDirectoryGuards = new WeakSet();
const issuedFileGuards = new WeakSet();
const replacementRaceCodes = new Set([
  "EACCES",
  "EEXIST",
  "EISDIR",
  "ENOENT",
  "ENOTDIR",
  "ENOTEMPTY",
  "EPERM",
]);

export function assertValidE2ERunId(runId) {
  if (typeof runId !== "string" || !runIdPattern.test(runId)) {
    throw new Error(`Invalid E2E run ID: ${JSON.stringify(runId)}`);
  }
}

export async function ensureCanonicalDirectoryPath(directoryPath) {
  const resolvedPath = normalizeFilesystemPath(directoryPath, "directory");
  return walkCanonicalDirectory(resolvedPath, { createMissing: true });
}

export async function captureCanonicalDirectoryPath(directoryPath) {
  const resolvedPath = normalizeFilesystemPath(directoryPath, "directory");
  return walkCanonicalDirectory(resolvedPath, { createMissing: false });
}

export async function createExclusiveCanonicalDirectoryPath(
  directoryPath,
  parentGuard,
) {
  const resolvedPath = normalizeFilesystemPath(directoryPath, "directory");
  assertIssuedDirectoryGuard(parentGuard);
  if (path.dirname(resolvedPath) !== parentGuard.path) {
    throw new Error(
      "The exclusive E2E directory must be a direct child of its admitted parent",
    );
  }
  await assertCanonicalDirectoryPath(parentGuard);
  await mkdir(resolvedPath, { mode: 0o700 });
  const createdGuard = await captureCanonicalDirectoryPath(resolvedPath);
  if (!sameGuardChainPrefix(createdGuard, parentGuard)) {
    throw new Error(
      "Refusing the exclusive E2E directory because its admitted parent identity changed during creation",
    );
  }
  return createdGuard;
}

export async function assertCanonicalDirectoryPath(directoryGuard) {
  assertIssuedDirectoryGuard(directoryGuard);
  await revalidateDirectoryChain(directoryGuard.chain);
}

export async function assertCanonicalDirectoryDescendantPath(
  directoryGuard,
  ancestorGuard,
) {
  assertIssuedDirectoryGuard(directoryGuard);
  assertIssuedDirectoryGuard(ancestorGuard);
  await assertCanonicalDirectoryPath(ancestorGuard);
  await assertCanonicalDirectoryPath(directoryGuard);
  if (!sameGuardChainPrefix(directoryGuard, ancestorGuard)) {
    throw new Error(
      "Refusing E2E filesystem access because a directory escaped its admitted ancestor identity",
    );
  }
}

export async function captureCanonicalFilePath(
  filePath,
  { allowMissing = false, parentGuard: expectedParentGuard } = {},
) {
  if (typeof allowMissing !== "boolean") {
    throw new TypeError("allowMissing must be boolean");
  }
  if (expectedParentGuard !== undefined) {
    assertIssuedDirectoryGuard(expectedParentGuard);
  }
  const resolvedPath = normalizeFilesystemPath(filePath, "file");
  if (
    expectedParentGuard &&
    path.dirname(resolvedPath) !== expectedParentGuard.path
  ) {
    throw new Error("The admitted E2E file escaped its expected parent");
  }
  if (expectedParentGuard) {
    await assertCanonicalDirectoryPath(expectedParentGuard);
  }
  const observedParentGuard = await captureCanonicalDirectoryPath(
    path.dirname(resolvedPath),
  );
  if (
    expectedParentGuard &&
    !sameDirectoryGuardIdentity(observedParentGuard, expectedParentGuard)
  ) {
    throw new Error(
      "Refusing E2E filesystem access because the file parent identity changed during admission",
    );
  }
  const status = await lstatBigIntOrMissing(resolvedPath);
  if (!status) {
    if (!allowMissing) {
      throw new Error(`The admitted E2E file is missing: ${resolvedPath}`);
    }
    return issueFileGuard(resolvedPath, observedParentGuard, undefined);
  }
  assertSafeRegularFileStatus(status, resolvedPath);
  await assertNativeRealpath(resolvedPath);
  return issueFileGuard(
    resolvedPath,
    observedParentGuard,
    filesystemIdentity(status),
  );
}

export async function assertCanonicalFilePath(fileGuard) {
  assertIssuedFileGuard(fileGuard);
  await assertCanonicalDirectoryPath(fileGuard.parentGuard);
  const status = await lstatBigIntOrMissing(fileGuard.path);
  if (!fileGuard.identity) {
    if (status) {
      throw new Error(
        `Refusing E2E filesystem access because a previously absent file appeared: ${fileGuard.path}`,
      );
    }
    return;
  }
  if (!status) {
    throw new Error(
      `Refusing E2E filesystem access because an admitted file disappeared: ${fileGuard.path}`,
    );
  }
  assertSafeRegularFileStatus(status, fileGuard.path);
  await assertNativeRealpath(fileGuard.path);
  if (!sameFilesystemIdentity(filesystemIdentity(status), fileGuard.identity)) {
    throw new Error(
      `Refusing E2E filesystem access because file identity changed: ${fileGuard.path}`,
    );
  }
}

export async function unlinkCanonicalFilePath(fileGuard) {
  await assertCanonicalFilePath(fileGuard);
  await assertCanonicalDirectoryPath(fileGuard.parentGuard);
  await unlink(fileGuard.path);
}

export async function renameCanonicalDirectoryPath(
  sourceGuard,
  destinationParentGuard,
  destinationName,
) {
  assertIssuedDirectoryGuard(sourceGuard);
  assertIssuedDirectoryGuard(destinationParentGuard);
  if (
    typeof destinationName !== "string" ||
    destinationName.length === 0 ||
    path.basename(destinationName) !== destinationName
  ) {
    throw new Error(
      "The canonical E2E rename destination must be one path component",
    );
  }
  const destinationPath = path.join(
    destinationParentGuard.path,
    destinationName,
  );
  await assertCanonicalDirectoryPath(sourceGuard);
  await assertCanonicalDirectoryPath(destinationParentGuard);
  if (await lstatBigIntOrMissing(destinationPath)) {
    throw new Error("Refusing to replace an existing E2E rename destination");
  }
  await rename(sourceGuard.path, destinationPath);
  const destinationGuard = await captureCanonicalDirectoryPath(destinationPath);
  if (
    !sameFilesystemIdentity(
      directoryGuardLeafIdentity(sourceGuard),
      directoryGuardLeafIdentity(destinationGuard),
    ) ||
    !sameGuardChainPrefix(destinationGuard, destinationParentGuard)
  ) {
    throw new Error(
      "Refusing the renamed E2E directory because its strong identity changed",
    );
  }
  return destinationGuard;
}

export async function removeCanonicalDirectoryTree(directoryGuard) {
  assertIssuedDirectoryGuard(directoryGuard);
  if (directoryGuard.path === path.parse(directoryGuard.path).root) {
    throw new Error("Refusing to recursively remove a filesystem root");
  }
  await assertCanonicalDirectoryPath(directoryGuard);
  const parentGuard = issueDirectoryGuard(
    path.dirname(directoryGuard.path),
    directoryGuard.chain.slice(0, -1),
  );
  await assertCanonicalDirectoryPath(parentGuard);
  await rm(directoryGuard.path, { force: false, recursive: true });
  await assertCanonicalDirectoryPath(parentGuard);
}

export function createNextEnvLockOwner(
  runId,
  { pid = process.pid, token = randomUUID() } = {},
) {
  assertValidE2ERunId(runId);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("The E2E next-env lock PID must be a positive integer");
  }
  if (typeof token !== "string" || !tokenPattern.test(token)) {
    throw new Error("The E2E next-env lock token must be a UUIDv4");
  }
  return Object.freeze({ pid, runId, token });
}

export function serializeNextEnvRunMarker(owner) {
  const normalizedOwner = normalizeOwner(owner);
  return `${JSON.stringify(
    {
      version: 1,
      runId: normalizedOwner.runId,
      launcherPid: normalizedOwner.pid,
      nextEnvLockToken: normalizedOwner.token,
    },
    null,
    2,
  )}\n`;
}

export async function writeNextEnvRunMarker(runsRoot, owner) {
  const normalizedOwner = normalizeOwner(owner);
  const layout = lockLayout(runsRoot, normalizedOwner);
  const runsRootGuard = await captureCanonicalDirectoryPath(layout.runsRoot);
  const runRootGuard = await captureCanonicalDirectoryPath(layout.runRoot);
  if (!sameGuardChainPrefix(runRootGuard, runsRootGuard)) {
    throw new Error("The E2E run root is not inside its admitted runs root");
  }
  await assertCanonicalDirectoryPath(runRootGuard);
  await writeFile(
    layout.runMarkerPath,
    serializeNextEnvRunMarker(normalizedOwner),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  const markerGuard = await captureCanonicalFilePath(layout.runMarkerPath, {
    parentGuard: runRootGuard,
  });
  try {
    await writeLauncherHeartbeatForGuard(
      layout,
      normalizedOwner,
      runRootGuard,
      {
        sequence: 0,
        updatedAtMs: Date.now(),
      },
    );
  } catch (error) {
    await unlinkCanonicalFilePath(markerGuard).catch(() => undefined);
    throw error;
  }
  return runRootGuard;
}

export async function writeNextEnvLauncherHeartbeat(
  runsRoot,
  owner,
  { sequence = 1, updatedAtMs = Date.now() } = {},
) {
  const normalizedOwner = normalizeOwner(owner);
  const layout = lockLayout(runsRoot, normalizedOwner);
  const runRootGuard = await captureCanonicalDirectoryPath(layout.runRoot);
  if (!(await runMarkerMatches(layout.runsRoot, normalizedOwner))) {
    throw new Error(
      "Refusing to update the E2E launcher heartbeat without its exact run marker",
    );
  }
  await writeLauncherHeartbeatForGuard(layout, normalizedOwner, runRootGuard, {
    sequence,
    updatedAtMs,
  });
}

export async function startNextEnvLauncherHeartbeat({
  runsRoot,
  owner,
  onFailure,
  intervalMs = heartbeatIntervalMs,
}) {
  if (onFailure !== undefined && typeof onFailure !== "function") {
    throw new TypeError(
      "The E2E launcher heartbeat failure hook must be callable",
    );
  }
  assertDuration(intervalMs, "intervalMs");
  if (intervalMs === 0 || intervalMs * 2 > maximumLauncherHeartbeatAgeMs) {
    throw new Error(
      "The E2E launcher heartbeat interval is not safely bounded",
    );
  }

  const normalizedOwner = normalizeOwner(owner);
  const layout = lockLayout(runsRoot, normalizedOwner);
  const runRootGuard = await captureCanonicalDirectoryPath(layout.runRoot);
  const initial = await inspectLauncherHeartbeat(
    layout.runsRoot,
    normalizedOwner,
    Date.now(),
    maximumLauncherHeartbeatAgeMs,
  );
  if (initial.kind !== "fresh") {
    throw new Error(
      "The initial E2E launcher heartbeat is not fresh and exact",
    );
  }

  let sequence = initial.record.sequence + 1;
  let stopped = false;
  let currentWrite;
  let timer;
  let reportedFailure = false;
  const reportFailure = async (error) => {
    if (reportedFailure) return;
    reportedFailure = true;
    stopped = true;
    clearInterval(timer);
    if (onFailure) await onFailure(asError(error));
  };
  const update = async () => {
    if (stopped || currentWrite) return;
    currentWrite = writeLauncherHeartbeatForGuard(
      layout,
      normalizedOwner,
      runRootGuard,
      { sequence: sequence++, updatedAtMs: Date.now() },
    )
      .catch(reportFailure)
      .finally(() => {
        currentWrite = undefined;
      });
    await currentWrite;
  };

  await update();
  if (!stopped) {
    timer = setInterval(() => void update(), intervalMs);
    timer.unref();
  }
  return Object.freeze({
    async stop() {
      stopped = true;
      clearInterval(timer);
      await currentWrite;
    },
  });
}

export async function nextEnvLauncherOwnerIsActive({
  runsRoot,
  owner,
  isProcessAlive = processIsAlive,
  now = Date.now,
  maximumHeartbeatAgeMs = maximumLauncherHeartbeatAgeMs,
}) {
  if (typeof isProcessAlive !== "function") {
    throw new TypeError("The E2E launcher liveness check must be callable");
  }
  if (typeof now !== "function") {
    throw new TypeError("The E2E launcher heartbeat clock must be callable");
  }
  assertDuration(maximumHeartbeatAgeMs, "maximumHeartbeatAgeMs");
  const normalizedOwner = normalizeOwner(owner);
  const inspection = await inspectNextEnvLock(path.resolve(runsRoot));
  if (
    inspection.kind !== "owned" ||
    !sameOwner(inspection.owner, normalizedOwner)
  ) {
    return false;
  }
  const heartbeat = await inspectLauncherHeartbeat(
    inspection.runsRootGuard.path,
    normalizedOwner,
    now(),
    maximumHeartbeatAgeMs,
  ).catch(() => ({ kind: "invalid" }));
  if (heartbeat.kind !== "fresh") return false;
  try {
    return (await isProcessAlive(normalizedOwner.pid)) === true;
  } catch {
    return false;
  }
}

export async function assertE2EServiceProcessTargetsDead(
  record,
  { isProcessAlive = processIsAlive } = {},
) {
  if (!isPlainRecord(record)) {
    throw new TypeError("The E2E service process record must be an object");
  }
  if (typeof isProcessAlive !== "function") {
    throw new TypeError(
      "The E2E service process liveness check must be callable",
    );
  }
  await assertE2EProcessTargetDead(
    record.launcherPid,
    "service launcher",
    isProcessAlive,
  );
  await assertE2EProcessTargetDead(
    record.childPid,
    "service child",
    isProcessAlive,
  );
}

async function assertE2EProcessTargetDead(pid, label, isProcessAlive) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`The recorded E2E ${label} PID is invalid`);
  }
  let alive;
  try {
    alive = await isProcessAlive(pid);
  } catch {
    throw new Error(
      `Refusing stale E2E run removal because the recorded ${label} PID ${pid} could not be proven dead`,
    );
  }
  if (alive !== false) {
    throw new Error(
      `Refusing stale E2E run removal because the recorded ${label} PID ${pid} is live or ambiguous`,
    );
  }
}

export async function scavengeStaleE2ERunRoots({
  lock,
  beforeRemove,
  isProcessAlive = processIsAlive,
  maximumHeartbeatAgeMs = maximumLauncherHeartbeatAgeMs,
  now = Date.now,
  signal,
}) {
  if (beforeRemove !== undefined && typeof beforeRemove !== "function") {
    throw new TypeError("The E2E stale-run removal hook must be callable");
  }
  if (typeof isProcessAlive !== "function") {
    throw new TypeError("The E2E stale-run liveness check must be callable");
  }
  if (typeof now !== "function") {
    throw new TypeError("The E2E stale-run clock must be callable");
  }
  assertDuration(maximumHeartbeatAgeMs, "maximumHeartbeatAgeMs");
  assertAbortSignal(signal);
  throwIfLockAcquisitionAborted(signal);

  const context = lockContext(lock);
  await assertCurrentLockOwner(context);
  const entries = await readdir(context.layout.runsRoot, {
    withFileTypes: true,
  });
  await assertCurrentLockOwner(context);
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );

  const removedRunIds = [];
  for (const entry of entries) {
    throwIfLockAcquisitionAborted(signal);
    if (!entry.isDirectory() || entry.name === context.owner.runId) continue;
    const candidate = await inspectStaleRunCandidate(context, entry.name);
    if (!candidate) continue;
    if (
      !(await staleLauncherIsProvenDead({
        isProcessAlive,
        maximumHeartbeatAgeMs,
        now,
        owner: candidate.owner,
        runsRoot: context.layout.runsRoot,
      }))
    ) {
      continue;
    }

    if (beforeRemove) {
      await beforeRemove(
        Object.freeze({
          owner: candidate.owner,
          runRoot: candidate.runRootGuard.path,
        }),
      );
    }
    throwIfLockAcquisitionAborted(signal);
    await assertCurrentLockOwner(context);
    if (
      !(await staleRunCandidateStillMatches(context, candidate, {
        isProcessAlive,
        maximumHeartbeatAgeMs,
        now,
      }))
    ) {
      continue;
    }
    await assertCurrentLockOwner(context);
    try {
      await removeCanonicalDirectoryTree(candidate.runRootGuard);
    } catch {
      continue;
    }
    removedRunIds.push(candidate.owner.runId);
  }

  await assertCurrentLockOwner(context);
  return Object.freeze(removedRunIds);
}

export async function acquireNextEnvLock({
  runsRoot,
  owner,
  nextEnvPath,
  timeoutMs = 180_000,
  pollIntervalMs = 200,
  emptyLockGraceMs = 2_000,
  now = Date.now,
  sleep = delay,
  isProcessAlive = processIsAlive,
  beforeReclaim,
  beforeOriginalPublish,
  signal,
}) {
  assertDuration(timeoutMs, "timeoutMs");
  assertDuration(pollIntervalMs, "pollIntervalMs");
  assertDuration(emptyLockGraceMs, "emptyLockGraceMs");
  if (typeof now !== "function" || typeof sleep !== "function") {
    throw new TypeError("The E2E next-env lock clock must be callable");
  }
  if (typeof isProcessAlive !== "function") {
    throw new TypeError(
      "The E2E next-env owner liveness check must be callable",
    );
  }
  if (beforeReclaim !== undefined && typeof beforeReclaim !== "function") {
    throw new TypeError("The E2E next-env reclamation hook must be callable");
  }
  if (
    beforeOriginalPublish !== undefined &&
    typeof beforeOriginalPublish !== "function"
  ) {
    throw new TypeError("The E2E next-env publication hook must be callable");
  }
  assertAbortSignal(signal);
  throwIfLockAcquisitionAborted(signal);

  const normalizedOwner = normalizeOwner(owner);
  const layout = lockLayout(runsRoot, normalizedOwner);
  const resolvedNextEnvPath = normalizeTargetPath(nextEnvPath);
  const runsRootGuard = await captureCanonicalDirectoryPath(layout.runsRoot);
  const runRootGuard = await captureCanonicalDirectoryPath(layout.runRoot);
  const nextEnvParentGuard = await captureCanonicalDirectoryPath(
    path.dirname(resolvedNextEnvPath),
  );
  await captureCanonicalFilePath(resolvedNextEnvPath, {
    allowMissing: true,
    parentGuard: nextEnvParentGuard,
  });
  if (
    !sameGuardChainPrefix(runRootGuard, runsRootGuard) ||
    !(await runMarkerMatches(layout.runsRoot, normalizedOwner, runRootGuard))
  ) {
    throw new Error(
      "The current E2E run marker is missing or does not match its strongly admitted next-env lock metadata",
    );
  }
  const ownHeartbeat = await inspectLauncherHeartbeat(
    layout.runsRoot,
    normalizedOwner,
    now(),
    maximumLauncherHeartbeatAgeMs,
  );
  if (ownHeartbeat.kind !== "fresh") {
    throw new Error(
      "The current E2E launcher heartbeat is not fresh and exact",
    );
  }

  const deadline = now() + timeoutMs;
  while (true) {
    throwIfLockAcquisitionAborted(signal);
    await assertCanonicalDirectoryPath(runsRootGuard);
    await assertCanonicalDirectoryPath(runRootGuard);
    await assertCanonicalDirectoryPath(nextEnvParentGuard);
    let createdLockGuard;
    try {
      createdLockGuard = await createExclusiveCanonicalDirectoryPath(
        layout.lockPath,
        runsRootGuard,
      );
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
    }

    if (createdLockGuard) {
      const ownerPath = path.join(
        layout.lockPath,
        ownerEntryName(normalizedOwner),
      );
      let ownerFileGuard;
      try {
        await assertCanonicalDirectoryPath(createdLockGuard);
        await writeFile(ownerPath, "", { flag: "wx", mode: 0o600 });
        ownerFileGuard = await captureCanonicalFilePath(ownerPath, {
          parentGuard: createdLockGuard,
        });
      } catch (error) {
        await assertCanonicalDirectoryPath(createdLockGuard);
        await rmdir(layout.lockPath).catch((cleanupError) => {
          if (!isReplacementRace(cleanupError)) throw cleanupError;
        });
        throw error;
      }

      const installed = await inspectNextEnvLock(layout.runsRoot);
      if (
        installed.kind === "owned" &&
        sameOwner(installed.owner, normalizedOwner) &&
        sameDirectoryGuardIdentity(installed.lockGuard, createdLockGuard) &&
        sameDirectoryGuardIdentity(installed.runRootGuard, runRootGuard) &&
        sameDirectoryGuardIdentity(installed.runsRootGuard, runsRootGuard)
      ) {
        return Object.freeze({
          lockGuard: createdLockGuard,
          lockPath: layout.lockPath,
          nextEnvParentGuard,
          nextEnvPath: resolvedNextEnvPath,
          owner: normalizedOwner,
          runRootGuard,
          runsRoot: layout.runsRoot,
          runsRootGuard,
        });
      }

      if (ownerFileGuard) {
        await unlinkCanonicalFilePath(ownerFileGuard).catch((error) => {
          if (!isReplacementRace(error)) throw error;
        });
      }
      await assertCanonicalDirectoryPath(createdLockGuard);
      await rmdir(layout.lockPath).catch((error) => {
        if (!isReplacementRace(error)) throw error;
      });
      throw new Error(
        "Refusing to use the E2E next-env lock because its strong ownership identity changed during acquisition",
      );
    }

    const inspection = await inspectNextEnvLock(layout.runsRoot);
    if (inspection.kind === "missing" || inspection.kind === "changed") {
      await waitToRetry({
        deadline,
        now,
        pollIntervalMs,
        sleep,
        signal,
        timeoutMessage:
          "Timed out waiting for the E2E next-env lock state to stabilize",
      });
      continue;
    }
    if (inspection.kind === "empty") {
      const age = Math.max(0, now() - inspection.modifiedAt);
      if (age < emptyLockGraceMs) {
        await waitToRetry({
          deadline,
          now,
          pollIntervalMs,
          sleep,
          signal,
          timeoutMessage:
            "Timed out waiting for an in-progress E2E next-env lock transition",
        });
        continue;
      }
      let removed = false;
      try {
        await assertCanonicalDirectoryPath(inspection.lockGuard);
        await rmdir(inspection.lockGuard.path);
        removed = true;
      } catch (error) {
        if (!isReplacementRace(error)) throw error;
      }
      if (!removed && (await lstatOrMissing(layout.lockPath))) {
        await waitToRetry({
          deadline,
          now,
          pollIntervalMs,
          sleep,
          signal,
          timeoutMessage:
            "Timed out waiting to reclaim an empty E2E next-env lock",
        });
      }
      continue;
    }
    if (inspection.kind === "malformed") {
      throw new Error(
        "Refusing to reclaim the E2E next-env lock because its owner metadata is malformed",
      );
    }
    if (inspection.kind === "foreign") {
      throw new Error(
        "Refusing to reclaim the E2E next-env lock because its launcher marker is missing or does not match",
      );
    }
    if (inspection.kind === "unreadable") {
      throw new Error(
        "Refusing to reclaim the E2E next-env lock because its ownership metadata cannot be read safely",
      );
    }

    if (
      await ownerIsAlive(
        inspection.owner,
        isProcessAlive,
        "contention",
        layout.runsRoot,
        now,
      )
    ) {
      await waitToRetry({
        deadline,
        now,
        pollIntervalMs,
        sleep,
        signal,
        timeoutMessage: `Timed out waiting for the E2E next-env lock held by live launcher PID ${inspection.owner.pid} for run ${inspection.owner.runId}`,
      });
      continue;
    }

    throwIfLockAcquisitionAborted(signal);
    if (beforeReclaim) {
      await beforeReclaim(
        Object.freeze({ lockPath: layout.lockPath, owner: inspection.owner }),
      );
    }
    throwIfLockAcquisitionAborted(signal);

    const reclaimResult = await reclaimStaleOwnedLock({
      beforeOriginalPublish,
      expectedInspection: inspection,
      expectedOwner: inspection.owner,
      isProcessAlive,
      nextEnvPath: resolvedNextEnvPath,
      now,
      runsRoot: layout.runsRoot,
    });
    if (reclaimResult === "removed" || reclaimResult === "gone") continue;
    if (reclaimResult === "live") {
      await waitToRetry({
        deadline,
        now,
        pollIntervalMs,
        sleep,
        signal,
        timeoutMessage: `Timed out waiting for the E2E next-env lock held by live launcher PID ${inspection.owner.pid} for run ${inspection.owner.runId}`,
      });
      continue;
    }
    throw new Error(
      "Refusing to reclaim the E2E next-env lock because ownership changed during stale lock reclamation; the replacement was preserved",
    );
  }
}

export async function prepareNextEnvRecovery(
  lock,
  desiredContentForOriginal,
  { afterDesiredInstall, afterOriginalCapture } = {},
) {
  const context = lockContext(lock);
  if (typeof desiredContentForOriginal !== "function") {
    throw new TypeError(
      "The desired next-env content factory must be callable",
    );
  }
  for (const [name, hook] of [
    ["afterDesiredInstall", afterDesiredInstall],
    ["afterOriginalCapture", afterOriginalCapture],
  ]) {
    if (hook !== undefined && typeof hook !== "function") {
      throw new TypeError(`${name} must be callable`);
    }
  }
  await assertCurrentLockOwner(context);
  if (await lstatOrMissing(context.layout.recoveryJournalPath)) {
    throw new Error("The E2E next-env recovery journal already exists");
  }

  const original = await readTargetState(
    context.nextEnvPath,
    context.nextEnvParentGuard,
  );
  const desiredValue = await desiredContentForOriginal(
    original.exists ? Buffer.from(original.bytes) : undefined,
  );
  if (!Buffer.isBuffer(desiredValue)) {
    throw new TypeError("The desired next-env content must be a Buffer");
  }
  if (desiredValue.byteLength > maximumTargetBytes) {
    throw new Error("The desired next-env content is unexpectedly large");
  }
  const desired = Buffer.from(desiredValue);
  const desiredMode = original.exists
    ? original.mode
    : 0o666 & ~process.umask();
  const journal = serializeRecoveryJournal(
    context.owner,
    original,
    desired,
    desiredMode,
  );
  if (Buffer.byteLength(journal) > maximumJournalBytes) {
    throw new Error("The E2E next-env recovery journal is unexpectedly large");
  }

  await assertCurrentLockOwner(context);
  const journalTemporaryGuard = await writePrivateFile(
    context.layout.recoveryJournalTemporaryPath,
    Buffer.from(journal, "utf8"),
    0o600,
    context.runRootGuard,
  );
  try {
    if (
      !(await publishExclusive(
        journalTemporaryGuard,
        context.layout.recoveryJournalPath,
        context.runRootGuard,
      ))
    ) {
      throw new Error("The E2E next-env recovery journal already exists");
    }
  } finally {
    await unlinkCanonicalFilePath(journalTemporaryGuard).catch((error) => {
      if (!isErrorCode(error, "ENOENT")) throw error;
    });
  }

  const recoveryWorkGuard = await ensureRecoveryWorkDirectory(context, true);
  if (original.exists) {
    await assertCurrentLockOwner(context);
    await renameCanonicalFileTo(
      original.fileGuard,
      context.layout.recoveryCapturedPath,
      recoveryWorkGuard,
    );
    const captured = await readTargetState(
      context.layout.recoveryCapturedPath,
      recoveryWorkGuard,
    );
    if (!sameTargetState(captured, original)) {
      await republishCaptured(
        context.layout.recoveryCapturedPath,
        context.nextEnvPath,
        recoveryWorkGuard,
        context.nextEnvParentGuard,
      );
      throw new Error(
        "next-env.d.ts changed while its original was captured; the concurrent content was preserved",
      );
    }
  } else if (
    (await readTargetState(context.nextEnvPath, context.nextEnvParentGuard))
      .exists
  ) {
    throw new Error(
      "next-env.d.ts appeared while its recovery journal was prepared; the concurrent content was preserved",
    );
  }
  if (afterOriginalCapture) await afterOriginalCapture();

  await assertCurrentLockOwner(context);
  const desiredGuard = await writePrivateFile(
    context.layout.recoveryDesiredPath,
    desired,
    desiredMode,
    recoveryWorkGuard,
  );
  if (
    !(await publishExclusive(
      desiredGuard,
      context.nextEnvPath,
      context.nextEnvParentGuard,
    ))
  ) {
    throw new Error(
      "next-env.d.ts changed before atomic desired-content installation; the concurrent content was preserved",
    );
  }
  const installed = await readTargetState(
    context.nextEnvPath,
    context.nextEnvParentGuard,
  );
  if (!stateMatchesBytesAndMode(installed, desired, desiredMode)) {
    throw new Error(
      "Atomic next-env.d.ts desired-content installation could not be verified",
    );
  }
  if (afterDesiredInstall) await afterDesiredInstall();

  await assertCurrentLockOwner(context);
  await unlinkIfExists(context.layout.recoveryCapturedPath, recoveryWorkGuard);
  await unlinkIfExists(context.layout.recoveryDesiredPath, recoveryWorkGuard);
  await assertCanonicalDirectoryPath(recoveryWorkGuard);
  await rmdir(recoveryWorkGuard.path);
}

export async function restoreNextEnvFromRecovery(
  lock,
  { required = true } = {},
) {
  if (typeof required !== "boolean") {
    throw new TypeError(
      "The E2E next-env recovery requirement must be boolean",
    );
  }
  const context = lockContext(lock);
  await assertCurrentLockOwner(context);
  const restored = await restoreRecoveryJournalIfPresent({ context });
  if (!restored && required) {
    throw new Error("The E2E next-env recovery journal is missing");
  }
  return restored;
}

export async function finalizeNextEnvAfterServices(
  lock,
  { servicesQuiescent },
) {
  if (typeof servicesQuiescent !== "boolean") {
    throw new TypeError("The E2E service quiescence state must be boolean");
  }
  if (!servicesQuiescent) return false;
  await restoreNextEnvFromRecovery(lock, { required: false });
  await releaseNextEnvLock(lock);
  return true;
}

export async function releaseNextEnvLock(lock, { afterOwnerUnlink } = {}) {
  if (
    afterOwnerUnlink !== undefined &&
    typeof afterOwnerUnlink !== "function"
  ) {
    throw new TypeError("The E2E next-env release hook must be callable");
  }
  const context = lockContext(lock);
  await assertCurrentLockOwner(context);
  if (await lstatOrMissing(context.layout.recoveryJournalPath)) {
    throw new Error(
      "Refusing to release the E2E next-env lock before its recovery journal is resolved",
    );
  }

  const removal = await removeOwnedLockDirectory(
    context.lockGuard,
    context.owner,
    afterOwnerUnlink,
  );
  if (removal !== "removed") {
    throw new Error(
      "Refusing to finish releasing the E2E next-env lock because ownership changed; the replacement was preserved",
    );
  }
}

async function reclaimStaleOwnedLock({
  beforeOriginalPublish,
  expectedInspection,
  expectedOwner,
  isProcessAlive,
  nextEnvPath,
  now,
  runsRoot,
}) {
  let inspection = await inspectNextEnvLock(runsRoot);
  if (inspection.kind === "missing") return "gone";
  if (
    inspection.kind !== "owned" ||
    !sameOwner(inspection.owner, expectedOwner) ||
    !sameDirectoryGuardIdentity(
      inspection.lockGuard,
      expectedInspection.lockGuard,
    ) ||
    !sameDirectoryGuardIdentity(
      inspection.runRootGuard,
      expectedInspection.runRootGuard,
    ) ||
    !sameDirectoryGuardIdentity(
      inspection.runsRootGuard,
      expectedInspection.runsRootGuard,
    )
  ) {
    return "changed";
  }
  if (
    await ownerIsAlive(
      inspection.owner,
      isProcessAlive,
      "reclamation",
      runsRoot,
      now,
    )
  ) {
    return "live";
  }

  const nextEnvParentGuard = await captureCanonicalDirectoryPath(
    path.dirname(nextEnvPath),
  );
  await captureCanonicalFilePath(nextEnvPath, {
    allowMissing: true,
    parentGuard: nextEnvParentGuard,
  });
  const context = {
    layout: lockLayout(runsRoot, expectedOwner),
    lockGuard: inspection.lockGuard,
    nextEnvParentGuard,
    nextEnvPath,
    owner: expectedOwner,
    runRootGuard: inspection.runRootGuard,
    runsRootGuard: inspection.runsRootGuard,
  };
  await restoreRecoveryJournalIfPresent({
    beforeOriginalPublish,
    context,
  });

  inspection = await inspectNextEnvLock(runsRoot);
  if (
    inspection.kind !== "owned" ||
    !sameOwner(inspection.owner, expectedOwner) ||
    !sameDirectoryGuardIdentity(inspection.lockGuard, context.lockGuard) ||
    !sameDirectoryGuardIdentity(
      inspection.runRootGuard,
      context.runRootGuard,
    ) ||
    !sameDirectoryGuardIdentity(inspection.runsRootGuard, context.runsRootGuard)
  ) {
    return inspection.kind === "missing" ? "gone" : "changed";
  }
  if (
    await ownerIsAlive(
      inspection.owner,
      isProcessAlive,
      "reclamation",
      runsRoot,
      now,
    )
  ) {
    return "live";
  }
  return removeOwnedLockDirectory(context.lockGuard, expectedOwner);
}

async function restoreRecoveryJournalIfPresent({
  beforeOriginalPublish,
  context,
}) {
  await assertCurrentLockOwner(context);
  const journal = await readRecoveryJournal(context);
  if (!journal) return false;

  await restoreJournaledOriginalAtomically(
    context,
    journal,
    beforeOriginalPublish,
  );
  const restored = await readTargetState(
    context.nextEnvPath,
    context.nextEnvParentGuard,
  );
  if (!targetMatchesJournalOriginal(restored, journal)) {
    throw new Error(
      "Refusing to remove the E2E next-env recovery journal because exact restoration could not be verified",
    );
  }
  await assertCurrentLockOwner(context);
  const journalGuard = await captureCanonicalFilePath(
    context.layout.recoveryJournalPath,
    { parentGuard: context.runRootGuard },
  );
  const currentJournal = await readRecoveryJournal(context);
  if (JSON.stringify(currentJournal) !== JSON.stringify(journal)) {
    throw new Error(
      "Refusing to remove a replaced E2E next-env recovery journal",
    );
  }
  await unlinkCanonicalFilePath(journalGuard);
  return true;
}

async function restoreJournaledOriginalAtomically(
  context,
  journal,
  beforeOriginalPublish,
) {
  await assertCurrentLockOwner(context);
  const recoveryWorkGuard = await ensureRecoveryWorkDirectory(context, false);
  await assertRecoveryWorkEntriesKnown(context.layout, recoveryWorkGuard);

  const capturedOriginal = await readOptionalTargetState(
    context.layout.recoveryCapturedPath,
    recoveryWorkGuard,
  );
  if (
    capturedOriginal &&
    !targetMatchesJournalOriginal(capturedOriginal, journal)
  ) {
    await republishCaptured(
      context.layout.recoveryCapturedPath,
      context.nextEnvPath,
      recoveryWorkGuard,
      context.nextEnvParentGuard,
    );
    throw new Error(
      "Refusing next-env.d.ts recovery because captured concurrent content was preserved",
    );
  }

  let current = await readTargetState(
    context.nextEnvPath,
    context.nextEnvParentGuard,
  );
  if (targetMatchesJournalOriginal(current, journal)) {
    await cleanupRecoveryWork(context, journal, recoveryWorkGuard);
    return;
  }

  let capturedDesired = await readOptionalTargetState(
    context.layout.recoveryStaleDesiredPath,
    recoveryWorkGuard,
  );
  if (capturedDesired) {
    if (!targetMatchesJournalDesired(capturedDesired, journal)) {
      if (!current.exists) {
        await republishCaptured(
          context.layout.recoveryStaleDesiredPath,
          context.nextEnvPath,
          recoveryWorkGuard,
          context.nextEnvParentGuard,
        );
      }
      throw new Error(
        "Refusing stale next-env.d.ts recovery because captured concurrent content was preserved",
      );
    }
    if (current.exists) {
      throw new Error(
        "next-env.d.ts reappeared during stale recovery; the concurrent content was preserved",
      );
    }
  } else if (current.exists) {
    await assertCurrentLockOwner(context);
    await renameCanonicalFileTo(
      current.fileGuard,
      context.layout.recoveryStaleDesiredPath,
      recoveryWorkGuard,
    );
    capturedDesired = await readTargetState(
      context.layout.recoveryStaleDesiredPath,
      recoveryWorkGuard,
    );
    if (!targetMatchesJournalDesired(capturedDesired, journal)) {
      await republishCaptured(
        context.layout.recoveryStaleDesiredPath,
        context.nextEnvPath,
        recoveryWorkGuard,
        context.nextEnvParentGuard,
      );
      throw new Error(
        "Refusing stale next-env.d.ts recovery because its bytes or mode are neither the journaled original nor the stale launcher's desired state",
      );
    }
  }

  if (journal.originalExists) {
    let originalSource = capturedOriginal;
    if (!originalSource) {
      originalSource = await readOptionalTargetState(
        context.layout.recoveryOriginalPath,
        recoveryWorkGuard,
      );
      if (
        originalSource &&
        !targetMatchesJournalOriginal(originalSource, journal)
      ) {
        await unlinkCanonicalFilePath(originalSource.fileGuard);
        originalSource = undefined;
      }
      if (!originalSource) {
        const originalGuard = await writePrivateFile(
          context.layout.recoveryOriginalPath,
          Buffer.from(journal.originalBase64, "base64"),
          journal.originalMode,
          recoveryWorkGuard,
        );
        originalSource = await readTargetState(
          originalGuard.path,
          recoveryWorkGuard,
        );
      }
    }
    if (beforeOriginalPublish) await beforeOriginalPublish();
    await assertCurrentLockOwner(context);
    if (
      !(await publishExclusive(
        originalSource.fileGuard,
        context.nextEnvPath,
        context.nextEnvParentGuard,
      ))
    ) {
      throw new Error(
        "next-env.d.ts reappeared before original-content publication; the concurrent content was preserved",
      );
    }
  }

  current = await readTargetState(
    context.nextEnvPath,
    context.nextEnvParentGuard,
  );
  if (!targetMatchesJournalOriginal(current, journal)) {
    throw new Error(
      "Atomic next-env.d.ts original-content restoration could not be verified",
    );
  }
  await cleanupRecoveryWork(context, journal, recoveryWorkGuard);
}

async function readRecoveryJournal(context) {
  await assertCanonicalDirectoryPath(context.runRootGuard);
  const status = await lstatOrMissing(context.layout.recoveryJournalPath);
  if (!status) return undefined;
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    status.size > maximumJournalBytes
  ) {
    throw new Error(
      "Refusing stale next-env.d.ts recovery because its journal is malformed",
    );
  }

  let parsed;
  try {
    const journalGuard = await captureCanonicalFilePath(
      context.layout.recoveryJournalPath,
      { parentGuard: context.runRootGuard },
    );
    parsed = JSON.parse(
      await readFile(context.layout.recoveryJournalPath, "utf8"),
    );
    await assertCanonicalFilePath(journalGuard);
  } catch {
    throw new Error(
      "Refusing stale next-env.d.ts recovery because its journal is malformed",
    );
  }
  if (!isValidRecoveryJournal(parsed, context.owner)) {
    throw new Error(
      "Refusing stale next-env.d.ts recovery because its journal does not match the lock owner",
    );
  }
  if (parsed.originalExists) {
    const original = Buffer.from(parsed.originalBase64, "base64");
    if (
      original.toString("base64") !== parsed.originalBase64 ||
      sha256(original) !== parsed.originalSha256
    ) {
      throw new Error(
        "Refusing stale next-env.d.ts recovery because its journal checksum is invalid",
      );
    }
  }
  return parsed;
}

function serializeRecoveryJournal(owner, original, desired, desiredMode) {
  return `${JSON.stringify(
    {
      version: recoveryJournalVersion,
      pid: owner.pid,
      runId: owner.runId,
      token: owner.token,
      originalExists: original.exists,
      originalBase64: original.exists
        ? original.bytes.toString("base64")
        : null,
      originalSha256: original.exists ? sha256(original.bytes) : null,
      originalMode: original.exists ? original.mode : null,
      desiredSha256: sha256(desired),
      desiredMode,
    },
    null,
    2,
  )}\n`;
}

function isValidRecoveryJournal(value, owner) {
  if (!isPlainRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      "version",
      "pid",
      "runId",
      "token",
      "originalExists",
      "originalBase64",
      "originalSha256",
      "originalMode",
      "desiredSha256",
      "desiredMode",
    ]) ||
    value.version !== recoveryJournalVersion ||
    value.pid !== owner.pid ||
    value.runId !== owner.runId ||
    value.token !== owner.token ||
    typeof value.originalExists !== "boolean" ||
    typeof value.desiredSha256 !== "string" ||
    !sha256Pattern.test(value.desiredSha256) ||
    !isFileMode(value.desiredMode)
  ) {
    return false;
  }
  if (!value.originalExists) {
    return (
      value.originalBase64 === null &&
      value.originalSha256 === null &&
      value.originalMode === null
    );
  }
  return (
    typeof value.originalBase64 === "string" &&
    typeof value.originalSha256 === "string" &&
    sha256Pattern.test(value.originalSha256) &&
    isFileMode(value.originalMode)
  );
}

async function readTargetState(targetPath, parentGuard) {
  assertIssuedDirectoryGuard(parentGuard);
  if (path.dirname(path.resolve(targetPath)) !== parentGuard.path) {
    throw new Error("The E2E target is outside its admitted parent directory");
  }
  await assertCanonicalDirectoryPath(parentGuard);
  const fileGuard = await captureCanonicalFilePath(targetPath, {
    allowMissing: true,
    parentGuard,
  });
  if (!fileGuard.identity) return { exists: false, fileGuard };
  const status = await lstat(targetPath);
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    status.size > maximumTargetBytes
  ) {
    throw new Error(
      "Refusing E2E next-env recovery because next-env.d.ts is not a safe regular file",
    );
  }
  const bytes = await readFile(targetPath);
  await assertCanonicalFilePath(fileGuard);
  return {
    bytes,
    exists: true,
    fileGuard,
    mode: status.mode & 0o777,
  };
}

async function readOptionalTargetState(targetPath, parentGuard) {
  const state = await readTargetState(targetPath, parentGuard);
  return state.exists ? state : undefined;
}

function targetMatchesJournalOriginal(target, journal) {
  if (!journal.originalExists) return !target.exists;
  return (
    target.exists &&
    target.mode === journal.originalMode &&
    sha256(target.bytes) === journal.originalSha256 &&
    target.bytes.equals(Buffer.from(journal.originalBase64, "base64"))
  );
}

function targetMatchesJournalDesired(target, journal) {
  return (
    target.exists &&
    target.mode === journal.desiredMode &&
    sha256(target.bytes) === journal.desiredSha256
  );
}

function sameTargetState(left, right) {
  if (left.exists !== right.exists) return false;
  if (!left.exists) return true;
  return left.mode === right.mode && left.bytes.equals(right.bytes);
}

function stateMatchesBytesAndMode(state, bytes, mode) {
  return state.exists && state.mode === mode && state.bytes.equals(bytes);
}

async function ensureRecoveryWorkDirectory(context, requireNew) {
  const status = await lstatOrMissing(context.layout.recoveryWorkPath);
  if (status) {
    if (requireNew) {
      throw new Error(
        "The E2E next-env recovery work directory is not safely owned",
      );
    }
    const guard = await captureCanonicalDirectoryPath(
      context.layout.recoveryWorkPath,
    );
    if (!sameGuardChainPrefix(guard, context.runRootGuard)) {
      throw new Error(
        "The E2E next-env recovery work directory escaped its owned run root",
      );
    }
    return guard;
  }
  await assertCurrentLockOwner(context);
  return createExclusiveCanonicalDirectoryPath(
    context.layout.recoveryWorkPath,
    context.runRootGuard,
  );
}

async function writePrivateFile(filePath, bytes, mode, parentGuard) {
  assertIssuedDirectoryGuard(parentGuard);
  if (path.dirname(path.resolve(filePath)) !== parentGuard.path) {
    throw new Error("The private E2E file escaped its admitted parent");
  }
  await assertCanonicalDirectoryPath(parentGuard);
  await writeFile(filePath, bytes, { flag: "wx", mode });
  const fileGuard = await captureCanonicalFilePath(filePath, { parentGuard });
  await assertCanonicalFilePath(fileGuard);
  await chmod(filePath, mode);
  await assertCanonicalFilePath(fileGuard);
  return fileGuard;
}

async function publishExclusive(sourceGuard, targetPath, targetParentGuard) {
  assertIssuedFileGuard(sourceGuard);
  assertIssuedDirectoryGuard(targetParentGuard);
  if (path.dirname(path.resolve(targetPath)) !== targetParentGuard.path) {
    throw new Error("The E2E publication target escaped its admitted parent");
  }
  await assertCanonicalFilePath(sourceGuard);
  await assertCanonicalDirectoryPath(targetParentGuard);
  if (await lstatOrMissing(targetPath)) return false;
  try {
    await link(sourceGuard.path, targetPath);
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) return false;
    throw error;
  }
  const installedGuard = await captureCanonicalFilePath(targetPath, {
    parentGuard: targetParentGuard,
  });
  if (!sameFilesystemIdentity(installedGuard.identity, sourceGuard.identity)) {
    throw new Error("The atomically published E2E file changed identity");
  }
  return true;
}

async function republishCaptured(
  capturedPath,
  targetPath,
  capturedParentGuard,
  targetParentGuard,
) {
  const captured = await readOptionalTargetState(
    capturedPath,
    capturedParentGuard,
  );
  if (!captured) return;
  await publishExclusive(captured.fileGuard, targetPath, targetParentGuard);
}

async function renameCanonicalFileTo(
  sourceGuard,
  destinationPath,
  destinationParentGuard,
) {
  assertIssuedFileGuard(sourceGuard);
  assertIssuedDirectoryGuard(destinationParentGuard);
  if (
    path.dirname(path.resolve(destinationPath)) !== destinationParentGuard.path
  ) {
    throw new Error(
      "The E2E file rename destination escaped its admitted parent",
    );
  }
  await assertCanonicalFilePath(sourceGuard);
  await assertCanonicalDirectoryPath(destinationParentGuard);
  if (await lstatOrMissing(destinationPath)) {
    throw new Error(
      "Refusing to replace an existing E2E file rename destination",
    );
  }
  await rename(sourceGuard.path, destinationPath);
  const destinationGuard = await captureCanonicalFilePath(destinationPath, {
    parentGuard: destinationParentGuard,
  });
  if (
    !sameFilesystemIdentity(destinationGuard.identity, sourceGuard.identity)
  ) {
    throw new Error("The renamed E2E file changed strong identity");
  }
  return destinationGuard;
}

async function assertRecoveryWorkEntriesKnown(layout, recoveryWorkGuard) {
  await assertCanonicalDirectoryPath(recoveryWorkGuard);
  const allowed = new Set([
    path.basename(layout.recoveryCapturedPath),
    path.basename(layout.recoveryDesiredPath),
    path.basename(layout.recoveryOriginalPath),
    path.basename(layout.recoveryStaleDesiredPath),
  ]);
  const entries = await readdir(recoveryWorkGuard.path, {
    withFileTypes: true,
  });
  if (entries.some((entry) => !entry.isFile() || !allowed.has(entry.name))) {
    throw new Error(
      "The E2E next-env recovery work directory contains foreign state",
    );
  }
  for (const entry of entries) {
    await captureCanonicalFilePath(
      path.join(recoveryWorkGuard.path, entry.name),
      {
        parentGuard: recoveryWorkGuard,
      },
    );
  }
}

async function cleanupRecoveryWork(context, journal, recoveryWorkGuard) {
  await assertCurrentLockOwner(context);
  await assertRecoveryWorkEntriesKnown(context.layout, recoveryWorkGuard);
  const states = [];
  for (const [filePath, expected] of [
    [context.layout.recoveryCapturedPath, "original"],
    [context.layout.recoveryDesiredPath, "desired"],
    [context.layout.recoveryOriginalPath, "original"],
    [context.layout.recoveryStaleDesiredPath, "desired"],
  ]) {
    const state = await readOptionalTargetState(filePath, recoveryWorkGuard);
    if (!state) continue;
    const matches =
      expected === "original"
        ? targetMatchesJournalOriginal(state, journal)
        : targetMatchesJournalDesired(state, journal);
    if (!matches) {
      throw new Error(
        "Refusing to clean E2E next-env recovery work containing concurrent state",
      );
    }
    states.push(state);
  }
  for (const state of states) {
    await unlinkCanonicalFilePath(state.fileGuard);
  }
  await assertCanonicalDirectoryPath(recoveryWorkGuard);
  await rmdir(recoveryWorkGuard.path);
}

async function unlinkIfExists(filePath, parentGuard) {
  assertIssuedDirectoryGuard(parentGuard);
  await assertCanonicalDirectoryPath(parentGuard);
  if (!(await lstatOrMissing(filePath))) return;
  const fileGuard = await captureCanonicalFilePath(filePath, { parentGuard });
  await unlinkCanonicalFilePath(fileGuard);
}

function isFileMode(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0o777;
}

async function writeLauncherHeartbeatForGuard(
  layout,
  owner,
  runRootGuard,
  { sequence, updatedAtMs },
) {
  assertIssuedDirectoryGuard(runRootGuard);
  if (runRootGuard.path !== layout.runRoot) {
    throw new Error("The E2E launcher heartbeat run-root guard is invalid");
  }
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    !Number.isSafeInteger(updatedAtMs) ||
    updatedAtMs < 0
  ) {
    throw new TypeError("The E2E launcher heartbeat clock state is invalid");
  }

  await assertCanonicalDirectoryPath(runRootGuard);
  if (!(await runMarkerMatches(layout.runsRoot, owner, runRootGuard))) {
    throw new Error(
      "Refusing to publish an E2E launcher heartbeat without its exact run marker",
    );
  }
  const current = await readLauncherHeartbeat(layout, owner, runRootGuard);
  if (current.kind === "present") {
    if (
      current.record.runPathIdentity !==
        directoryGuardFingerprint(runRootGuard) ||
      sequence <= current.record.sequence
    ) {
      throw new Error(
        "Refusing to replace an E2E launcher heartbeat with changed identity or generation",
      );
    }
  } else if (current.kind !== "missing" || sequence !== 0) {
    throw new Error(
      "Refusing to create an E2E launcher heartbeat without an exact initial generation",
    );
  }

  const serialized = serializeLauncherHeartbeat(owner, {
    runPathIdentity: directoryGuardFingerprint(runRootGuard),
    sequence,
    updatedAtMs,
  });
  const temporaryPath = path.join(
    layout.runRoot,
    `.launcher-heartbeat-${owner.token}-${randomUUID()}.tmp`,
  );
  let temporaryGuard;
  let published = false;
  try {
    await assertCanonicalDirectoryPath(runRootGuard);
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    temporaryGuard = await captureCanonicalFilePath(temporaryPath, {
      parentGuard: runRootGuard,
    });
    await assertCanonicalDirectoryPath(runRootGuard);
    if (!(await runMarkerMatches(layout.runsRoot, owner, runRootGuard))) {
      throw new Error(
        "Refusing to publish an E2E launcher heartbeat after its run marker changed",
      );
    }
    if (current.fileGuard) await assertCanonicalFilePath(current.fileGuard);
    await assertCanonicalFilePath(temporaryGuard);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporaryPath, layout.heartbeatPath);
        break;
      } catch (error) {
        if (!isReplacementRace(error) || attempt >= 19) throw error;
        await delay(10);
      }
    }
    published = true;
    const installedGuard = await captureCanonicalFilePath(
      layout.heartbeatPath,
      {
        parentGuard: runRootGuard,
      },
    );
    if (
      !sameFilesystemIdentity(installedGuard.identity, temporaryGuard.identity)
    ) {
      throw new Error(
        "The installed E2E launcher heartbeat changed identity during publication",
      );
    }
  } finally {
    if (!published && temporaryGuard) {
      await unlinkCanonicalFilePath(temporaryGuard).catch(() => undefined);
    }
  }
}

function serializeLauncherHeartbeat(
  owner,
  { runPathIdentity, sequence, updatedAtMs },
) {
  const payload = {
    version: heartbeatVersion,
    runId: owner.runId,
    launcherPid: owner.pid,
    runPathIdentity,
    sequence,
    updatedAtMs,
  };
  const authenticator = createHmac("sha256", owner.token)
    .update(JSON.stringify(payload))
    .digest("hex");
  return `${JSON.stringify({ ...payload, authenticator }, null, 2)}\n`;
}

async function readLauncherHeartbeat(layout, owner, runRootGuard) {
  const status = await lstatBigIntOrMissing(layout.heartbeatPath);
  if (!status) return { kind: "missing" };
  try {
    assertSafeRegularFileStatus(status, layout.heartbeatPath);
    if (status.size > 16_384n) return { kind: "invalid" };
    const fileGuard = await captureCanonicalFilePath(layout.heartbeatPath, {
      parentGuard: runRootGuard,
    });
    const serialized = await readFile(layout.heartbeatPath, "utf8");
    await assertCanonicalFilePath(fileGuard);
    const record = JSON.parse(serialized);
    if (!isValidLauncherHeartbeat(record, owner)) return { kind: "invalid" };
    if (
      serialized !==
      serializeLauncherHeartbeat(owner, {
        runPathIdentity: record.runPathIdentity,
        sequence: record.sequence,
        updatedAtMs: record.updatedAtMs,
      })
    ) {
      return { kind: "invalid" };
    }
    await assertCanonicalDirectoryPath(runRootGuard);
    return { fileGuard, kind: "present", record };
  } catch (error) {
    if (isReplacementRace(error)) return { kind: "changed" };
    if (error instanceof SyntaxError) return { kind: "invalid" };
    throw error;
  }
}

function isValidLauncherHeartbeat(record, owner) {
  if (
    !isPlainRecord(record) ||
    !hasExactKeys(record, [
      "authenticator",
      "launcherPid",
      "runId",
      "runPathIdentity",
      "sequence",
      "updatedAtMs",
      "version",
    ]) ||
    record.version !== heartbeatVersion ||
    record.runId !== owner.runId ||
    record.launcherPid !== owner.pid ||
    typeof record.runPathIdentity !== "string" ||
    !sha256Pattern.test(record.runPathIdentity) ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    !Number.isSafeInteger(record.updatedAtMs) ||
    record.updatedAtMs < 0 ||
    typeof record.authenticator !== "string" ||
    !sha256Pattern.test(record.authenticator)
  ) {
    return false;
  }
  const expected = JSON.parse(
    serializeLauncherHeartbeat(owner, {
      runPathIdentity: record.runPathIdentity,
      sequence: record.sequence,
      updatedAtMs: record.updatedAtMs,
    }),
  );
  return timingSafeEqual(
    Buffer.from(record.authenticator, "hex"),
    Buffer.from(expected.authenticator, "hex"),
  );
}

async function inspectLauncherHeartbeat(
  runsRoot,
  owner,
  now,
  maximumHeartbeatAgeMs,
) {
  if (!Number.isSafeInteger(now) || now < 0) return { kind: "invalid" };
  const layout = lockLayout(runsRoot, owner);
  const runRootGuard = await captureCanonicalDirectoryPath(layout.runRoot);
  if (!(await runMarkerMatches(layout.runsRoot, owner, runRootGuard))) {
    return { kind: "invalid" };
  }
  let heartbeat;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    heartbeat = await readLauncherHeartbeat(layout, owner, runRootGuard);
    if (heartbeat.kind !== "changed" && heartbeat.kind !== "missing") break;
    await delay(5);
  }
  if (
    !heartbeat ||
    heartbeat.kind === "changed" ||
    heartbeat.kind === "missing"
  ) {
    return { kind: "invalid" };
  }
  if (heartbeat.kind !== "present") return heartbeat;
  if (
    heartbeat.record.runPathIdentity !== directoryGuardFingerprint(runRootGuard)
  ) {
    return { kind: "identity-changed" };
  }
  if (
    heartbeat.record.updatedAtMs > now + maximumHeartbeatFutureSkewMs ||
    now - heartbeat.record.updatedAtMs > maximumHeartbeatAgeMs
  ) {
    return { kind: "stale", record: heartbeat.record };
  }
  return { kind: "fresh", record: heartbeat.record };
}

async function removeOwnedLockDirectory(lockGuard, owner, afterOwnerUnlink) {
  assertIssuedDirectoryGuard(lockGuard);
  const ownerPath = path.join(lockGuard.path, ownerEntryName(owner));
  try {
    await assertCanonicalDirectoryPath(lockGuard);
    const ownerFileGuard = await captureCanonicalFilePath(ownerPath, {
      parentGuard: lockGuard,
    });
    const status = await lstat(ownerPath);
    if (status.size !== 0) return "changed";
    await unlinkCanonicalFilePath(ownerFileGuard);
  } catch (error) {
    if (isReplacementRace(error)) {
      try {
        await assertCanonicalDirectoryPath(lockGuard);
        return "changed";
      } catch {
        return "gone";
      }
    }
    throw error;
  }

  if (afterOwnerUnlink) await afterOwnerUnlink();

  try {
    await assertCanonicalDirectoryPath(lockGuard);
    const entries = await readdir(lockGuard.path);
    if (entries.length !== 0) return "changed";
    await rmdir(lockGuard.path);
    return "removed";
  } catch (error) {
    if (isReplacementRace(error)) {
      try {
        await assertCanonicalDirectoryPath(lockGuard);
        return "changed";
      } catch {
        return "gone";
      }
    }
    throw error;
  }
}

async function inspectNextEnvLock(runsRoot) {
  const resolvedRunsRoot = path.resolve(runsRoot);
  const lockPath = path.join(resolvedRunsRoot, lockDirectoryName);
  let runsRootGuard;
  try {
    runsRootGuard = await captureCanonicalDirectoryPath(resolvedRunsRoot);
  } catch {
    return { kind: "unreadable" };
  }

  let lockStatus;
  try {
    lockStatus = await lstatOrMissing(lockPath);
  } catch {
    return { kind: "unreadable" };
  }
  if (!lockStatus) return { kind: "missing", runsRootGuard };

  let lockGuard;
  try {
    lockGuard = await captureCanonicalDirectoryPath(lockPath);
    if (!sameGuardChainPrefix(lockGuard, runsRootGuard)) {
      return { kind: "unreadable" };
    }
  } catch {
    return { kind: "malformed" };
  }

  let entries;
  try {
    await assertCanonicalDirectoryPath(lockGuard);
    entries = await readdir(lockPath, { withFileTypes: true });
  } catch (error) {
    return isReplacementRace(error)
      ? { kind: "changed" }
      : { kind: "unreadable" };
  }
  if (entries.length === 0) {
    return {
      kind: "empty",
      lockGuard,
      modifiedAt: lockStatus.mtimeMs,
      runsRootGuard,
    };
  }
  if (entries.length !== 1 || !entries[0]?.isFile()) {
    return { kind: "malformed" };
  }

  const owner = parseOwnerEntryName(entries[0].name);
  if (!owner) return { kind: "malformed" };
  const ownerPath = path.join(lockPath, entries[0].name);
  let ownerStatus;
  let ownerFileGuard;
  try {
    ownerStatus = await lstatOrMissing(ownerPath);
    if (!ownerStatus) return { kind: "changed" };
    if (
      !ownerStatus.isFile() ||
      ownerStatus.isSymbolicLink() ||
      ownerStatus.size !== 0
    ) {
      return { kind: "malformed" };
    }
    ownerFileGuard = await captureCanonicalFilePath(ownerPath, {
      parentGuard: lockGuard,
    });
  } catch {
    return { kind: "unreadable" };
  }

  let runRootGuard;
  try {
    runRootGuard = await captureCanonicalDirectoryPath(
      path.join(resolvedRunsRoot, owner.runId),
    );
    if (!sameGuardChainPrefix(runRootGuard, runsRootGuard)) {
      return { kind: "unreadable" };
    }
    if (!(await runMarkerMatches(resolvedRunsRoot, owner, runRootGuard))) {
      return { kind: "foreign", owner };
    }
  } catch {
    return { kind: "unreadable" };
  }
  return {
    kind: "owned",
    lockGuard,
    owner,
    ownerFileGuard,
    runRootGuard,
    runsRootGuard,
  };
}

async function assertCurrentLockOwner(context) {
  await assertCanonicalDirectoryPath(context.runsRootGuard);
  await assertCanonicalDirectoryPath(context.runRootGuard);
  await assertCanonicalDirectoryPath(context.lockGuard);
  await assertCanonicalDirectoryPath(context.nextEnvParentGuard);
  const inspection = await inspectNextEnvLock(context.layout.runsRoot);
  if (
    inspection.kind !== "owned" ||
    !sameOwner(inspection.owner, context.owner) ||
    !sameDirectoryGuardIdentity(inspection.lockGuard, context.lockGuard) ||
    !sameDirectoryGuardIdentity(
      inspection.runRootGuard,
      context.runRootGuard,
    ) ||
    !sameDirectoryGuardIdentity(inspection.runsRootGuard, context.runsRootGuard)
  ) {
    throw new Error(
      "Refusing to modify E2E next-env state without the matching owned lock and its strong directory identity",
    );
  }
}

async function inspectStaleRunCandidate(context, runId) {
  try {
    assertValidE2ERunId(runId);
    const runRootPath = path.join(context.layout.runsRoot, runId);
    const runRootGuard = await captureCanonicalDirectoryPath(runRootPath);
    if (
      path.dirname(runRootGuard.path) !== context.layout.runsRoot ||
      !sameGuardChainPrefix(runRootGuard, context.runsRootGuard) ||
      sameDirectoryGuardIdentity(runRootGuard, context.runRootGuard)
    ) {
      return undefined;
    }
    const owner = await readExactNextEnvRunMarker(
      context.layout.runsRoot,
      runId,
      runRootGuard,
    );
    if (!owner) return undefined;
    if (!(await runRootHasNoPendingRecovery(runRootGuard))) return undefined;
    return Object.freeze({ owner, runRootGuard });
  } catch {
    return undefined;
  }
}

async function staleRunCandidateStillMatches(context, candidate, options) {
  try {
    await assertCanonicalDirectoryPath(candidate.runRootGuard);
    const owner = await readExactNextEnvRunMarker(
      context.layout.runsRoot,
      candidate.owner.runId,
      candidate.runRootGuard,
    );
    if (!owner || !sameOwner(owner, candidate.owner)) return false;
    if (!(await runRootHasNoPendingRecovery(candidate.runRootGuard))) {
      return false;
    }
    await assertCanonicalDirectoryPath(candidate.runRootGuard);
    return staleLauncherIsProvenDead({
      ...options,
      owner: candidate.owner,
      runsRoot: context.layout.runsRoot,
    });
  } catch {
    return false;
  }
}

async function staleLauncherIsProvenDead({
  isProcessAlive,
  maximumHeartbeatAgeMs,
  now,
  owner,
  runsRoot,
}) {
  try {
    const observedNow = now();
    if (!Number.isSafeInteger(observedNow) || observedNow < 0) return false;
    const heartbeat = await inspectLauncherHeartbeat(
      runsRoot,
      owner,
      observedNow,
      maximumHeartbeatAgeMs,
    );
    if (
      heartbeat.kind !== "stale" ||
      heartbeat.record.updatedAtMs > observedNow ||
      observedNow - heartbeat.record.updatedAtMs <= maximumHeartbeatAgeMs
    ) {
      return false;
    }
    return (await isProcessAlive(owner.pid)) === false;
  } catch {
    return false;
  }
}

async function readExactNextEnvRunMarker(runsRoot, runId, runRootGuard) {
  assertValidE2ERunId(runId);
  assertIssuedDirectoryGuard(runRootGuard);
  const resolvedRunsRoot = path.resolve(runsRoot);
  if (runRootGuard.path !== path.join(resolvedRunsRoot, runId)) {
    return undefined;
  }
  await assertCanonicalDirectoryPath(runRootGuard);
  const markerPath = path.join(runRootGuard.path, runMarkerName);
  const status = await lstatBigIntOrMissing(markerPath);
  if (!status) return undefined;
  assertSafeRegularFileStatus(status, markerPath);
  if (status.size > BigInt(maximumOwnershipRecordBytes)) return undefined;
  const markerGuard = await captureCanonicalFilePath(markerPath, {
    parentGuard: runRootGuard,
  });
  const serialized = await readFile(markerPath, "utf8");
  await assertCanonicalFilePath(markerGuard);
  if (Buffer.byteLength(serialized, "utf8") > maximumOwnershipRecordBytes) {
    return undefined;
  }

  let record;
  try {
    record = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (
    !isPlainRecord(record) ||
    !hasExactKeys(record, [
      "launcherPid",
      "nextEnvLockToken",
      "runId",
      "version",
    ]) ||
    record.version !== 1 ||
    record.runId !== runId
  ) {
    return undefined;
  }

  let owner;
  try {
    owner = createNextEnvLockOwner(record.runId, {
      pid: record.launcherPid,
      token: record.nextEnvLockToken,
    });
  } catch {
    return undefined;
  }
  if (serialized !== serializeNextEnvRunMarker(owner)) return undefined;
  await assertCanonicalDirectoryPath(runRootGuard);
  return owner;
}

async function runRootHasNoPendingRecovery(runRootGuard) {
  await assertCanonicalDirectoryPath(runRootGuard);
  const entries = await readdir(runRootGuard.path);
  await assertCanonicalDirectoryPath(runRootGuard);
  return !entries.some(
    (entryName) =>
      entryName.startsWith(".next-env-recovery-") ||
      entryName.startsWith("next-env-recovery-"),
  );
}

async function runMarkerMatches(runsRoot, owner, expectedRunRootGuard) {
  const layout = lockLayout(runsRoot, owner);
  try {
    const runRootGuard =
      expectedRunRootGuard ??
      (await captureCanonicalDirectoryPath(layout.runRoot));
    assertIssuedDirectoryGuard(runRootGuard);
    if (runRootGuard.path !== layout.runRoot) return false;
    await assertCanonicalDirectoryPath(runRootGuard);
    const markerGuard = await captureCanonicalFilePath(layout.runMarkerPath, {
      parentGuard: runRootGuard,
    });
    const serialized = await readFile(layout.runMarkerPath, "utf8");
    await assertCanonicalFilePath(markerGuard);
    return serialized === serializeNextEnvRunMarker(owner);
  } catch (error) {
    if (isReplacementRace(error)) return false;
    throw error;
  }
}

function lockContext(lock) {
  if (!lock || typeof lock !== "object") {
    throw new TypeError("Invalid E2E next-env lock handle");
  }
  const owner = normalizeOwner(lock.owner);
  const layout = lockLayout(lock.runsRoot, owner);
  const nextEnvPath = normalizeTargetPath(lock.nextEnvPath);
  for (const guard of [
    lock.lockGuard,
    lock.runRootGuard,
    lock.runsRootGuard,
    lock.nextEnvParentGuard,
  ]) {
    assertIssuedDirectoryGuard(guard);
  }
  if (
    lock.lockPath !== layout.lockPath ||
    path.resolve(lock.nextEnvPath) !== nextEnvPath ||
    lock.lockGuard.path !== layout.lockPath ||
    lock.runRootGuard.path !== layout.runRoot ||
    lock.runsRootGuard.path !== layout.runsRoot ||
    lock.nextEnvParentGuard.path !== path.dirname(nextEnvPath)
  ) {
    throw new Error("Invalid E2E next-env lock path");
  }
  return {
    layout,
    lockGuard: lock.lockGuard,
    nextEnvParentGuard: lock.nextEnvParentGuard,
    nextEnvPath,
    owner,
    runRootGuard: lock.runRootGuard,
    runsRootGuard: lock.runsRootGuard,
  };
}

function lockLayout(runsRoot, owner) {
  const normalizedOwner = normalizeOwner(owner);
  if (typeof runsRoot !== "string" || runsRoot.length === 0) {
    throw new TypeError("The E2E runs root must be a path");
  }
  const resolvedRunsRoot = path.resolve(runsRoot);
  const runRoot = path.join(resolvedRunsRoot, normalizedOwner.runId);
  const recoveryWorkPath = path.join(
    runRoot,
    `.next-env-recovery-${normalizedOwner.token}`,
  );
  return {
    heartbeatPath: path.join(runRoot, heartbeatFileName),
    lockPath: path.join(resolvedRunsRoot, lockDirectoryName),
    recoveryCapturedPath: path.join(recoveryWorkPath, "captured-original"),
    recoveryDesiredPath: path.join(recoveryWorkPath, "prepared-desired"),
    recoveryJournalPath: path.join(
      runRoot,
      `next-env-recovery-${normalizedOwner.token}.json`,
    ),
    recoveryJournalTemporaryPath: path.join(
      runRoot,
      `.next-env-recovery-${normalizedOwner.token}.tmp`,
    ),
    recoveryOriginalPath: path.join(recoveryWorkPath, "prepared-original"),
    recoveryStaleDesiredPath: path.join(
      recoveryWorkPath,
      "captured-stale-desired",
    ),
    recoveryWorkPath,
    runMarkerPath: path.join(runRoot, runMarkerName),
    runRoot,
    runsRoot: resolvedRunsRoot,
  };
}

function normalizeTargetPath(targetPath) {
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    throw new TypeError("The E2E next-env target must be a path");
  }
  return path.resolve(targetPath);
}

function ownerEntryName(owner) {
  const normalizedOwner = normalizeOwner(owner);
  return `${lockOwnerVersion}.${normalizedOwner.pid}.${normalizedOwner.runId}.${normalizedOwner.token}`;
}

function parseOwnerEntryName(name) {
  if (typeof name !== "string") return undefined;
  const parts = name.split(".");
  if (parts.length !== 4 || parts[0] !== lockOwnerVersion) return undefined;
  const pid = Number(parts[1]);
  if (String(pid) !== parts[1]) return undefined;
  try {
    return createNextEnvLockOwner(parts[2], {
      pid,
      token: parts[3],
    });
  } catch {
    return undefined;
  }
}

function normalizeOwner(owner) {
  if (!owner || typeof owner !== "object") {
    throw new TypeError("Invalid E2E next-env lock owner");
  }
  return createNextEnvLockOwner(owner.runId, {
    pid: owner.pid,
    token: owner.token,
  });
}

async function ownerIsAlive(owner, isProcessAlive, phase, runsRoot, now) {
  try {
    const heartbeat = await inspectLauncherHeartbeat(
      runsRoot,
      owner,
      now(),
      maximumLauncherHeartbeatAgeMs,
    );
    if (heartbeat.kind === "stale") return false;
    if (heartbeat.kind !== "fresh") {
      throw new Error(`launcher heartbeat is ${heartbeat.kind}`);
    }
    const alive = await isProcessAlive(owner.pid);
    if (typeof alive !== "boolean") throw new TypeError("non-boolean result");
    return alive;
  } catch {
    throw new Error(
      `Refusing to reclaim the E2E next-env lock because its exact launcher heartbeat and process generation could not be verified during ${phase}`,
    );
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrorCode(error, "ESRCH")) return false;
    return true;
  }
}

async function waitToRetry({
  deadline,
  now,
  pollIntervalMs,
  signal,
  sleep,
  timeoutMessage,
}) {
  throwIfLockAcquisitionAborted(signal);
  const remaining = deadline - now();
  if (remaining <= 0) throw new Error(timeoutMessage);
  await sleepWithAbort(sleep, Math.min(pollIntervalMs, remaining), signal);
}

async function sleepWithAbort(sleep, milliseconds, signal) {
  if (!signal) {
    await sleep(milliseconds);
    return;
  }
  await new Promise((resolve, reject) => {
    const onAbort = () => reject(lockAcquisitionAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve()
      .then(() => sleep(milliseconds))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function assertAbortSignal(signal) {
  if (
    signal !== undefined &&
    (!signal ||
      typeof signal !== "object" ||
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")
  ) {
    throw new TypeError("The E2E next-env lock signal must be an AbortSignal");
  }
}

function throwIfLockAcquisitionAborted(signal) {
  if (signal?.aborted) throw lockAcquisitionAbortError();
}

function lockAcquisitionAbortError() {
  const error = new Error("E2E next-env lock acquisition was aborted");
  error.name = "AbortError";
  return error;
}

async function lstatOrMissing(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function lstatBigIntOrMissing(filePath) {
  try {
    return await lstat(filePath, { bigint: true });
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function walkCanonicalDirectory(resolvedPath, { createMissing }) {
  const parsed = path.parse(resolvedPath);
  const relativePath = path.relative(parsed.root, resolvedPath);
  const components = relativePath ? relativePath.split(path.sep) : [];
  const chain = [];
  let currentPath = parsed.root;

  for (const component of [undefined, ...components]) {
    if (component !== undefined)
      currentPath = path.join(currentPath, component);
    let status = await lstatBigIntOrMissing(currentPath);
    if (!status && createMissing) {
      await revalidateDirectoryChain(chain);
      try {
        await mkdir(currentPath, { mode: 0o700 });
      } catch (error) {
        if (!isErrorCode(error, "EEXIST")) throw error;
      }
      status = await lstatBigIntOrMissing(currentPath);
    }
    if (!status) {
      throw new Error(`The admitted E2E directory is missing: ${currentPath}`);
    }
    assertSafeDirectoryStatus(status, currentPath);
    await assertNativeRealpath(currentPath);
    chain.push(
      Object.freeze({
        identity: filesystemIdentity(status),
        path: currentPath,
      }),
    );
  }

  return issueDirectoryGuard(resolvedPath, chain);
}

async function revalidateDirectoryChain(chain) {
  for (const entry of chain) {
    const status = await lstatBigIntOrMissing(entry.path);
    if (!status) {
      throw new Error(
        `Refusing E2E filesystem access because an admitted directory disappeared: ${entry.path}`,
      );
    }
    assertSafeDirectoryStatus(status, entry.path);
    await assertNativeRealpath(entry.path);
    if (!sameFilesystemIdentity(filesystemIdentity(status), entry.identity)) {
      throw new Error(
        `Refusing E2E filesystem access because directory identity changed: ${entry.path}`,
      );
    }
  }
}

function issueDirectoryGuard(directoryPath, chain) {
  const guard = Object.freeze({
    chain: Object.freeze([...chain]),
    path: directoryPath,
  });
  issuedDirectoryGuards.add(guard);
  return guard;
}

function issueFileGuard(filePath, parentGuard, identity) {
  const guard = Object.freeze({
    identity,
    parentGuard,
    path: filePath,
  });
  issuedFileGuards.add(guard);
  return guard;
}

function assertIssuedDirectoryGuard(guard) {
  if (
    !guard ||
    typeof guard !== "object" ||
    !issuedDirectoryGuards.has(guard)
  ) {
    throw new TypeError("Invalid canonical E2E directory guard");
  }
}

function assertIssuedFileGuard(guard) {
  if (!guard || typeof guard !== "object" || !issuedFileGuards.has(guard)) {
    throw new TypeError("Invalid canonical E2E file guard");
  }
}

function assertSafeDirectoryStatus(status, directoryPath) {
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(
      `Refusing E2E filesystem access through a symlink, junction, reparse point, or non-directory ancestor: ${directoryPath}`,
    );
  }
}

function assertSafeRegularFileStatus(status, filePath) {
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(
      `Refusing E2E filesystem access through a symlink, junction, reparse point, or non-regular file: ${filePath}`,
    );
  }
}

async function assertNativeRealpath(candidatePath) {
  const observedPath = await nativeRealpath(candidatePath);
  if (canonicalPathKey(observedPath) !== canonicalPathKey(candidatePath)) {
    throw new Error(
      `Refusing E2E filesystem access because native realpath escapes or reparses a path component: ${candidatePath}`,
    );
  }
}

function normalizeFilesystemPath(candidatePath, kind) {
  if (typeof candidatePath !== "string" || candidatePath.length === 0) {
    throw new TypeError(`The canonical E2E ${kind} must be a path`);
  }
  return path.resolve(candidatePath);
}

function canonicalPathKey(candidatePath) {
  let normalized = path.normalize(candidatePath);
  if (process.platform === "win32") {
    if (normalized.startsWith("\\\\?\\UNC\\")) {
      normalized = `\\\\${normalized.slice(8)}`;
    } else if (normalized.startsWith("\\\\?\\")) {
      normalized = normalized.slice(4);
    }
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

function filesystemIdentity(status) {
  const identity = Object.freeze({
    birthtimeNs: String(status.birthtimeNs),
    dev: String(status.dev),
    ino: String(status.ino),
  });
  if (identity.ino === "0") {
    throw new Error(
      "The filesystem did not provide a strong E2E object identity",
    );
  }
  return identity;
}

function sameFilesystemIdentity(left, right) {
  return (
    left.birthtimeNs === right.birthtimeNs &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function directoryGuardLeafIdentity(directoryGuard) {
  return directoryGuard.chain.at(-1).identity;
}

function sameGuardChainPrefix(directoryGuard, prefixGuard) {
  if (directoryGuard.chain.length < prefixGuard.chain.length) return false;
  return prefixGuard.chain.every((entry, index) => {
    const candidate = directoryGuard.chain[index];
    return (
      canonicalPathKey(candidate.path) === canonicalPathKey(entry.path) &&
      sameFilesystemIdentity(candidate.identity, entry.identity)
    );
  });
}

function sameDirectoryGuardIdentity(left, right) {
  return (
    left.path === right.path &&
    left.chain.length === right.chain.length &&
    sameGuardChainPrefix(left, right)
  );
}

function directoryGuardFingerprint(directoryGuard) {
  assertIssuedDirectoryGuard(directoryGuard);
  return sha256(
    directoryGuard.chain
      .map(
        (entry) =>
          `${canonicalPathKey(entry.path)}\0${entry.identity.dev}\0${entry.identity.ino}\0${entry.identity.birthtimeNs}`,
      )
      .join("\n"),
  );
}

function sameOwner(left, right) {
  return (
    left.pid === right.pid &&
    left.runId === right.runId &&
    left.token === right.token
  );
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    keys.length === sortedExpectedKeys.length &&
    keys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertDuration(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

function isReplacementRace(error) {
  return (
    error instanceof Error &&
    "code" in error &&
    replacementRaceCodes.has(error.code)
  );
}

function isErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
