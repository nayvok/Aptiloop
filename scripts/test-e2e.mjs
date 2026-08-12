import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { EOL } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createE2EEnvironment } from "./e2e-environment.mjs";
import { createOwnerWatchdogPolicy } from "./e2e-owner-watchdog.mjs";
import {
  acquireNextEnvLock,
  assertE2EServiceProcessTargetsDead,
  assertCanonicalDirectoryPath,
  assertCanonicalDirectoryDescendantPath,
  assertCanonicalFilePath,
  assertValidE2ERunId,
  captureCanonicalDirectoryPath,
  captureCanonicalFilePath,
  createExclusiveCanonicalDirectoryPath,
  createNextEnvLockOwner,
  ensureCanonicalDirectoryPath,
  finalizeNextEnvAfterServices,
  nextEnvLauncherOwnerIsActive,
  prepareNextEnvRecovery,
  removeCanonicalDirectoryTree,
  renameCanonicalDirectoryPath,
  scavengeStaleE2ERunRoots,
  startNextEnvLauncherHeartbeat,
  unlinkCanonicalFilePath,
  writeNextEnvRunMarker,
} from "./e2e-next-env-lock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(root, "apps", "web");
const runsRoot = path.join(root, ".data", "e2e-runs");
const failureArtifactsRoot = path.join(root, ".verify", "e2e-failures");
const nextEnvPath = path.join(webRoot, "next-env.d.ts");
const orchestratorPort = 8887;
const webPort = 3100;
const orchestratorOrigin = `http://127.0.0.1:${orchestratorPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const serviceNames = { orchestrator: true, web: true };
const servicePorts = { orchestrator: orchestratorPort, web: webPort };
const defaultOpenCodeEndpoint = "http://127.0.0.1:4096";

if (process.argv[2] === "--service") {
  process.exitCode = await runService(process.argv[3]);
} else {
  process.exitCode = await runSuite();
}

async function runSuite() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is required to run the isolated E2E suite");
  }

  const runId = createRunId();
  const nextEnvLockOwner = createNextEnvLockOwner(runId);
  const runRoot = path.join(runsRoot, runId);
  const databasePath = path.join(runRoot, "database.sqlite");
  const attemptsRoot = path.join(runRoot, "exercise-attempts");
  const nextOutputPath = path.join(runRoot, "next");
  const nextDistDir = path
    .relative(webRoot, nextOutputPath)
    .split(path.sep)
    .join("/");
  const runEnvironment = createE2EEnvironment(process.env, {
    DATABASE_PATH: databasePath,
    DATABASE_URL: databasePath,
    E2E_ATTEMPTS_ROOT: attemptsRoot,
    E2E_DATABASE_PATH: databasePath,
    E2E_LAUNCHER_PID: String(nextEnvLockOwner.pid),
    E2E_LOCK_TOKEN: nextEnvLockOwner.token,
    E2E_ORCHESTRATOR_ORIGIN: orchestratorOrigin,
    E2E_ORCHESTRATOR_PORT: String(orchestratorPort),
    E2E_RUN_ID: runId,
    E2E_RUN_ROOT: runRoot,
    E2E_WEB_ORIGIN: webOrigin,
    E2E_WEB_PORT: String(webPort),
    EXERCISE_ATTEMPTS_ROOT: attemptsRoot,
    NEXT_DIST_DIR: nextDistDir,
    NODE_ENV: "test",
    OPENCODE_ENDPOINT: defaultOpenCodeEndpoint,
    ORCHESTRATOR_BIND_MODE: "direct",
    ORCHESTRATOR_URL: orchestratorOrigin,
  });

  const runsRootGuard = await ensureCanonicalDirectoryPath(runsRoot);
  const runRootGuard = await createExclusiveCanonicalDirectoryPath(
    runRoot,
    runsRootGuard,
  );
  await assertOwnedRunRoot(runRoot, runId, runRootGuard);
  await writeNextEnvRunMarker(runsRoot, nextEnvLockOwner);

  let nextEnvLock;
  let nextEnvLockReleased = false;
  let playwrightChild;
  let launcherHeartbeat;
  let heartbeatFailure;
  let exitCode = 1;
  let failure;
  let receivedSignal;
  const cleanupErrors = [];
  const lockAcquisitionAbort = new AbortController();

  const requestShutdown = (signal) => {
    receivedSignal ??= signal;
    lockAcquisitionAbort.abort();
    if (childProcessIsRunning(playwrightChild)) {
      void terminateProcessTree(playwrightChild.pid);
    }
  };
  const loseLauncherOwnership = (error) => {
    heartbeatFailure ??= asError(error);
    lockAcquisitionAbort.abort();
    if (childProcessIsRunning(playwrightChild)) {
      void terminateProcessTree(playwrightChild.pid);
    }
  };
  const onSigint = () => requestShutdown("SIGINT");
  const onSigterm = () => requestShutdown("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    launcherHeartbeat = await startNextEnvLauncherHeartbeat({
      onFailure: loseLauncherOwnership,
      owner: nextEnvLockOwner,
      runsRoot,
    });
    if (heartbeatFailure) throw heartbeatFailure;
    nextEnvLock = await acquireNextEnvLock({
      beforeReclaim: ({ owner }) =>
        waitForStaleOwnerServices(owner, lockAcquisitionAbort.signal),
      owner: nextEnvLockOwner,
      nextEnvPath,
      signal: lockAcquisitionAbort.signal,
      runsRoot,
    });
    const scavengedRunIds = await scavengeStaleE2ERunRoots({
      beforeRemove: ({ owner }) =>
        waitForStaleOwnerServices(owner, lockAcquisitionAbort.signal),
      lock: nextEnvLock,
      signal: lockAcquisitionAbort.signal,
    });
    for (const scavengedRunId of scavengedRunIds) {
      console.error(`[e2e] Removed stale owned run root ${scavengedRunId}`);
    }
    if (heartbeatFailure) throw heartbeatFailure;
    lockAcquisitionAbort.signal.throwIfAborted();
    await assertPortsAvailable([
      ["orchestrator", orchestratorPort],
      ["web", webPort],
    ]);
    if (heartbeatFailure) throw heartbeatFailure;
    lockAcquisitionAbort.signal.throwIfAborted();
    await prepareNextEnvRecovery(nextEnvLock, (original) =>
      expectedNextEnv(nextDistDir, original),
    );
    if (heartbeatFailure) throw heartbeatFailure;
    lockAcquisitionAbort.signal.throwIfAborted();

    playwrightChild = spawn(
      process.execPath,
      [npmCli, "run", "test:e2e", "--workspace=@aptiloop/web"],
      {
        cwd: root,
        detached: process.platform !== "win32",
        env: runEnvironment,
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    exitCode = await waitForChild(playwrightChild);
    if (heartbeatFailure) throw heartbeatFailure;
  } catch (error) {
    const caught = heartbeatFailure ?? asError(error);
    if (!(receivedSignal && caught.name === "AbortError")) failure = caught;
  } finally {
    if (
      playwrightChild?.pid !== undefined &&
      playwrightChild.exitCode === null &&
      playwrightChild.signalCode === null
    ) {
      await collectCleanupError(
        "terminate the Playwright process tree",
        () => terminateProcessTree(playwrightChild.pid),
        cleanupErrors,
      );
    }
    await collectCleanupError(
      "validate recorded E2E services",
      () => cleanupRecordedServices(runRootGuard, nextEnvLockOwner),
      cleanupErrors,
    );
    let servicesQuiescent = playwrightChild?.pid === undefined;
    if (!servicesQuiescent) {
      try {
        await waitForCurrentRunServicesReleased(runRootGuard, nextEnvLockOwner);
        servicesQuiescent = true;
      } catch (error) {
        cleanupErrors.push(
          new Error(
            `confirm E2E service quiescence: ${asError(error).message}`,
          ),
        );
      }
    }

    if (nextEnvLock && servicesQuiescent) {
      try {
        nextEnvLockReleased = await finalizeNextEnvAfterServices(nextEnvLock, {
          servicesQuiescent,
        });
      } catch (error) {
        cleanupErrors.push(
          new Error(
            `finalize the next-env.d.ts lock: ${asError(error).message}`,
          ),
        );
      }
    }

    if (launcherHeartbeat) {
      await collectCleanupError(
        "stop the E2E launcher heartbeat",
        () => launcherHeartbeat.stop(),
        cleanupErrors,
      );
    }
    if (heartbeatFailure && !failure) failure = heartbeatFailure;

    const shouldPreserveArtifacts =
      Boolean(failure) ||
      exitCode !== 0 ||
      cleanupErrors.length > 0 ||
      receivedSignal !== undefined;
    let preservationFailed = false;
    if (shouldPreserveArtifacts) {
      try {
        const artifactPath = await preserveFailureArtifacts(
          runRootGuard,
          runId,
          {
            cleanupErrorCount: cleanupErrors.length,
            exitCode,
            launcherError: Boolean(failure),
            receivedSignal,
          },
        );
        console.error(`[e2e] Failure artifacts retained at ${artifactPath}`);
      } catch (error) {
        preservationFailed = true;
        cleanupErrors.push(
          new Error(
            `preserve E2E failure artifacts: ${asError(error).message}`,
          ),
        );
      }
    }

    if (!preservationFailed && (!nextEnvLock || nextEnvLockReleased)) {
      await collectCleanupError(
        "remove the owned E2E run root",
        async () => {
          await assertOwnedRunRoot(runRootGuard.path, runId, runRootGuard);
          await removeCanonicalDirectoryTree(runRootGuard);
        },
        cleanupErrors,
      );
    } else if (nextEnvLock && !nextEnvLockReleased) {
      console.error(
        `[e2e] Preserving owned run root because its lock marker is still required`,
      );
    } else {
      console.error(
        `[e2e] Preserving owned run root after artifact-copy failure`,
      );
    }

    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }

  for (const error of cleanupErrors) {
    console.error(`[e2e] Cleanup failed: ${error.message}`);
  }
  if (failure) throw failure;
  if (cleanupErrors.length > 0) return 1;
  if (receivedSignal === "SIGINT") return 130;
  if (receivedSignal === "SIGTERM") return 143;
  return exitCode;
}

async function runService(serviceName) {
  if (!Object.hasOwn(serviceNames, serviceName)) {
    throw new Error(
      `Unknown E2E service ${JSON.stringify(serviceName)}; expected orchestrator or web`,
    );
  }

  const runId = requireEnvironment("E2E_RUN_ID");
  const runRoot = path.resolve(requireEnvironment("E2E_RUN_ROOT"));
  const port = parsePort(requireEnvironment("PORT"), "PORT");
  const suiteLauncherPid = Number(requireEnvironment("E2E_LAUNCHER_PID"));
  if (!Number.isSafeInteger(suiteLauncherPid) || suiteLauncherPid <= 0) {
    throw new Error("E2E_LAUNCHER_PID must be a positive integer");
  }
  const suiteOwner = createNextEnvLockOwner(runId, {
    pid: suiteLauncherPid,
    token: requireEnvironment("E2E_LOCK_TOKEN"),
  });
  const runsRootGuard = await captureCanonicalDirectoryPath(runsRoot);
  const runRootGuard = await captureCanonicalDirectoryPath(runRoot);
  await assertOwnedRunRoot(runRoot, runId, runRootGuard);
  if (!(await nextEnvLauncherOwnerIsActive({ owner: suiteOwner, runsRoot }))) {
    throw new Error(
      "Refusing to start an E2E service after its suite launcher lost strong ownership",
    );
  }

  const logDirectory = path.join(runRoot, "logs");
  const serviceDirectory = path.join(runRoot, "services");
  await assertCanonicalDirectoryPath(runRootGuard);
  const logDirectoryGuard = await ensureCanonicalDirectoryPath(logDirectory);
  const serviceDirectoryGuard =
    await ensureCanonicalDirectoryPath(serviceDirectory);
  await assertCanonicalDirectoryDescendantPath(logDirectoryGuard, runRootGuard);
  await assertCanonicalDirectoryDescendantPath(
    serviceDirectoryGuard,
    runRootGuard,
  );
  await assertCanonicalDirectoryPath(runsRootGuard);
  await assertCanonicalDirectoryPath(runRootGuard);
  if (!(await nextEnvLauncherOwnerIsActive({ owner: suiteOwner, runsRoot }))) {
    throw new Error(
      "Refusing to create E2E service files after launcher ownership changed",
    );
  }

  const logPath = path.join(logDirectory, `${serviceName}.log`);
  await assertCanonicalDirectoryPath(logDirectoryGuard);
  await writeFile(logPath, "", { flag: "wx", mode: 0o600 });
  const logFileGuard = await captureCanonicalFilePath(logPath, {
    parentGuard: logDirectoryGuard,
  });
  await assertCanonicalFilePath(logFileGuard);
  const logStream = createWriteStream(logPath, { flags: "a" });
  const launch = serviceLaunch(serviceName, port);
  const explicitServiceEnvironment = {
    E2E_LAUNCHER_PID: String(suiteOwner.pid),
    E2E_LOCK_TOKEN: suiteOwner.token,
    E2E_RUN_ID: runId,
    E2E_RUN_ROOT: runRoot,
    PORT: String(port),
  };
  if (serviceName === "orchestrator") {
    const databasePath = path.join(runRoot, "database.sqlite");
    const attemptsRoot = path.join(runRoot, "exercise-attempts");
    Object.assign(explicitServiceEnvironment, {
      DATABASE_PATH: databasePath,
      DATABASE_URL: databasePath,
      E2E_ATTEMPTS_ROOT: attemptsRoot,
      E2E_DATABASE_PATH: databasePath,
      EXERCISE_ATTEMPTS_ROOT: attemptsRoot,
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      OPENCODE_ENDPOINT: defaultOpenCodeEndpoint,
      ORCHESTRATOR_BIND_MODE: "direct",
      WEB_ORIGIN: webOrigin,
    });
  } else {
    const nextDistDir = path
      .relative(webRoot, path.join(runRoot, "next"))
      .split(path.sep)
      .join("/");
    Object.assign(explicitServiceEnvironment, {
      NEXT_DIST_DIR: nextDistDir,
      NODE_ENV: "development",
      ORCHESTRATOR_URL: orchestratorOrigin,
      ORCHESTRATOR_BIND_MODE: "direct",
    });
  }
  const childEnvironment = createE2EEnvironment(
    process.env,
    explicitServiceEnvironment,
  );
  let child;
  let childExit;
  let receivedSignal;
  let stopOwnerWatchdog = async () => undefined;
  let ownedServiceRecord;
  const requestShutdown = (signal) => {
    receivedSignal ??= signal;
    if (childProcessIsRunning(child)) void terminateProcessTree(child.pid);
  };
  const onSigint = () => requestShutdown("SIGINT");
  const onSigterm = () => requestShutdown("SIGTERM");

  try {
    child = spawn(process.execPath, launch.args, {
      cwd: launch.cwd,
      detached: process.platform !== "win32",
      env: childEnvironment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    childExit = waitForChild(child);
    void childExit.catch(() => undefined);

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    });

    if (child.pid === undefined) {
      await childExit;
      throw new Error(`Failed to obtain the ${serviceName} service PID`);
    }

    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    stopOwnerWatchdog = startServiceOwnerWatchdog({
      childPid: child.pid,
      owner: suiteOwner,
      runRootGuard,
      serviceName,
    });
    ownedServiceRecord = await writeOwnedServiceRecord({
      record: {
        childPid: child.pid,
        launcherPid: process.pid,
        lockToken: suiteOwner.token,
        port,
        runId,
        serviceName,
        suiteLauncherPid: suiteOwner.pid,
      },
      runRootGuard,
      serviceDirectoryGuard,
      serviceName,
      token: suiteOwner.token,
    });

    const exitCode = await childExit;
    return receivedSignal ? 0 : exitCode;
  } finally {
    await stopOwnerWatchdog();
    if (
      child?.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      await terminateProcessTree(child.pid);
    }
    const childStopped =
      childExit === undefined ||
      (await Promise.race([
        childExit.then(
          () => true,
          () => true,
        ),
        delay(5_000).then(() => false),
      ]));
    if (ownedServiceRecord && childStopped) {
      await removeOwnedServiceRecord(ownedServiceRecord);
    }
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await closeLogStream(logStream);
  }
}

function startServiceOwnerWatchdog({
  childPid,
  owner,
  runRootGuard,
  serviceName,
}) {
  const failurePolicy = createOwnerWatchdogPolicy();
  let stopped = false;
  let currentCheck;
  let timer;
  const check = async () => {
    if (stopped || currentCheck) return;
    currentCheck = (async () => {
      let active = false;
      try {
        await assertCanonicalDirectoryPath(runRootGuard);
        active = await nextEnvLauncherOwnerIsActive({ owner, runsRoot });
      } catch {
        active = false;
      }
      if (!failurePolicy.observe(active) || stopped) return;
      stopped = true;
      clearInterval(timer);
      console.error(
        `[e2e:${serviceName}] Suite launcher ownership was lost; stopping the owned service tree`,
      );
      await terminateProcessTree(childPid);
    })().finally(() => {
      currentCheck = undefined;
    });
    await currentCheck;
  };
  timer = setInterval(() => void check(), 250);
  timer.unref();
  void check();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await currentCheck;
  };
}

async function writeOwnedServiceRecord({
  record,
  runRootGuard,
  serviceDirectoryGuard,
  serviceName,
  token,
}) {
  const destination = path.join(
    serviceDirectoryGuard.path,
    `${serviceName}-${token}.json`,
  );
  const temporary = path.join(
    runRootGuard.path,
    `.service-record-${serviceName}-${token}.tmp`,
  );
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  await assertCanonicalDirectoryPath(runRootGuard);
  await assertCanonicalDirectoryPath(serviceDirectoryGuard);
  await assertCanonicalDirectoryDescendantPath(
    serviceDirectoryGuard,
    runRootGuard,
  );
  await writeFile(temporary, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const temporaryGuard = await captureCanonicalFilePath(temporary, {
    parentGuard: runRootGuard,
  });
  let destinationGuard;
  try {
    await assertCanonicalFilePath(temporaryGuard);
    await assertCanonicalDirectoryPath(serviceDirectoryGuard);
    if (await lstatOrMissing(destination)) {
      throw new Error("Refusing to replace an E2E service record");
    }
    await link(temporary, destination);
    destinationGuard = await captureCanonicalFilePath(destination, {
      parentGuard: serviceDirectoryGuard,
    });
    if ((await readFile(destination, "utf8")) !== serialized) {
      throw new Error("The published E2E service record changed content");
    }
    await assertCanonicalFilePath(destinationGuard);
  } finally {
    await unlinkCanonicalFilePath(temporaryGuard).catch((error) => {
      if (!isErrorCode(error, "ENOENT")) throw error;
    });
  }
  return { destinationGuard, serialized };
}

async function removeOwnedServiceRecord({ destinationGuard, serialized }) {
  await assertCanonicalDirectoryPath(destinationGuard.parentGuard);
  if (!(await lstatOrMissing(destinationGuard.path))) return;
  await assertCanonicalFilePath(destinationGuard);
  const current = await readFile(destinationGuard.path, "utf8");
  await assertCanonicalFilePath(destinationGuard);
  if (current !== serialized) {
    throw new Error("Refusing to remove a replaced E2E service record");
  }
  await unlinkCanonicalFilePath(destinationGuard);
}

function serviceLaunch(serviceName, port) {
  const ownerWatchdog = pathToFileURL(
    path.join(root, "scripts", "e2e-service-owner-watchdog.mjs"),
  ).href;
  if (serviceName === "orchestrator") {
    return {
      args: [
        "--import",
        ownerWatchdog,
        "--import",
        "tsx",
        path.join(root, "apps", "orchestrator", "test", "e2e-server.ts"),
      ],
      cwd: root,
    };
  }
  return {
    args: [
      "--import",
      ownerWatchdog,
      path.join(root, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    cwd: webRoot,
  };
}

function expectedNextEnv(nextDistDir, original) {
  const originalText = original?.toString("utf8") ?? "";
  const firstLineFeed = originalText.indexOf("\n", 1);
  const eol =
    firstLineFeed === -1
      ? EOL
      : originalText[firstLineFeed - 1] === "\r"
        ? "\r\n"
        : "\n";
  const normalizedDistDir = nextDistDir.split(path.sep).join("/");
  return Buffer.from(
    [
      '/// <reference types="next" />',
      '/// <reference types="next/image-types/global" />',
      `import "./${normalizedDistDir}/dev/types/routes.d.ts";`,
      `import "./${normalizedDistDir}/dev/types/root-params.d.ts";`,
      "",
      "// NOTE: This file should not be edited",
      "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
      "",
    ].join(eol),
    "utf8",
  );
}

async function preserveFailureArtifacts(runRootGuard, runId, metadata) {
  await assertOwnedRunRoot(runRootGuard.path, runId, runRootGuard);
  const failureArtifactsRootGuard =
    await ensureCanonicalDirectoryPath(failureArtifactsRoot);
  const destination = path.join(failureArtifactsRoot, runId);
  const destinationGuard = await createExclusiveCanonicalDirectoryPath(
    destination,
    failureArtifactsRootGuard,
  );

  for (const directory of ["playwright-results", "logs"]) {
    const source = path.join(runRootGuard.path, directory);
    await assertCanonicalDirectoryPath(runRootGuard);
    if (!(await lstatOrMissing(source))) continue;
    const sourceGuard = await captureCanonicalDirectoryPath(source);
    await assertCanonicalDirectoryDescendantPath(sourceGuard, runRootGuard);
    await renameCanonicalDirectoryPath(
      sourceGuard,
      destinationGuard,
      directory,
    );
  }
  const failurePath = path.join(destination, "failure.json");
  await assertCanonicalDirectoryPath(destinationGuard);
  await writeFile(
    failurePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runId,
        cleanupErrorCount: metadata.cleanupErrorCount,
        exitCode: metadata.exitCode,
        launcherError: metadata.launcherError,
        receivedSignal: metadata.receivedSignal ?? null,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  const failureGuard = await captureCanonicalFilePath(failurePath, {
    parentGuard: destinationGuard,
  });
  await assertCanonicalFilePath(failureGuard);
  return destination;
}

async function cleanupRecordedServices(runRootGuard, owner) {
  for (const { entryName, record } of await readOwnedServiceRecords(
    runRootGuard,
  )) {
    assertOwnedServiceRecord(record, entryName, owner);
  }
}

async function waitForCurrentRunServicesReleased(runRootGuard, owner) {
  await waitForPortsReleased([orchestratorPort, webPort]);
  const records = await readOwnedServiceRecords(runRootGuard);
  for (const { entryName, record } of records) {
    assertOwnedServiceRecord(record, entryName, owner);
    if (
      isProcessTargetRunning(record.launcherPid) ||
      isProcessTargetRunning(record.childPid)
    ) {
      throw new Error("An owned E2E service process is still running");
    }
  }
  for (const { fileGuard } of records) {
    await unlinkCanonicalFilePath(fileGuard);
  }
  if ((await readOwnedServiceRecords(runRootGuard)).length > 0) {
    throw new Error("E2E service records changed during owned cleanup");
  }
}

async function waitForStaleOwnerServices(owner, signal) {
  const runRoot = path.join(runsRoot, owner.runId);
  const runRootGuard = await captureCanonicalDirectoryPath(runRoot);
  await assertOwnedRunRoot(runRoot, owner.runId, runRootGuard);
  for (const { entryName, record } of await readOwnedServiceRecords(
    runRootGuard,
  )) {
    assertOwnedServiceRecord(record, entryName, owner);
  }

  await delay(750);
  signal?.throwIfAborted();
  for (const { entryName, record } of await readOwnedServiceRecords(
    runRootGuard,
  )) {
    assertOwnedServiceRecord(record, entryName, owner);
    await assertE2EServiceProcessTargetsDead(record);
  }
  await waitForPortsReleased([orchestratorPort, webPort], signal);
}

async function readOwnedServiceRecords(runRootGuard) {
  await assertCanonicalDirectoryPath(runRootGuard);
  const serviceDirectory = path.join(runRootGuard.path, "services");
  if (!(await lstatOrMissing(serviceDirectory))) return [];
  const serviceDirectoryGuard =
    await captureCanonicalDirectoryPath(serviceDirectory);
  await assertCanonicalDirectoryDescendantPath(
    serviceDirectoryGuard,
    runRootGuard,
  );
  await assertCanonicalDirectoryPath(runRootGuard);
  const entries = await readdir(serviceDirectory, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new Error("Invalid E2E service record directory entry");
    }
    const fileGuard = await captureCanonicalFilePath(
      path.join(serviceDirectory, entry.name),
      { parentGuard: serviceDirectoryGuard },
    );
    const serialized = await readFile(fileGuard.path, "utf8");
    await assertCanonicalFilePath(fileGuard);
    records.push({
      entryName: entry.name,
      fileGuard,
      record: JSON.parse(serialized),
    });
  }
  await assertCanonicalDirectoryPath(serviceDirectoryGuard);
  return records;
}

function assertOwnedServiceRecord(record, entryName, owner) {
  if (
    !record ||
    typeof record !== "object" ||
    record.runId !== owner.runId ||
    record.suiteLauncherPid !== owner.pid ||
    record.lockToken !== owner.token ||
    !Object.hasOwn(serviceNames, record.serviceName) ||
    entryName !== `${record.serviceName}-${owner.token}.json` ||
    record.port !== servicePorts[record.serviceName] ||
    !Number.isSafeInteger(record.childPid) ||
    record.childPid <= 0 ||
    !Number.isSafeInteger(record.launcherPid) ||
    record.launcherPid <= 0
  ) {
    throw new Error(`Invalid owned E2E service record ${entryName}`);
  }
}

async function terminateProcessTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return;

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }

  const target = processTreeTarget(pid);
  if (!target) return;
  signalProcessTarget(pid, target, "SIGTERM");
  if (await waitForProcessTreeExit(pid, target, 3_000)) return;
  signalProcessTarget(pid, target, "SIGKILL");
  await waitForProcessTreeExit(pid, target, 2_000);
}

function processTreeTarget(pid) {
  if (isProcessTargetRunning(-pid)) return "group";
  if (isProcessTargetRunning(pid)) return "process";
  return undefined;
}

function signalProcessTarget(pid, target, signal) {
  try {
    process.kill(target === "group" ? -pid : pid, signal);
  } catch (error) {
    if (!isErrorCode(error, "ESRCH")) throw error;
  }
}

async function waitForProcessTreeExit(pid, target, timeout) {
  const processTarget = target === "group" ? -pid : pid;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!isProcessTargetRunning(processTarget)) return true;
    await delay(50);
  }
  return !isProcessTargetRunning(processTarget);
}

function isProcessTargetRunning(processTarget) {
  try {
    process.kill(processTarget, 0);
    return true;
  } catch (error) {
    if (isErrorCode(error, "ESRCH")) return false;
    if (isErrorCode(error, "EPERM")) return true;
    throw error;
  }
}

async function assertPortsAvailable(ports) {
  for (const [name, port] of ports) {
    if (await isPortOpen(port)) {
      throw new Error(
        `E2E ${name} port ${port} is already in use; refusing to terminate an unowned process`,
      );
    }
  }
}

async function waitForPortsReleased(ports, signal) {
  const deadline = Date.now() + 10_000;
  let closedSince;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const open = await Promise.all(ports.map((port) => isPortOpen(port)));
    if (open.every((value) => !value)) {
      closedSince ??= Date.now();
      if (Date.now() - closedSince >= 500) return;
    } else {
      closedSince = undefined;
    }
    await delay(100);
  }
  signal?.throwIfAborted();
  const leaked = [];
  for (const port of ports) {
    if (await isPortOpen(port)) leaked.push(port);
  }
  if (leaked.length > 0) {
    throw new Error(
      `E2E service ports still accept connections: ${leaked.join(", ")}`,
    );
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function childProcessIsRunning(child) {
  return (
    child?.pid !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      resolve(code ?? 1);
    });
  });
}

function closeLogStream(stream) {
  return new Promise((resolve) => stream.end(resolve));
}

async function collectCleanupError(label, action, errors) {
  try {
    await action();
  } catch (error) {
    errors.push(new Error(`${label}: ${asError(error).message}`));
  }
}

async function assertOwnedRunRoot(runRoot, runId, runRootGuard) {
  assertValidE2ERunId(runId);
  await assertCanonicalDirectoryPath(runRootGuard);
  const expected = path.resolve(runsRoot, runId);
  if (path.resolve(runRoot) !== expected || runRootGuard.path !== expected) {
    throw new Error(
      "E2E run root does not match its canonically admitted launcher-owned run ID",
    );
  }
}

function createRunId() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/gu, "");
  return `${timestamp}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the isolated E2E suite`);
  return value;
}

function parsePort(value, name) {
  const port = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}

async function lstatOrMissing(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
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
