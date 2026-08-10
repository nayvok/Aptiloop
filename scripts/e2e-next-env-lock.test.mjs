import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import test from "node:test";
import {
  acquireNextEnvLock,
  assertE2EServiceProcessTargetsDead,
  captureCanonicalDirectoryPath,
  createNextEnvLockOwner,
  ensureCanonicalDirectoryPath,
  finalizeNextEnvAfterServices,
  nextEnvLauncherOwnerIsActive,
  prepareNextEnvRecovery,
  releaseNextEnvLock,
  removeCanonicalDirectoryTree,
  scavengeStaleE2ERunRoots,
  serializeNextEnvRunMarker,
  writeNextEnvLauncherHeartbeat,
  writeNextEnvRunMarker,
} from "./e2e-next-env-lock.mjs";

const deadToken = "00000000-0000-4000-8000-000000000001";
const liveToken = "00000000-0000-4000-8000-000000000002";
const contenderToken = "00000000-0000-4000-8000-000000000003";
const replacementToken = "00000000-0000-4000-8000-000000000004";

async function fixture(t) {
  const temporaryRoot = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryRoot, "aptiloop-e2e-lock-"));
  const runsRoot = path.join(root, "e2e-runs");
  const webRoot = path.join(root, "web");
  await mkdir(runsRoot);
  await mkdir(webRoot);
  t.after(async () => rm(root, { force: true, recursive: true }));
  return {
    lockPath: path.join(runsRoot, ".next-env.lock"),
    nextEnvPath: path.join(webRoot, "next-env.d.ts"),
    root,
    runsRoot,
    webRoot,
  };
}

async function registerOwner(runsRoot, owner) {
  await mkdir(path.join(runsRoot, owner.runId));
  await writeNextEnvRunMarker(runsRoot, owner);
}

async function createDirectoryLinkOrSkip(t, target, linkPath) {
  try {
    await symlink(
      target,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["EACCES", "EINVAL", "ENOTSUP", "EPERM"].includes(error.code)
    ) {
      t.skip(`Directory links are unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test("rejects an initial reparse ancestor before writing ownership state", async (t) => {
  const { root } = await fixture(t);
  const externalRoot = path.join(root, "external-target");
  const externalRunsRoot = path.join(externalRoot, "e2e-runs");
  const linkedParent = path.join(root, "linked-parent");
  const runId = "initial-reparse-run";
  await mkdir(path.join(externalRunsRoot, runId), { recursive: true });
  const sentinelPath = path.join(externalRoot, "sentinel.txt");
  await writeFile(sentinelPath, "outside-owned-root\n");
  if (!(await createDirectoryLinkOrSkip(t, externalRoot, linkedParent))) return;

  const owner = createNextEnvLockOwner(runId, {
    pid: process.pid,
    token: deadToken,
  });
  const linkedRunsRoot = path.join(linkedParent, "e2e-runs");
  await assert.rejects(
    writeNextEnvRunMarker(linkedRunsRoot, owner),
    /symlink|junction|reparse|native realpath/u,
  );

  assert.equal(await readFile(sentinelPath, "utf8"), "outside-owned-root\n");
  await assert.rejects(lstat(path.join(externalRunsRoot, runId, "run.json")), {
    code: "ENOENT",
  });
});

test("rejects reparse run roots and next-env ancestors without external writes", async (t) => {
  const { lockPath, root, runsRoot } = await fixture(t);
  const runId = "reparse-run-root";
  const externalRunRoot = path.join(root, "external-run-root");
  await mkdir(externalRunRoot);
  const runSentinel = path.join(externalRunRoot, "sentinel.txt");
  await writeFile(runSentinel, "external-run\n");
  if (
    !(await createDirectoryLinkOrSkip(
      t,
      externalRunRoot,
      path.join(runsRoot, runId),
    ))
  ) {
    return;
  }

  const owner = createNextEnvLockOwner(runId, {
    pid: process.pid,
    token: replacementToken,
  });
  await assert.rejects(
    writeNextEnvRunMarker(runsRoot, owner),
    /symlink|junction|reparse|native realpath/u,
  );
  assert.equal(await readFile(runSentinel, "utf8"), "external-run\n");

  const nextOwner = createNextEnvLockOwner("reparse-next-env", {
    pid: process.pid,
    token: contenderToken,
  });
  await registerOwner(runsRoot, nextOwner);
  const externalWebRoot = path.join(root, "external-web-root");
  const linkedWebRoot = path.join(root, "linked-web-root");
  await mkdir(externalWebRoot);
  const externalNextEnv = path.join(externalWebRoot, "next-env.d.ts");
  await writeFile(externalNextEnv, "external-next-env\n");
  if (!(await createDirectoryLinkOrSkip(t, externalWebRoot, linkedWebRoot))) {
    return;
  }

  await assert.rejects(
    acquireNextEnvLock({
      nextEnvPath: path.join(linkedWebRoot, "next-env.d.ts"),
      owner: nextOwner,
      runsRoot,
    }),
    /symlink|junction|reparse|native realpath/u,
  );
  assert.equal(await readFile(externalNextEnv, "utf8"), "external-next-env\n");
  await assert.rejects(lstat(lockPath), { code: "ENOENT" });
});

test("rejects a reparsed failure-artifact root before creating a destination", async (t) => {
  const { root } = await fixture(t);
  const externalVerifyRoot = path.join(root, "external-verify-root");
  const linkedVerifyRoot = path.join(root, "linked-verify-root");
  await mkdir(externalVerifyRoot);
  const sentinelPath = path.join(externalVerifyRoot, "sentinel.txt");
  await writeFile(sentinelPath, "external-failure-root\n");
  if (
    !(await createDirectoryLinkOrSkip(t, externalVerifyRoot, linkedVerifyRoot))
  ) {
    return;
  }

  await assert.rejects(
    ensureCanonicalDirectoryPath(path.join(linkedVerifyRoot, "e2e-failures")),
    /symlink|junction|reparse|native realpath/u,
  );
  assert.equal(await readFile(sentinelPath, "utf8"), "external-failure-root\n");
  await assert.rejects(lstat(path.join(externalVerifyRoot, "e2e-failures")), {
    code: "ENOENT",
  });
});

test("refuses unlink and recursive removal after an owned ancestor swap", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const owner = createNextEnvLockOwner("ancestor-swap-run", {
    pid: process.pid,
    token: liveToken,
  });
  await registerOwner(runsRoot, owner);
  const runRootGuard = await captureCanonicalDirectoryPath(
    path.join(runsRoot, owner.runId),
  );
  const lock = await acquireNextEnvLock({ nextEnvPath, owner, runsRoot });

  const parkedRunsRoot = `${runsRoot}-parked`;
  await rename(runsRoot, parkedRunsRoot);
  await mkdir(path.join(runsRoot, owner.runId), { recursive: true });
  const sentinelPath = path.join(runsRoot, owner.runId, "external.txt");
  await writeFile(sentinelPath, "must-survive\n");

  await assert.rejects(
    releaseNextEnvLock(lock),
    /identity changed|matching owned lock.*strong directory identity/u,
  );
  await assert.rejects(
    removeCanonicalDirectoryTree(runRootGuard),
    /identity changed/u,
  );
  assert.equal(await readFile(sentinelPath, "utf8"), "must-survive\n");

  await rm(runsRoot, { force: true, recursive: true });
  await rename(parkedRunsRoot, runsRoot);
  await releaseNextEnvLock(lock);
});

test("refuses next-env publication after its admitted parent is swapped", async (t) => {
  const { nextEnvPath, runsRoot, webRoot } = await fixture(t);
  const owner = createNextEnvLockOwner("next-env-parent-swap", {
    pid: process.pid,
    token: replacementToken,
  });
  const original = Buffer.from("owned-original\n", "utf8");
  const desired = Buffer.from("owned-desired\n", "utf8");
  await writeFile(nextEnvPath, original);
  await registerOwner(runsRoot, owner);
  const lock = await acquireNextEnvLock({ nextEnvPath, owner, runsRoot });
  const parkedWebRoot = `${webRoot}-parked`;
  const externalBytes = "external-must-survive\n";

  await assert.rejects(
    prepareNextEnvRecovery(lock, () => desired, {
      afterOriginalCapture: async () => {
        await rename(webRoot, parkedWebRoot);
        await mkdir(webRoot);
        await writeFile(nextEnvPath, externalBytes);
      },
    }),
    /directory identity changed/u,
  );
  assert.equal(await readFile(nextEnvPath, "utf8"), externalBytes);

  await rm(webRoot, { force: true, recursive: true });
  await rename(parkedWebRoot, webRoot);
  assert.equal(
    await finalizeNextEnvAfterServices(lock, { servicesQuiescent: true }),
    true,
  );
  assert.deepEqual(await readFile(nextEnvPath), original);
});

test("reclaims a stale authenticated heartbeat despite a live reused PID", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const staleOwner = createNextEnvLockOwner("stale-live-pid-run", {
    pid: 405_001,
    token: deadToken,
  });
  const contender = createNextEnvLockOwner("stale-live-pid-next", {
    pid: 405_001,
    token: contenderToken,
  });
  await registerOwner(runsRoot, staleOwner);
  const staleLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: staleOwner,
    runsRoot,
  });
  await writeNextEnvLauncherHeartbeat(runsRoot, staleOwner, {
    sequence: 1,
    updatedAtMs: 1,
  });

  assert.equal(
    await nextEnvLauncherOwnerIsActive({
      isProcessAlive: () => true,
      owner: staleOwner,
      runsRoot,
    }),
    false,
  );

  await registerOwner(runsRoot, contender);
  const nextLock = await acquireNextEnvLock({
    isProcessAlive: () => true,
    nextEnvPath,
    owner: contender,
    runsRoot,
    timeoutMs: 0,
  });
  await assert.rejects(
    releaseNextEnvLock(staleLock),
    /matching owned lock|directory identity changed/u,
  );
  await releaseNextEnvLock(nextLock);
});

test("reclaims a matching stale lock only after its launcher is proven dead", async (t) => {
  const { lockPath, nextEnvPath, runsRoot } = await fixture(t);
  const staleOwner = createNextEnvLockOwner("stale-owner-run", {
    pid: 410_001,
    token: deadToken,
  });
  const nextOwner = createNextEnvLockOwner("next-owner-run", {
    pid: 410_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  const staleLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: staleOwner,
    runsRoot,
  });
  await registerOwner(runsRoot, nextOwner);

  const nextLock = await acquireNextEnvLock({
    isProcessAlive: (pid) => pid !== staleOwner.pid,
    nextEnvPath,
    owner: nextOwner,
    runsRoot,
    timeoutMs: 0,
  });

  await assert.rejects(
    releaseNextEnvLock(staleLock),
    /matching owned lock|directory identity changed/u,
  );
  await releaseNextEnvLock(nextLock);
  await assert.rejects(lstat(lockPath), { code: "ENOENT" });
});

test("scavenges an authenticated stale lockless run after launcher death", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const staleOwner = createNextEnvLockOwner("scavenge-dead-owner", {
    pid: 415_001,
    token: deadToken,
  });
  const activeOwner = createNextEnvLockOwner("scavenge-active-owner", {
    pid: 415_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  await writeNextEnvLauncherHeartbeat(runsRoot, staleOwner, {
    sequence: 1,
    updatedAtMs: 1_000,
  });
  await writeFile(
    path.join(runsRoot, staleOwner.runId, "owned-sentinel.txt"),
    "stale owned bytes\n",
  );
  await registerOwner(runsRoot, activeOwner);
  const activeLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: activeOwner,
    runsRoot,
  });

  const removedRunIds = await scavengeStaleE2ERunRoots({
    isProcessAlive: (pid) => {
      assert.equal(pid, staleOwner.pid);
      return false;
    },
    lock: activeLock,
    maximumHeartbeatAgeMs: 1_000,
    now: () => 10_000,
  });

  assert.deepEqual(removedRunIds, [staleOwner.runId]);
  await assert.rejects(lstat(path.join(runsRoot, staleOwner.runId)), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(path.join(runsRoot, activeOwner.runId, "run.json"), "utf8"),
    serializeNextEnvRunMarker(activeOwner),
  );
  await releaseNextEnvLock(activeLock);
});

test("preserves a stale run while recorded service targets are live or ambiguous", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const staleOwner = createNextEnvLockOwner("scavenge-live-service", {
    pid: 415_101,
    token: deadToken,
  });
  const activeOwner = createNextEnvLockOwner("scavenge-service-active", {
    pid: 415_102,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  await writeNextEnvLauncherHeartbeat(runsRoot, staleOwner, {
    sequence: 1,
    updatedAtMs: 1_000,
  });
  await registerOwner(runsRoot, activeOwner);
  const activeLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: activeOwner,
    runsRoot,
  });
  const staleRunRoot = path.join(runsRoot, staleOwner.runId);
  const serviceChild = spawn(
    process.execPath,
    ["--eval", "setInterval(() => undefined, 1000)"],
    { stdio: "ignore", windowsHide: true },
  );
  t.after(() => {
    if (serviceChild.exitCode === null && serviceChild.signalCode === null) {
      serviceChild.kill();
    }
  });
  await once(serviceChild, "spawn");
  assert.ok(serviceChild.pid);

  const expectPreserved = async (beforeRemove, expectedError) => {
    await assert.rejects(
      scavengeStaleE2ERunRoots({
        beforeRemove,
        isProcessAlive: () => false,
        lock: activeLock,
        maximumHeartbeatAgeMs: 1_000,
        now: () => 10_000,
      }),
      expectedError,
    );
    assert.equal((await lstat(staleRunRoot)).isDirectory(), true);
  };
  const syntheticRecord = { childPid: 415_104, launcherPid: 415_103 };
  await expectPreserved(
    () =>
      assertE2EServiceProcessTargetsDead(syntheticRecord, {
        isProcessAlive: (pid) => pid === syntheticRecord.childPid,
      }),
    /recorded service child PID 415104 is live or ambiguous/u,
  );
  await expectPreserved(
    () =>
      assertE2EServiceProcessTargetsDead(syntheticRecord, {
        isProcessAlive: (pid) =>
          pid === syntheticRecord.launcherPid ? false : undefined,
      }),
    /recorded service child PID 415104 is live or ambiguous/u,
  );
  await expectPreserved(
    () =>
      assertE2EServiceProcessTargetsDead(syntheticRecord, {
        isProcessAlive: (pid) => {
          if (pid === syntheticRecord.launcherPid) return false;
          throw new Error("ambiguous process state");
        },
      }),
    /recorded service child PID 415104 could not be proven dead/u,
  );
  const liveRecord = {
    childPid: serviceChild.pid,
    launcherPid: serviceChild.pid,
  };
  await expectPreserved(
    () => assertE2EServiceProcessTargetsDead(liveRecord),
    /recorded service launcher PID .* is live or ambiguous/u,
  );

  const closed = once(serviceChild, "close");
  serviceChild.kill();
  await closed;
  const removedRunIds = await scavengeStaleE2ERunRoots({
    beforeRemove: () => assertE2EServiceProcessTargetsDead(liveRecord),
    isProcessAlive: () => false,
    lock: activeLock,
    maximumHeartbeatAgeMs: 1_000,
    now: () => 10_000,
  });
  assert.deepEqual(removedRunIds, [staleOwner.runId]);
  await assert.rejects(lstat(staleRunRoot), { code: "ENOENT" });
  await releaseNextEnvLock(activeLock);
});

test("preserves live, fresh, malformed, unauthenticated, and ambiguous run roots", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const staleLiveOwner = createNextEnvLockOwner("scavenge-stale-live", {
    pid: 416_001,
    token: deadToken,
  });
  const freshDeadOwner = createNextEnvLockOwner("scavenge-fresh-dead", {
    pid: 416_002,
    token: contenderToken,
  });
  const unauthenticatedOwner = createNextEnvLockOwner(
    "scavenge-unauthenticated",
    {
      pid: 416_003,
      token: replacementToken,
    },
  );
  const ambiguousOwner = createNextEnvLockOwner("scavenge-ambiguous", {
    pid: 416_004,
    token: liveToken,
  });
  const pendingRecoveryOwner = createNextEnvLockOwner(
    "scavenge-pending-recovery",
    {
      pid: 416_005,
      token: deadToken,
    },
  );
  const activeOwner = createNextEnvLockOwner("scavenge-preserve-active", {
    pid: 416_006,
    token: contenderToken,
  });

  for (const owner of [
    staleLiveOwner,
    freshDeadOwner,
    unauthenticatedOwner,
    ambiguousOwner,
    pendingRecoveryOwner,
    activeOwner,
  ]) {
    await registerOwner(runsRoot, owner);
  }
  for (const owner of [
    staleLiveOwner,
    unauthenticatedOwner,
    ambiguousOwner,
    pendingRecoveryOwner,
  ]) {
    await writeNextEnvLauncherHeartbeat(runsRoot, owner, {
      sequence: 1,
      updatedAtMs: 1_000,
    });
  }
  await writeNextEnvLauncherHeartbeat(runsRoot, freshDeadOwner, {
    sequence: 1,
    updatedAtMs: 9_500,
  });
  const pendingRecoveryPath = path.join(
    runsRoot,
    pendingRecoveryOwner.runId,
    `next-env-recovery-${pendingRecoveryOwner.token}.json`,
  );
  await writeFile(
    pendingRecoveryPath,
    "unresolved recovery state must survive\n",
  );

  const unauthenticatedHeartbeatPath = path.join(
    runsRoot,
    unauthenticatedOwner.runId,
    "launcher-heartbeat.json",
  );
  const unauthenticatedHeartbeat = JSON.parse(
    await readFile(unauthenticatedHeartbeatPath, "utf8"),
  );
  unauthenticatedHeartbeat.authenticator = "0".repeat(64);
  await writeFile(
    unauthenticatedHeartbeatPath,
    `${JSON.stringify(unauthenticatedHeartbeat, null, 2)}\n`,
  );

  const malformedRunId = "scavenge-malformed";
  const malformedRunRoot = path.join(runsRoot, malformedRunId);
  await mkdir(malformedRunRoot);
  await writeFile(path.join(malformedRunRoot, "run.json"), "{}\n");
  await writeFile(
    path.join(malformedRunRoot, "owned-sentinel.txt"),
    "malformed must survive\n",
  );

  const activeLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: activeOwner,
    runsRoot,
  });
  const removedRunIds = await scavengeStaleE2ERunRoots({
    isProcessAlive: (pid) => {
      if (pid === staleLiveOwner.pid) return true;
      if (pid === ambiguousOwner.pid) return undefined;
      throw new Error(`Unexpected launcher liveness check for PID ${pid}`);
    },
    lock: activeLock,
    maximumHeartbeatAgeMs: 1_000,
    now: () => 10_000,
  });

  assert.deepEqual(removedRunIds, []);
  for (const runId of [
    staleLiveOwner.runId,
    freshDeadOwner.runId,
    unauthenticatedOwner.runId,
    ambiguousOwner.runId,
    pendingRecoveryOwner.runId,
    activeOwner.runId,
    malformedRunId,
  ]) {
    assert.equal((await lstat(path.join(runsRoot, runId))).isDirectory(), true);
  }
  assert.equal(
    await readFile(path.join(malformedRunRoot, "owned-sentinel.txt"), "utf8"),
    "malformed must survive\n",
  );
  assert.equal(
    await readFile(pendingRecoveryPath, "utf8"),
    "unresolved recovery state must survive\n",
  );
  await releaseNextEnvLock(activeLock);
});

test("preserves a replacement installed at the stale-run removal seam", async (t) => {
  const { nextEnvPath, root, runsRoot } = await fixture(t);
  const staleOwner = createNextEnvLockOwner("scavenge-identity-race", {
    pid: 417_001,
    token: deadToken,
  });
  const activeOwner = createNextEnvLockOwner("scavenge-race-active", {
    pid: 417_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  await writeNextEnvLauncherHeartbeat(runsRoot, staleOwner, {
    sequence: 1,
    updatedAtMs: 1_000,
  });
  await registerOwner(runsRoot, activeOwner);
  const activeLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: activeOwner,
    runsRoot,
  });
  const staleRunRoot = path.join(runsRoot, staleOwner.runId);
  const parkedRunRoot = path.join(root, "parked-scavenge-identity-race");
  let hookCalls = 0;

  const removedRunIds = await scavengeStaleE2ERunRoots({
    beforeRemove: async ({ owner, runRoot }) => {
      hookCalls += 1;
      assert.deepEqual(owner, staleOwner);
      assert.equal(runRoot, staleRunRoot);
      await rename(staleRunRoot, parkedRunRoot);
      await mkdir(staleRunRoot);
      await writeFile(
        path.join(staleRunRoot, "replacement-sentinel.txt"),
        "replacement must survive\n",
      );
    },
    isProcessAlive: () => false,
    lock: activeLock,
    maximumHeartbeatAgeMs: 1_000,
    now: () => 10_000,
  });

  assert.equal(hookCalls, 1);
  assert.deepEqual(removedRunIds, []);
  assert.equal(
    await readFile(path.join(staleRunRoot, "replacement-sentinel.txt"), "utf8"),
    "replacement must survive\n",
  );
  assert.equal(
    await readFile(path.join(parkedRunRoot, "run.json"), "utf8"),
    serializeNextEnvRunMarker(staleOwner),
  );
  await releaseNextEnvLock(activeLock);
});

test("refuses stale-run removal after the authenticated active lock changes", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const staleOwner = createNextEnvLockOwner("scavenge-lock-race-dead", {
    pid: 418_001,
    token: deadToken,
  });
  const activeOwner = createNextEnvLockOwner("scavenge-lock-race-active", {
    pid: 418_002,
    token: liveToken,
  });
  const replacementOwner = createNextEnvLockOwner(
    "scavenge-lock-race-replacement",
    {
      pid: 418_003,
      token: replacementToken,
    },
  );
  await registerOwner(runsRoot, staleOwner);
  await writeNextEnvLauncherHeartbeat(runsRoot, staleOwner, {
    sequence: 1,
    updatedAtMs: 1_000,
  });
  await registerOwner(runsRoot, activeOwner);
  await registerOwner(runsRoot, replacementOwner);
  const activeLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: activeOwner,
    runsRoot,
  });
  let replacementLock;

  await assert.rejects(
    scavengeStaleE2ERunRoots({
      beforeRemove: async () => {
        await releaseNextEnvLock(activeLock);
        replacementLock = await acquireNextEnvLock({
          nextEnvPath,
          owner: replacementOwner,
          runsRoot,
        });
      },
      isProcessAlive: () => false,
      lock: activeLock,
      maximumHeartbeatAgeMs: 1_000,
      now: () => 10_000,
    }),
    /directory identity changed|matching owned lock and its strong directory identity/u,
  );

  assert.ok(replacementLock);
  assert.equal(
    (await lstat(path.join(runsRoot, staleOwner.runId))).isDirectory(),
    true,
  );
  await releaseNextEnvLock(replacementLock);
});

test("preserves a matching lock while its launcher is live", async (t) => {
  const { lockPath, nextEnvPath, runsRoot } = await fixture(t);
  const liveOwner = createNextEnvLockOwner("live-owner-run", {
    pid: 420_001,
    token: liveToken,
  });
  const contender = createNextEnvLockOwner("live-contender-run", {
    pid: 420_002,
    token: contenderToken,
  });
  await registerOwner(runsRoot, liveOwner);
  const liveLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: liveOwner,
    runsRoot,
  });
  const originalEntries = await readdir(lockPath);
  await registerOwner(runsRoot, contender);

  await assert.rejects(
    acquireNextEnvLock({
      isProcessAlive: () => true,
      nextEnvPath,
      owner: contender,
      runsRoot,
      timeoutMs: 0,
    }),
    /held by live launcher PID 420001 for run live-owner-run/u,
  );
  assert.deepEqual(await readdir(lockPath), originalEntries);
  await releaseNextEnvLock(liveLock);
});

test("aborts a waiting contender without disturbing the live lock", async (t) => {
  const { lockPath, nextEnvPath, runsRoot } = await fixture(t);
  const liveOwner = createNextEnvLockOwner("abort-live-owner", {
    pid: 425_001,
    token: liveToken,
  });
  const contender = createNextEnvLockOwner("abort-contender", {
    pid: 425_002,
    token: contenderToken,
  });
  await registerOwner(runsRoot, liveOwner);
  const liveLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: liveOwner,
    runsRoot,
  });
  const originalEntries = await readdir(lockPath);
  await registerOwner(runsRoot, contender);
  const controller = new AbortController();

  await assert.rejects(
    acquireNextEnvLock({
      isProcessAlive: () => true,
      nextEnvPath,
      owner: contender,
      runsRoot,
      signal: controller.signal,
      sleep: async () => controller.abort(),
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(await readdir(lockPath), originalEntries);
  await releaseNextEnvLock(liveLock);
});

test("requires both live PID and exact token-bound marker for service ownership", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const owner = createNextEnvLockOwner("watchdog-owner-run", {
    pid: 427_001,
    token: liveToken,
  });
  await registerOwner(runsRoot, owner);
  const lock = await acquireNextEnvLock({ nextEnvPath, owner, runsRoot });

  assert.equal(
    await nextEnvLauncherOwnerIsActive({
      isProcessAlive: () => true,
      owner,
      runsRoot,
    }),
    true,
  );
  assert.equal(
    await nextEnvLauncherOwnerIsActive({
      isProcessAlive: () => false,
      owner,
      runsRoot,
    }),
    false,
  );

  const replacement = createNextEnvLockOwner(owner.runId, {
    pid: owner.pid,
    token: replacementToken,
  });
  await writeFile(
    path.join(runsRoot, owner.runId, "run.json"),
    serializeNextEnvRunMarker(replacement),
  );
  assert.equal(
    await nextEnvLauncherOwnerIsActive({
      isProcessAlive: () => true,
      owner,
      runsRoot,
    }),
    false,
  );
  await writeFile(
    path.join(runsRoot, owner.runId, "run.json"),
    serializeNextEnvRunMarker(owner),
  );
  await releaseNextEnvLock(lock);
});

test("retains desired bytes, journal, and lock until services are quiescent", async (t) => {
  const { lockPath, nextEnvPath, runsRoot } = await fixture(t);
  const original = Buffer.from("quiescence original bytes\n", "utf8");
  const desired = Buffer.from("quiescence desired bytes\n", "utf8");
  await writeFile(nextEnvPath, original);
  const owner = createNextEnvLockOwner("quiescence-owner", {
    pid: 428_001,
    token: deadToken,
  });
  await registerOwner(runsRoot, owner);
  const lock = await acquireNextEnvLock({ nextEnvPath, owner, runsRoot });
  await prepareNextEnvRecovery(lock, () => desired);

  assert.equal(
    await finalizeNextEnvAfterServices(lock, { servicesQuiescent: false }),
    false,
  );
  assert.deepEqual(await readFile(nextEnvPath), desired);
  assert.equal((await readdir(lockPath)).length, 1);

  assert.equal(
    await finalizeNextEnvAfterServices(lock, { servicesQuiescent: true }),
    true,
  );
  assert.deepEqual(await readFile(nextEnvPath), original);
  await assert.rejects(lstat(lockPath), { code: "ENOENT" });
});

test("tolerates transient ownership reads before terminating a controlled service child", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const owner = createNextEnvLockOwner("child-watchdog-run", {
    pid: process.pid,
    token: deadToken,
  });
  await registerOwner(runsRoot, owner);
  const lock = await acquireNextEnvLock({ nextEnvPath, owner, runsRoot });
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.resolve("scripts/e2e-service-owner-watchdog.mjs"))
        .href,
      "--eval",
      "console.log('ready'); setInterval(() => undefined, 1000)",
    ],
    {
      env: {
        ...process.env,
        E2E_LAUNCHER_PID: String(owner.pid),
        E2E_LOCK_TOKEN: owner.token,
        E2E_RUN_ID: owner.runId,
        E2E_RUN_ROOT: path.join(runsRoot, owner.runId),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stdout.removeListener("data", onData);
      if (error) reject(error);
      else resolve();
    };
    const evidence = (message) =>
      new Error(`${message}; stderr: ${stderr.trim() || "<empty>"}`);
    const onError = (error) =>
      finish(evidence(`watchdog spawn failed: ${error.message}`));
    const onClose = (code, signal) =>
      finish(
        evidence(
          `watchdog exited before ready (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    const onData = (chunk) => {
      if (chunk.includes("ready")) finish();
    };
    const timer = setTimeout(
      () => finish(evidence("watchdog did not emit ready within 5 seconds")),
      5_000,
    );
    child.once("error", onError);
    child.once("close", onClose);
    child.stdout.on("data", onData);
  });

  const heartbeatPath = path.join(
    runsRoot,
    owner.runId,
    "launcher-heartbeat.json",
  );
  const exactHeartbeat = await readFile(heartbeatPath);
  await writeFile(heartbeatPath, "{}\n");
  await new Promise((resolve) => setTimeout(resolve, 350));
  await writeFile(heartbeatPath, exactHeartbeat);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);

  await releaseNextEnvLock(lock);
  const closed = once(child, "close");
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `service watchdog did not stop its child (code=${String(child.exitCode)}, signal=${String(child.signalCode)}); stderr: ${stderr.trim() || "<empty>"}`,
        ),
      );
    }, 5_000);
  });
  try {
    await Promise.race([closed, timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
});

test("leaves malformed lock state byte-for-byte untouched", async (t) => {
  const { lockPath, nextEnvPath, runsRoot } = await fixture(t);
  const contender = createNextEnvLockOwner("malformed-contender", {
    pid: 430_001,
    token: contenderToken,
  });
  await registerOwner(runsRoot, contender);
  const foreignBytes =
    "foreign lock format\nwith no Aptiloop ownership proof\n";
  await writeFile(lockPath, foreignBytes, { encoding: "utf8", flag: "wx" });

  await assert.rejects(
    acquireNextEnvLock({
      nextEnvPath,
      owner: contender,
      runsRoot,
      timeoutMs: 0,
    }),
    /owner metadata is malformed/u,
  );
  assert.equal(await readFile(lockPath, "utf8"), foreignBytes);
});

test("leaves a well-formed lock untouched when its run marker does not match", async (t) => {
  const { lockPath, nextEnvPath, runsRoot } = await fixture(t);
  const foreignOwner = createNextEnvLockOwner("foreign-owner-run", {
    pid: 440_001,
    token: deadToken,
  });
  const mismatchedMarker = createNextEnvLockOwner("foreign-owner-run", {
    pid: foreignOwner.pid,
    token: replacementToken,
  });
  const contender = createNextEnvLockOwner("foreign-contender", {
    pid: 440_002,
    token: contenderToken,
  });
  await registerOwner(runsRoot, foreignOwner);
  const foreignLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: foreignOwner,
    runsRoot,
  });
  const originalEntries = await readdir(lockPath);
  await writeFile(
    path.join(runsRoot, foreignOwner.runId, "run.json"),
    serializeNextEnvRunMarker(mismatchedMarker),
  );
  await registerOwner(runsRoot, contender);

  await assert.rejects(
    acquireNextEnvLock({
      nextEnvPath,
      owner: contender,
      runsRoot,
      timeoutMs: 0,
    }),
    /launcher marker is missing or does not match/u,
  );
  assert.deepEqual(await readdir(lockPath), originalEntries);

  await writeFile(
    path.join(runsRoot, foreignOwner.runId, "run.json"),
    serializeNextEnvRunMarker(foreignOwner),
  );
  await releaseNextEnvLock(foreignLock);
});

test("preserves a replacement token installed while stale reclamation is paused", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const staleOwner = createNextEnvLockOwner("racing-stale-owner", {
    pid: 450_001,
    token: deadToken,
  });
  const replacementOwner = createNextEnvLockOwner("racing-live-owner", {
    pid: 450_002,
    token: replacementToken,
  });
  const contender = createNextEnvLockOwner("racing-contender", {
    pid: 450_003,
    token: contenderToken,
  });
  await registerOwner(runsRoot, staleOwner);
  await registerOwner(runsRoot, replacementOwner);
  await registerOwner(runsRoot, contender);
  const staleLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: staleOwner,
    runsRoot,
  });
  let replacementLock;
  let hookCalls = 0;

  await assert.rejects(
    acquireNextEnvLock({
      beforeReclaim: async () => {
        hookCalls += 1;
        await releaseNextEnvLock(staleLock);
        replacementLock = await acquireNextEnvLock({
          nextEnvPath,
          owner: replacementOwner,
          runsRoot,
        });
      },
      isProcessAlive: (pid) => pid !== staleOwner.pid,
      nextEnvPath,
      owner: contender,
      runsRoot,
      timeoutMs: 0,
    }),
    /ownership changed during stale lock reclamation; the replacement was preserved/u,
  );

  assert.equal(hookCalls, 1);
  assert.ok(replacementLock);
  await releaseNextEnvLock(replacementLock);
});

test("recovers an empty lock directory left between owner unlink and rmdir", async (t) => {
  const { lockPath, nextEnvPath, runsRoot } = await fixture(t);
  const interruptedOwner = createNextEnvLockOwner("unlink-crash-owner", {
    pid: 460_001,
    token: deadToken,
  });
  const nextOwner = createNextEnvLockOwner("unlink-crash-next", {
    pid: 460_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, interruptedOwner);
  const interruptedLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: interruptedOwner,
    runsRoot,
  });
  await assert.rejects(
    releaseNextEnvLock(interruptedLock, {
      afterOwnerUnlink: () => {
        throw new Error("simulated hard termination");
      },
    }),
    /simulated hard termination/u,
  );
  assert.deepEqual(await readdir(lockPath), []);
  await registerOwner(runsRoot, nextOwner);

  const nextLock = await acquireNextEnvLock({
    emptyLockGraceMs: 0,
    nextEnvPath,
    owner: nextOwner,
    runsRoot,
    timeoutMs: 0,
  });
  await releaseNextEnvLock(nextLock);
});

test("restores exact pre-launch bytes before reclaiming a hard-killed owner", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const original = Buffer.from("original next-env bytes\r\n", "utf8");
  const staleDesired = Buffer.from("stale isolated distDir bytes\r\n", "utf8");
  await writeFile(nextEnvPath, original);
  const staleOwner = createNextEnvLockOwner("journal-stale-owner", {
    pid: 470_001,
    token: deadToken,
  });
  const nextOwner = createNextEnvLockOwner("journal-next-owner", {
    pid: 470_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  const staleLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: staleOwner,
    runsRoot,
  });
  await prepareNextEnvRecovery(staleLock, (observedOriginal) => {
    assert.deepEqual(observedOriginal, original);
    return staleDesired;
  });
  assert.deepEqual(await readFile(nextEnvPath), staleDesired);
  await registerOwner(runsRoot, nextOwner);

  const nextLock = await acquireNextEnvLock({
    isProcessAlive: (pid) => pid !== staleOwner.pid,
    nextEnvPath,
    owner: nextOwner,
    runsRoot,
    timeoutMs: 0,
  });
  assert.deepEqual(await readFile(nextEnvPath), original);
  await releaseNextEnvLock(nextLock);
});

test("recovers after hard termination immediately following atomic desired installation", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const original = Buffer.from("atomic original bytes\n", "utf8");
  const desired = Buffer.from("atomic desired bytes\n", "utf8");
  await writeFile(nextEnvPath, original);
  const staleOwner = createNextEnvLockOwner("atomic-stale-owner", {
    pid: 475_001,
    token: deadToken,
  });
  const nextOwner = createNextEnvLockOwner("atomic-next-owner", {
    pid: 475_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  const staleLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: staleOwner,
    runsRoot,
  });

  await assert.rejects(
    prepareNextEnvRecovery(staleLock, () => desired, {
      afterDesiredInstall: () => {
        throw new Error("simulated hard termination after atomic install");
      },
    }),
    /simulated hard termination after atomic install/u,
  );
  assert.deepEqual(await readFile(nextEnvPath), desired);
  await registerOwner(runsRoot, nextOwner);

  const nextLock = await acquireNextEnvLock({
    isProcessAlive: (pid) => pid !== staleOwner.pid,
    nextEnvPath,
    owner: nextOwner,
    runsRoot,
    timeoutMs: 0,
  });
  assert.deepEqual(await readFile(nextEnvPath), original);
  await releaseNextEnvLock(nextLock);
});

test("preserves a concurrent next-env edit and refuses stale reclamation", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const original = Buffer.from("original bytes\n", "utf8");
  const staleDesired = Buffer.from("stale desired bytes\n", "utf8");
  const concurrentEdit = Buffer.from(
    "user-authored concurrent bytes\n",
    "utf8",
  );
  await writeFile(nextEnvPath, original);
  const staleOwner = createNextEnvLockOwner("journal-edit-owner", {
    pid: 480_001,
    token: deadToken,
  });
  const contender = createNextEnvLockOwner("journal-edit-next", {
    pid: 480_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  const staleLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: staleOwner,
    runsRoot,
  });
  await prepareNextEnvRecovery(staleLock, () => staleDesired);
  await writeFile(nextEnvPath, concurrentEdit);
  await registerOwner(runsRoot, contender);

  await assert.rejects(
    acquireNextEnvLock({
      isProcessAlive: (pid) => pid !== staleOwner.pid,
      nextEnvPath,
      owner: contender,
      runsRoot,
      timeoutMs: 0,
    }),
    /bytes or mode are neither the journaled original nor the stale launcher's desired state/u,
  );
  assert.deepEqual(await readFile(nextEnvPath), concurrentEdit);
});

test("preserves a replacement created at the original-publication seam", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const original = Buffer.from("publication original bytes\n", "utf8");
  const desired = Buffer.from("publication desired bytes\n", "utf8");
  const replacement = Buffer.from("publication-race user bytes\n", "utf8");
  await writeFile(nextEnvPath, original);
  const staleOwner = createNextEnvLockOwner("publish-race-owner", {
    pid: 485_001,
    token: deadToken,
  });
  const contender = createNextEnvLockOwner("publish-race-next", {
    pid: 485_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  const staleLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: staleOwner,
    runsRoot,
  });
  await prepareNextEnvRecovery(staleLock, () => desired);
  await registerOwner(runsRoot, contender);

  await assert.rejects(
    acquireNextEnvLock({
      beforeOriginalPublish: () => writeFile(nextEnvPath, replacement),
      isProcessAlive: (pid) => pid !== staleOwner.pid,
      nextEnvPath,
      owner: contender,
      runsRoot,
      timeoutMs: 0,
    }),
    /reappeared before original-content publication/u,
  );
  assert.deepEqual(await readFile(nextEnvPath), replacement);
});

test("restores an originally absent next-env file after stale mutation", async (t) => {
  const { nextEnvPath, runsRoot } = await fixture(t);
  const staleDesired = Buffer.from("generated stale next-env bytes\n", "utf8");
  const staleOwner = createNextEnvLockOwner("absent-stale-owner", {
    pid: 490_001,
    token: deadToken,
  });
  const nextOwner = createNextEnvLockOwner("absent-next-owner", {
    pid: 490_002,
    token: liveToken,
  });
  await registerOwner(runsRoot, staleOwner);
  const staleLock = await acquireNextEnvLock({
    nextEnvPath,
    owner: staleOwner,
    runsRoot,
  });
  await prepareNextEnvRecovery(staleLock, (observedOriginal) => {
    assert.equal(observedOriginal, undefined);
    return staleDesired;
  });
  assert.deepEqual(await readFile(nextEnvPath), staleDesired);
  await registerOwner(runsRoot, nextOwner);

  const nextLock = await acquireNextEnvLock({
    isProcessAlive: (pid) => pid !== staleOwner.pid,
    nextEnvPath,
    owner: nextOwner,
    runsRoot,
    timeoutMs: 0,
  });
  await assert.rejects(lstat(nextEnvPath), { code: "ENOENT" });
  await releaseNextEnvLock(nextLock);
});
