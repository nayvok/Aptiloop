import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { arch, platform } from "node:os";
import path from "node:path";
import { stableLauncherEnvironment } from "./update-launcher-env.mjs";
import {
  extractArchiveSecure,
  parseGithubRelease,
  parseSha256Sums,
  parseTagVersion,
  parseVersionManifest,
  selectReleaseAsset,
  verifyDigestForAsset,
} from "../packages/update-core/dist/index.js";

const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const COMMAND_OUTPUT_BYTES = 64 * 1024;
const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PHASES = new Set([
  "backup",
  "candidate",
  "migration",
  "health",
  "pointer",
  "restart",
  "rollback",
]);
const STATES = new Set(["queued", "running", "succeeded", "failed"]);

function parseArguments(argv) {
  const values = new Map();
  const allowed = new Set([
    "operation",
    "tag",
    "data-dir",
    "runtime-root",
    "database-path",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--") || !allowed.has(argument.slice(2))) {
      throw new Error(
        `Unknown update-worker option: ${argument ?? "<missing>"}`,
      );
    }
    const key = argument.slice(2);
    if (values.has(key))
      throw new Error(`Duplicate update-worker option: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`--${key} requires a value`);
    values.set(key, value);
    index += 1;
  }
  for (const key of allowed)
    if (!values.has(key)) throw new Error(`--${key} is required`);
  const operation = values.get("operation");
  const tag = values.get("tag");
  if (!OPERATION_ID_PATTERN.test(operation))
    throw new Error("Update operationId must be a UUID.");
  const version = parseTagVersion(tag);
  const databasePath = values.get("database-path");
  return {
    operationId: operation,
    tag: `v${version}`,
    dataDir: path.resolve(values.get("data-dir")),
    runtimeRoot: path.resolve(values.get("runtime-root")),
    databasePath:
      databasePath.trim() === ":memory:"
        ? ":memory:"
        : path.resolve(databasePath),
  };
}

function assertSafePath(value, label) {
  if (
    value.includes("\0") ||
    [...value].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    throw new Error(`${label} contains unsafe control characters.`);
  }
  return path.resolve(value);
}

function parseOperation(raw, operationId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Persisted update operation is not an object.");
  const object = raw;
  const allowed = new Set([
    "operationId",
    "tag",
    "state",
    "phase",
    "startedAt",
    "finishedAt",
    "message",
    "evidencePath",
  ]);
  for (const key of Object.keys(object))
    if (!allowed.has(key))
      throw new Error(
        `Persisted update operation has an unknown field: ${key}.`,
      );
  if (
    object.operationId !== operationId ||
    !OPERATION_ID_PATTERN.test(object.operationId)
  )
    throw new Error("Persisted update operationId is invalid.");
  if (
    typeof object.tag !== "string" ||
    `v${parseTagVersion(object.tag)}` !== object.tag ||
    object.tag.length > 128
  )
    throw new Error("Persisted update operation tag is invalid.");
  if (typeof object.state !== "string" || !STATES.has(object.state))
    throw new Error("Persisted update operation state is invalid.");
  if (
    object.phase !== undefined &&
    (typeof object.phase !== "string" || !PHASES.has(object.phase))
  )
    throw new Error("Persisted update operation phase is invalid.");
  if (
    typeof object.startedAt !== "string" ||
    Number.isNaN(Date.parse(object.startedAt))
  )
    throw new Error("Persisted update operation startedAt is invalid.");
  if (
    object.finishedAt !== undefined &&
    (typeof object.finishedAt !== "string" ||
      Number.isNaN(Date.parse(object.finishedAt)))
  )
    throw new Error("Persisted update operation finishedAt is invalid.");
  if (
    object.message !== undefined &&
    (typeof object.message !== "string" || object.message.length > 2_000)
  )
    throw new Error("Persisted update operation message is invalid.");
  if (
    object.evidencePath !== undefined &&
    (typeof object.evidencePath !== "string" ||
      object.evidencePath.length > 1_000)
  )
    throw new Error("Persisted update operation evidencePath is invalid.");
  if (object.state === "queued" && object.phase !== undefined)
    throw new Error("Queued update operations cannot have a phase.");
  if (object.state === "queued" && object.finishedAt !== undefined)
    throw new Error("Queued update operations cannot have finishedAt.");
  if (object.state === "running" && object.phase === undefined)
    throw new Error("Running update operations require a phase.");
  if (object.state === "running" && object.finishedAt !== undefined)
    throw new Error("Running update operations cannot have finishedAt.");
  if (object.state === "succeeded" && object.phase !== "restart")
    throw new Error("Succeeded update operations must finish in restart.");
  if (object.state === "failed" && object.phase !== "rollback")
    throw new Error("Failed update operations must finish in rollback.");
  if (
    (object.state === "succeeded" || object.state === "failed") &&
    object.finishedAt === undefined
  )
    throw new Error("Terminal update operations require finishedAt.");
  return object;
}

async function readOperation(operationPath, operationId) {
  return parseOperation(
    JSON.parse(await fs.readFile(operationPath, "utf8")),
    operationId,
  );
}

async function writeJsonAtomically(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const replacement = `${target}.old-${process.pid}-${randomUUID()}`;
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  let committed = false;
  let replacementMoved = false;
  try {
    try {
      await fs.rename(temporary, target);
      committed = true;
    } catch (error) {
      if (!(
        error instanceof Error &&
        ["EEXIST", "EPERM", "EACCES"].includes(error.code)
      ))
        throw error;
      await fs.rename(target, replacement);
      replacementMoved = true;
      try {
        await fs.rename(temporary, target);
        committed = true;
      } catch (replacementError) {
        try {
          await fs.rename(replacement, target);
          replacementMoved = false;
        } catch (restoreError) {
          throw new AggregateError(
            [replacementError, restoreError],
            "Atomic JSON replacement and restoration failed.",
            { cause: restoreError },
          );
        }
        throw replacementError;
      }
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    if (committed && replacementMoved)
      await fs.rm(replacement, { force: true });
  }
}

function boundedMessage(value) {
  const message = value instanceof Error ? value.message : String(value);
  return message.length > 1_800 ? `${message.slice(0, 1_800)}…` : message;
}

async function updatePhase(context, phase, state, message, details = {}) {
  if (!PHASES.has(phase) || !STATES.has(state))
    throw new Error("Invalid update phase transition.");
  const operation = await readOperation(
    context.operationPath,
    context.operationId,
  );
  if (operation.tag !== context.tag)
    throw new Error(
      "Update operation tag changed while the worker was running.",
    );
  const persistedState =
    state === "succeeded" && phase !== "restart" ? "running" : state;
  const next = {
    ...operation,
    state: persistedState,
    phase,
    message: boundedMessage(message),
    evidencePath: context.evidenceDir,
    ...(persistedState === "succeeded" || persistedState === "failed"
      ? { finishedAt: new Date().toISOString() }
      : {}),
  };
  await writeJsonAtomically(context.operationPath, next);
  const evidence = {
    operationId: context.operationId,
    tag: context.tag,
    phase,
    state: persistedState,
    recordedAt: new Date().toISOString(),
    message: boundedMessage(message),
    details,
  };
  await writeJsonAtomically(
    path.join(context.evidenceDir, `${phase}.json`),
    evidence,
  );
}

async function readResponseText(response, maximum) {
  if (!response.body) throw new Error("GitHub response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximum)
      throw new Error(`GitHub response exceeds the ${maximum}-byte cap.`);
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchRelease(tag) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await globalThis.fetch(
      `https://api.github.com/repos/nayvok/Aptiloop/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "aptiloop-update-worker",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new Error(
        `GitHub Releases request failed with status ${response.status}.`,
      );
    return parseGithubRelease(
      JSON.parse(await readResponseText(response, MAX_METADATA_BYTES)),
      tag,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function downloadAsset(url, destination, expectedSize) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let complete = false;
  try {
    if (
      expectedSize !== undefined &&
      (!Number.isSafeInteger(expectedSize) ||
        expectedSize < 0 ||
        expectedSize > MAX_ASSET_BYTES)
    ) {
      throw new Error(
        `Release asset has an invalid declared size: ${expectedSize}.`,
      );
    }
    const response = await globalThis.fetch(url, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "aptiloop-update-worker",
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body)
      throw new Error(
        `Release asset download failed with status ${response.status}.`,
      );
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength =
      contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (
      contentLength !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength < 0)
    )
      throw new Error("Release asset returned an invalid Content-Length.");
    if (contentLength !== null && contentLength > MAX_ASSET_BYTES)
      throw new Error(`Release asset exceeds the ${MAX_ASSET_BYTES}-byte cap.`);
    if (
      expectedSize !== undefined &&
      contentLength !== null &&
      contentLength !== expectedSize
    )
      throw new Error(
        `Release asset size mismatch (declared ${expectedSize}, response ${contentLength}).`,
      );
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const handle = await fs.open(destination, "wx");
    try {
      const reader = response.body.getReader();
      let received = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
        if (received > MAX_ASSET_BYTES)
          throw new Error(
            `Release asset exceeds the ${MAX_ASSET_BYTES}-byte cap.`,
          );
        await handle.write(next.value);
      }
      if (expectedSize !== undefined && received !== expectedSize)
        throw new Error(
          `Release asset size mismatch (declared ${expectedSize}, received ${received}).`,
        );
      await handle.sync();
    } finally {
      await handle.close();
    }
    complete = true;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("Release asset download timed out.", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    if (!complete)
      await fs.rm(destination, { force: true }).catch(() => undefined);
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const read = await handle.read(buffer, 0, buffer.length);
      if (read.bytesRead === 0) break;
      hash.update(buffer.subarray(0, read.bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function listFiles(root, prefix = "") {
  const result = [];
  for (const entry of (
    await fs.readdir(path.join(root, prefix), { withFileTypes: true })
  ).sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error(`Refusing symlink in candidate runtime: ${relative}.`);
    if (entry.isDirectory()) result.push(...(await listFiles(root, relative)));
    else if (entry.isFile()) result.push(relative);
    else
      throw new Error(`Refusing special candidate runtime entry: ${relative}.`);
  }
  return result;
}

async function verifyReleaseDirectory(releaseRoot, expectedVersion) {
  try {
    const manifest = parseVersionManifest(
      JSON.parse(
        await fs.readFile(
          path.join(releaseRoot, "version-manifest.json"),
          "utf8",
        ),
      ),
    );
    if (manifest.version !== expectedVersion) return false;
    const files = await listFiles(releaseRoot);
    const declared = new Set(Object.keys(manifest.files));
    if (
      !files.includes("version-manifest.json") ||
      files.length !== declared.size + 1
    )
      return false;
    for (const relative of files) {
      if (relative !== "version-manifest.json" && !declared.has(relative))
        return false;
    }
    for (const [relative, expected] of Object.entries(manifest.files)) {
      if ((await sha256File(path.join(releaseRoot, relative))) !== expected)
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Windows antivirus and indexing can transiently lock freshly written or
// recently released SQLite files, surfacing as disk I/O or lock errors.
// Identity reads are pure, so they can be retried safely.
function isTransientSqliteError(error) {
  return (
    error instanceof Error &&
    /disk I\/O error|database is locked|database table is locked|unable to open database file/iu.test(
      error.message,
    )
  );
}

const SQLITE_RETRY_ATTEMPTS = 10;
const SQLITE_RETRY_DELAY_MS = 500;

async function withTransientSqliteRetry(operation) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= SQLITE_RETRY_ATTEMPTS || !isTransientSqliteError(error))
        throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, SQLITE_RETRY_DELAY_MS),
      );
    }
  }
}

async function readDatabaseIdentity(databasePath) {
  return withTransientSqliteRetry(async () => {
    const sqlite = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const integrityRow = sqlite.prepare("PRAGMA integrity_check").get();
      const integrity =
        integrityRow && typeof integrityRow.integrity_check === "string"
          ? integrityRow.integrity_check
          : "";
      if (integrity !== "ok")
        throw new Error(
          `SQLite integrity_check failed for ${databasePath}: ${integrity || "no result"}.`,
        );
      const foreignKeys = sqlite.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeys.length !== 0)
        throw new Error(
          `SQLite foreign_key_check found ${foreignKeys.length} violation(s) for ${databasePath}.`,
        );
      const migrationTable = sqlite
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '__dlh_migrations' LIMIT 1",
        )
        .get();
      const ledger = migrationTable
        ? sqlite
            .prepare("SELECT id FROM __dlh_migrations ORDER BY id")
            .all()
            .map((row) => row.id)
        : [];
      const inventory = sqlite
        .prepare(
          "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name, tbl_name, sql",
        )
        .all();
      const schemaSha256 = createHash("sha256")
        .update(JSON.stringify(inventory))
        .digest("hex");
      return { integrity, foreignKeyViolations: 0, ledger, schemaSha256 };
    } finally {
      sqlite.close();
    }
  });
}

// Windows process-tree termination is asynchronous: the runtime CLI can exit
// before its service children release the SQLite database. Wait until the
// database is actually readable again before taking the quiescent snapshot.
async function waitForDatabaseQuiescent(databasePath) {
  const deadline = Date.now() + 20_000;
  let lastError;
  for (;;) {
    try {
      const sqlite = new DatabaseSync(databasePath, { readOnly: true });
      try {
        sqlite.prepare("SELECT count(*) AS tables FROM sqlite_schema").get();
      } finally {
        sqlite.close();
      }
      return;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Active database remained unavailable after the runtime stopped: ${boundedMessage(lastError)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function snapshotDatabase(source, destination) {
  if (
    await fs.stat(destination).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`Refusing to overwrite database backup ${destination}.`);
  const sourceBefore = await readDatabaseIdentity(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const sqlite = new DatabaseSync(source, { readOnly: true });
  try {
    const escaped = destination.replaceAll("'", "''");
    sqlite.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    sqlite.close();
  }
  const stat = await fs.stat(destination);
  if (stat.size === 0) throw new Error("SQLite backup is empty.");
  const destinationIdentity = await readDatabaseIdentity(destination);
  const sourceAfter = await readDatabaseIdentity(source);
  if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter))
    throw new Error(
      "Active database changed while the verified snapshot was being created.",
    );
  if (
    sourceBefore.schemaSha256 !== destinationIdentity.schemaSha256 ||
    JSON.stringify(sourceBefore.ledger) !==
      JSON.stringify(destinationIdentity.ledger)
  ) {
    throw new Error(
      "Database snapshot ledger or schema identity does not match the source.",
    );
  }
  return { sourceIdentity: sourceBefore, destinationIdentity };
}

async function replaceFileAtomically(source, target) {
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const replacement = `${target}.old-${process.pid}-${randomUUID()}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, temporary, 0);
  const handle = await fs.open(temporary, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  let committed = false;
  let replacementMoved = false;
  try {
    try {
      await fs.rename(temporary, target);
      committed = true;
    } catch (error) {
      if (!(
        error instanceof Error &&
        ["EEXIST", "EPERM", "EACCES"].includes(error.code)
      ))
        throw error;
      await fs.rename(target, replacement);
      replacementMoved = true;
      try {
        await fs.rename(temporary, target);
        committed = true;
      } catch (replacementError) {
        try {
          await fs.rename(replacement, target);
          replacementMoved = false;
        } catch (restoreError) {
          throw new AggregateError(
            [replacementError, restoreError],
            "Atomic file replacement and restoration failed.",
            { cause: restoreError },
          );
        }
        throw replacementError;
      }
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    if (committed && replacementMoved)
      await fs.rm(replacement, { force: true });
  }
  const sidecars = [`${target}-wal`, `${target}-shm`];
  for (const sidecar of sidecars) {
    try {
      await fs.rm(sidecar, { force: true });
    } catch (error) {
      if (!(error instanceof Error && error.code === "ENOENT")) throw error;
    }
  }
}

function commandOutputChunk(output, chunk) {
  if (output.length >= COMMAND_OUTPUT_BYTES) return output;
  return `${output}${chunk.toString("utf8")}`.slice(0, COMMAND_OUTPUT_BYTES);
}

function runCommand(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45_000;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid !== undefined) {
        spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
        });
      } else if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      reject(
        new Error(
          `Command timed out after ${timeoutMs}ms: ${path.basename(executable)}`,
        ),
      );
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout = commandOutputChunk(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = commandOutputChunk(stderr, chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error(
            `${path.basename(executable)} exited with ${signal ?? `code ${code ?? 1}`}. ${stderr || stdout}`,
          ),
        );
      else resolve({ stdout, stderr });
    });
  });
}

async function startDetached(executable, args, env) {
  const child = spawn(executable, args, {
    env,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  });
  child.unref();
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return child;
}

async function findFreePort(excludedPorts = new Set()) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: 0 }, resolve);
      });
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      if (port && !excludedPorts.has(port)) return port;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  throw new Error("Could not reserve a distinct temporary loopback port.");
}

async function waitForHttp(url, expectedStatus = 200, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await globalThis.fetch(url, {
        signal: controller.signal,
      });
      if (response.status === expectedStatus) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = boundedMessage(error);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Health check timed out for ${url} (${lastError}).`);
}

async function readPointer(runtimeRoot) {
  try {
    const pointer = JSON.parse(
      await fs.readFile(path.join(runtimeRoot, "current.json"), "utf8"),
    );
    if (
      !pointer ||
      typeof pointer.version !== "string" ||
      typeof pointer.releaseDir !== "string" ||
      !/^releases\/[^/]+$/u.test(pointer.releaseDir)
    )
      return null;
    return pointer;
  } catch {
    return null;
  }
}

async function runtimeWasRunning(dataDir) {
  try {
    const record = JSON.parse(
      await fs.readFile(
        path.join(dataDir, "runtime-state", "aptiloop.pid"),
        "utf8",
      ),
    );
    if (!record || !Number.isSafeInteger(record.pid) || record.pid < 1)
      return false;
    try {
      process.kill(record.pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

async function copyEvidence(source, destination) {
  await fs.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}

async function acquireUpdateLock(dataDir, operationId) {
  const lockPath = path.join(dataDir, "updates", "apply.lock");
  const token = randomUUID();
  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx");
      const owner = { pid: process.pid, operationId, token };
      try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
        await handle.sync();
      } catch (writeError) {
        await handle.close().catch(() => undefined);
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
        throw writeError;
      }
      return async () => {
        await handle.close();
        try {
          const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
          if (
            current &&
            current.pid === process.pid &&
            current.operationId === operationId &&
            current.token === token
          )
            await fs.rm(lockPath);
        } catch (error) {
          if (!(error instanceof Error && error.code === "ENOENT")) throw error;
        }
      };
    } catch (error) {
      if (!(error instanceof Error && error.code === "EEXIST")) throw error;
      const stat = await fs.stat(lockPath).catch((statError) => {
        if (statError instanceof Error && statError.code === "ENOENT")
          return null;
        throw statError;
      });
      if (!stat) continue;
      let owner = null;
      try {
        owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
      } catch {
        // A young or malformed lock is never removed: it may be mid-write.
      }
      const ownerPid =
        owner &&
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0 &&
        typeof owner.operationId === "string"
          ? owner.pid
          : null;
      let ownerAlive = false;
      if (ownerPid !== null) {
        try {
          process.kill(ownerPid, 0);
          ownerAlive = true;
        } catch (probeError) {
          ownerAlive =
            probeError instanceof Error && probeError.code === "EPERM";
        }
      }
      if (ownerAlive) {
        if (owner.operationId === operationId) return null;
        throw new Error("Another update operation is already running.", {
          cause: error,
        });
      }
      if (ownerPid === null) {
        throw new Error(
          "An update lock is present but cannot be safely reclaimed.",
          { cause: error },
        );
      }
      await fs.rm(lockPath);
    }
  }
}

const input = parseArguments(process.argv.slice(2));
if (input.databasePath === ":memory:")
  throw new Error("Update worker requires a file-backed database.");
const operationDir = path.join(input.dataDir, "updates", "operations");
const evidenceDir = path.join(
  input.dataDir,
  "updates",
  "evidence",
  input.operationId,
);
const operationPath = path.join(operationDir, `${input.operationId}.json`);
const activeDatabase = input.databasePath;
let releaseUpdateLock;
let persistedOperation;
try {
  persistedOperation = await readOperation(operationPath, input.operationId);
  if (
    persistedOperation.state === "succeeded" ||
    persistedOperation.state === "failed"
  )
    process.exit(0);
  const release = await acquireUpdateLock(input.dataDir, input.operationId);
  if (release === null) process.exit(0);
  releaseUpdateLock = release;
} catch (error) {
  if (
    persistedOperation &&
    (persistedOperation.state === "queued" ||
      persistedOperation.state === "running")
  ) {
    try {
      await writeJsonAtomically(operationPath, {
        ...persistedOperation,
        state: "failed",
        phase: "rollback",
        finishedAt: new Date().toISOString(),
        message: `Update could not start: ${boundedMessage(error)}`,
      });
    } catch (markError) {
      throw new AggregateError(
        [error, markError],
        "Update could not start and terminal failure could not be persisted.",
        { cause: markError },
      );
    }
  }
  process.exitCode = 1;
  throw error;
}
const previousPointer = await readPointer(input.runtimeRoot);
const context = { ...input, operationPath, evidenceDir };
let backupPath = null;
let backupSha256 = null;
let candidateRoot = null;
let candidateDataDir = null;
let candidateDb = null;
let candidateProcess = null;
let migratedSnapshot;
let activeDatabaseExisted = false;
let oldRunning = false;
let oldStopped = false;
let activeDatabaseMutated = false;
let pointerMutated = false;
let newReleasePath = null;
let newReleaseCreated = false;

async function stopRuntime(dataDir, runtimeRoot, trustedReleasePath = null) {
  const launcher = trustedReleasePath
    ? path.join(trustedReleasePath, "runtime-cli.cjs")
    : path.join(runtimeRoot, "launcher.cjs");
  const environment = trustedReleasePath
    ? {
        ...stableLauncherEnvironment(process.env, runtimeRoot, launcher),
        APTILOOP_RELEASE_ROOT: trustedReleasePath,
        APTILOOP_CLI_ENTRY: launcher,
      }
    : stableLauncherEnvironment(process.env, runtimeRoot, launcher);
  try {
    await runCommand(
      process.execPath,
      [launcher, "stop", "--data-dir", dataDir],
      { env: environment, timeoutMs: 40_000 },
    );
  } catch (error) {
    if (!/not running|no pidfile|stale pidfile/iu.test(String(error)))
      throw error;
  }
}

async function stopOwnedRuntimeProcess(dataDir) {
  let record;
  try {
    record = JSON.parse(
      await fs.readFile(
        path.join(dataDir, "runtime-state", "aptiloop.pid"),
        "utf8",
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return;
    throw error;
  }
  if (!record || !Number.isSafeInteger(record.pid) || record.pid < 1) return;
  if (process.platform === "win32") {
    await runCommand("taskkill.exe", ["/pid", String(record.pid), "/t", "/f"], {
      timeoutMs: 40_000,
    });
    return;
  }
  try {
    process.kill(-record.pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error && error.code === "ESRCH")) throw error;
  }
}

async function stopRuntimeForRollback(dataDir, runtimeRoot, releasePath) {
  if (
    releasePath &&
    (await verifyReleaseDirectory(releasePath, previousPointer.version))
  )
    return stopRuntime(dataDir, runtimeRoot, releasePath);
  return stopOwnedRuntimeProcess(dataDir);
}

async function startRuntime(dataDir, runtimeRoot) {
  const launcher = path.join(runtimeRoot, "launcher.cjs");
  return startDetached(
    process.execPath,
    [launcher, "start", "--service-run", "--data-dir", dataDir],
    stableLauncherEnvironment(process.env, runtimeRoot, launcher),
  );
}

const previousReleasePath = previousPointer
  ? path.resolve(input.runtimeRoot, previousPointer.releaseDir)
  : null;
try {
  assertSafePath(input.dataDir, "data directory");
  assertSafePath(input.runtimeRoot, "runtime root");
  oldRunning = await runtimeWasRunning(input.dataDir);
  await updatePhase(
    context,
    "candidate",
    "running",
    `Downloading and verifying ${input.tag} for ${platform()}/${arch()} while the active runtime remains untouched.`,
  );
  const release = await fetchRelease(input.tag);
  const bundle = selectReleaseAsset(release, platform(), arch());
  const sumsAsset = release.assets.find((asset) => asset.name === "SHA256SUMS");
  if (!sumsAsset)
    throw new Error(
      `Release ${input.tag} lacks SHA256SUMS; nothing was changed.`,
    );
  if (!bundle.digest || !/^sha256:[a-f0-9]{64}$/u.test(bundle.digest))
    throw new Error(
      `Release ${input.tag} lacks an exact GitHub SHA-256 digest for ${bundle.name}; nothing was changed.`,
    );
  const staging = path.join(input.runtimeRoot, ".staging", input.operationId);
  await fs.mkdir(path.join(input.runtimeRoot, ".staging"), { recursive: true });
  await fs.mkdir(staging, { recursive: false });
  const sumsPath = path.join(staging, "SHA256SUMS");
  const bundlePath = path.join(staging, bundle.name);
  await downloadAsset(sumsAsset.downloadUrl, sumsPath, sumsAsset.size);
  await downloadAsset(bundle.downloadUrl, bundlePath, bundle.size);
  const sums = parseSha256Sums(await fs.readFile(sumsPath, "utf8"));
  const bundleSha256 = await sha256File(bundlePath);
  verifyDigestForAsset(sums, bundle.name, bundleSha256);
  verifyDigestForAsset(
    new Map([[bundle.name, bundle.digest.slice("sha256:".length)]]),
    bundle.name,
    bundleSha256,
  );
  if (sumsAsset.digest && /^sha256:[a-f0-9]{64}$/u.test(sumsAsset.digest))
    verifyDigestForAsset(
      new Map([[sumsAsset.name, sumsAsset.digest.slice("sha256:".length)]]),
      sumsAsset.name,
      await sha256File(sumsPath),
    );
  candidateRoot = path.join(staging, "release");
  await extractArchiveSecure(bundlePath, candidateRoot);
  const manifest = parseVersionManifest(
    JSON.parse(
      await fs.readFile(
        path.join(candidateRoot, "version-manifest.json"),
        "utf8",
      ),
    ),
  );
  if (
    manifest.version !== parseTagVersion(input.tag) ||
    !(await verifyReleaseDirectory(candidateRoot, manifest.version))
  )
    throw new Error(
      "Extracted candidate failed complete version-manifest validation.",
    );
  oldRunning = await runtimeWasRunning(input.dataDir);
  await updatePhase(
    context,
    "backup",
    "running",
    oldRunning
      ? "Quiescing the active runtime before the final database snapshot."
      : "Confirming the active runtime is stopped before the final database snapshot.",
  );
  if (oldRunning) {
    await stopRuntime(input.dataDir, input.runtimeRoot);
    if (await runtimeWasRunning(input.dataDir))
      throw new Error(
        "The active runtime did not stop cleanly; refusing to snapshot or restore its database.",
      );
    await waitForDatabaseQuiescent(activeDatabase);
    oldStopped = true;
  }
  activeDatabaseExisted = await fs.stat(activeDatabase).then(
    () => true,
    () => false,
  );
  if (activeDatabaseExisted) {
    const approvedBackupPath = path.join(
      input.dataDir,
      "approved-backups",
      `update-${input.operationId}.sqlite`,
    );
    backupPath = approvedBackupPath;
    const identity = await snapshotDatabase(activeDatabase, approvedBackupPath);
    backupSha256 = await sha256File(approvedBackupPath);
    await updatePhase(
      context,
      "backup",
      "succeeded",
      "Approved backup verified after runtime quiescence.",
      {
        backupPath: approvedBackupPath,
        backupSha256,
        sourceIdentity: identity.sourceIdentity,
        backupIdentity: identity.destinationIdentity,
      },
    );
  } else {
    await updatePhase(
      context,
      "backup",
      "succeeded",
      "No active database exists; candidate will initialize a new database.",
      { databasePath: activeDatabase },
    );
  }
  candidateDataDir = path.join(candidateRoot, ".data");
  candidateDb = path.join(candidateDataDir, path.basename(activeDatabase));
  if (backupPath) {
    await fs.mkdir(path.join(candidateDataDir, "approved-backups"), {
      recursive: true,
    });
    const candidateBackup = path.join(
      candidateDataDir,
      "approved-backups",
      path.basename(backupPath),
    );
    await fs.copyFile(backupPath, candidateBackup, 0);
    await fs.copyFile(backupPath, candidateDb, 0);
  }
  await updatePhase(
    context,
    "migration",
    "running",
    "Migrating the candidate database copy with the approved backup authorization.",
    { candidateRoot, candidateDatabase: candidateDb },
  );
  if (backupPath) {
    await runCommand(
      process.execPath,
      [
        path.join(candidateRoot, "apps", "orchestrator", "dist", "server.js"),
        "--authorize-current",
        "--approved-backup",
        path.join(
          candidateDataDir,
          "approved-backups",
          path.basename(backupPath),
        ),
        "--backup-sha256",
        backupSha256,
      ],
      {
        cwd: candidateRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          APTILOOP_RELEASE_ROOT: candidateRoot,
          APTILOOP_DATA_DIR: candidateDataDir,
          DATABASE_PATH: candidateDb,
          DATABASE_URL: candidateDb,
          APTILOOP_MIGRATE_ONLY: "1",
        },
        timeoutMs: 120_000,
      },
    );
  }
  await updatePhase(
    context,
    "health",
    "running",
    "Starting the extracted candidate on temporary loopback ports.",
  );
  const temporaryWebPort = await findFreePort();
  const temporaryOrchestratorPort = await findFreePort(
    new Set([temporaryWebPort]),
  );
  const candidateCli = path.join(candidateRoot, "runtime-cli.cjs");
  const candidateEnv = {
    APTILOOP_DATA_DIR: candidateDataDir,
    APTILOOP_RUNTIME_ROOT: input.runtimeRoot,
    APTILOOP_RELEASE_ROOT: candidateRoot,
    APTILOOP_RUNTIME_LAUNCHER: path.join(input.runtimeRoot, "launcher.cjs"),
    APTILOOP_BOOTSTRAP_ENTRY: path.join(input.runtimeRoot, "launcher.cjs"),
  };
  candidateProcess = await startDetached(
    process.execPath,
    [
      candidateCli,
      "start",
      "--service-run",
      "--data-dir",
      candidateDataDir,
      "--port",
      String(temporaryWebPort),
      "--orch-port",
      String(temporaryOrchestratorPort),
    ],
    candidateEnv,
  );
  await waitForHttp(
    `http://127.0.0.1:${temporaryOrchestratorPort}/health/ready`,
  );
  await waitForHttp(`http://127.0.0.1:${temporaryWebPort}/`);
  await stopRuntime(candidateDataDir, input.runtimeRoot);
  if (candidateProcess?.pid !== undefined) {
    const supervisorPid = candidateProcess.pid;
    if (process.platform === "win32") {
      await runCommand(
        "taskkill.exe",
        ["/pid", String(supervisorPid), "/t", "/f"],
        { timeoutMs: 10_000 },
      ).catch(() => undefined);
    } else {
      try {
        process.kill(-supervisorPid, "SIGTERM");
      } catch {
        candidateProcess.kill("SIGTERM");
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      try {
        process.kill(-supervisorPid, "SIGKILL");
      } catch {
        candidateProcess.kill("SIGKILL");
      }
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        process.kill(supervisorPid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    try {
      process.kill(supervisorPid, 0);
      throw new Error(
        "Candidate runtime supervisor remained running after stop.",
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("remained running"))
        throw error;
    }
  }
  if (await runtimeWasRunning(candidateDataDir))
    throw new Error("Candidate runtime remained running after stop.");
  candidateProcess = null;
  migratedSnapshot = path.join(staging, "migrated.sqlite");
  const migratedIdentity = await snapshotDatabase(
    candidateDb,
    migratedSnapshot,
  );
  await updatePhase(
    context,
    "migration",
    "succeeded",
    "Candidate database migration and integrity verification completed.",
    {
      candidateDatabase: candidateDb,
      migratedSnapshot,
      sourceIdentity: migratedIdentity.sourceIdentity,
      migratedIdentity: migratedIdentity.destinationIdentity,
      migratedSha256: await sha256File(migratedSnapshot),
    },
  );
  await updatePhase(
    context,
    "pointer",
    "running",
    "Switching the verified runtime pointer and database atomically.",
    { temporaryWebPort, temporaryOrchestratorPort },
  );
  const releasePath = path.join(
    input.runtimeRoot,
    "releases",
    manifest.version,
  );
  const releaseExists = await fs.stat(releasePath).then(
    () => true,
    () => false,
  );
  if (releaseExists) {
    if (!(await verifyReleaseDirectory(releasePath, manifest.version)))
      throw new Error(
        `Immutable runtime release ${releasePath} exists but failed validation; refusing overwrite.`,
      );
    newReleasePath = releasePath;
  } else {
    await fs.mkdir(path.dirname(releasePath), { recursive: true });
    await fs.rm(path.join(candidateRoot, ".data"), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    });
    await fs.rename(candidateRoot, releasePath);
    newReleasePath = releasePath;
    newReleaseCreated = true;
  }
  activeDatabaseMutated = true;
  await replaceFileAtomically(migratedSnapshot, activeDatabase);
  pointerMutated = true;
  await writeJsonAtomically(path.join(input.runtimeRoot, "current.json"), {
    version: manifest.version,
    releaseDir: `releases/${manifest.version}`,
  });
  await updatePhase(
    context,
    "restart",
    "running",
    oldRunning
      ? "Restarting the stable launcher and checking post-switch health."
      : "Runtime pointer switched; service was not running and was left stopped.",
  );
  if (oldRunning) {
    await startRuntime(input.dataDir, input.runtimeRoot);
    const persisted = JSON.parse(
      await fs.readFile(path.join(input.dataDir, "config.json"), "utf8"),
    );
    const webPort = Number(persisted.webPort);
    const orchestratorPort = Number(persisted.orchestratorPort);
    await waitForHttp(`http://127.0.0.1:${orchestratorPort}/health/ready`);
    await waitForHttp(`http://127.0.0.1:${webPort}/`);
  }
  await updatePhase(
    context,
    "restart",
    "succeeded",
    oldRunning
      ? "Verified runtime switch and post-switch health."
      : "Runtime pointer switched; service was not running and was left stopped.",
    { releasePath: newReleasePath, oldRunning },
  );
  await fs.rm(path.join(input.runtimeRoot, ".staging", input.operationId), {
    recursive: true,
    force: true,
  });
} catch (error) {
  const failure = boundedMessage(error);
  let candidateStopError = null;
  if (candidateProcess) {
    try {
      await stopRuntime(candidateDataDir, input.runtimeRoot);
      candidateProcess = null;
    } catch (stopError) {
      candidateStopError = stopError;
    }
  }
  let evidenceError = null;
  try {
    await fs.mkdir(evidenceDir, { recursive: true });
    if (candidateDb && !candidateStopError)
      await copyEvidence(
        candidateDb,
        path.join(evidenceDir, "failed-database.sqlite"),
      );
    if (candidateRoot)
      await copyEvidence(
        candidateRoot,
        path.join(evidenceDir, "failed-runtime"),
      );
    if (newReleasePath)
      await copyEvidence(
        newReleasePath,
        path.join(evidenceDir, "failed-runtime-installed"),
      );
  } catch (captureError) {
    evidenceError = captureError;
  }
  try {
    let rollbackStopError = candidateStopError;
    if (activeDatabaseMutated || pointerMutated) {
      try {
        await stopRuntimeForRollback(
          input.dataDir,
          input.runtimeRoot,
          previousReleasePath,
        );
      } catch (stopError) {
        rollbackStopError = rollbackStopError
          ? new AggregateError(
              [rollbackStopError, stopError],
              "Runtime stop failed during rollback.",
            )
          : stopError;
      }
    }
    if (activeDatabaseMutated) {
      if (
        backupPath &&
        (await fs.stat(backupPath).then(
          () => true,
          () => false,
        ))
      )
        await replaceFileAtomically(backupPath, activeDatabase);
      else if (!activeDatabaseExisted) {
        await fs.rm(activeDatabase, { force: true });
        await fs.rm(`${activeDatabase}-wal`, { force: true });
        await fs.rm(`${activeDatabase}-shm`, { force: true });
      }
    }
    if (pointerMutated) {
      if (previousPointer)
        await writeJsonAtomically(
          path.join(input.runtimeRoot, "current.json"),
          previousPointer,
        );
      else
        await fs.rm(path.join(input.runtimeRoot, "current.json"), {
          force: true,
        });
    }
    if (newReleaseCreated && newReleasePath)
      await fs.rm(newReleasePath, { recursive: true, force: true });
    if (oldRunning && oldStopped) {
      await startRuntime(input.dataDir, input.runtimeRoot);
      const config = JSON.parse(
        await fs.readFile(path.join(input.dataDir, "config.json"), "utf8"),
      );
      await waitForHttp(
        `http://127.0.0.1:${Number(config.orchestratorPort)}/health/ready`,
        200,
        30_000,
      );
    }
    if (rollbackStopError) throw rollbackStopError;
  } catch (rollbackError) {
    const rollbackFailure = boundedMessage(rollbackError);
    const causes = [error];
    if (evidenceError) causes.push(evidenceError);
    causes.push(rollbackError);
    try {
      await updatePhase(
        context,
        "rollback",
        "failed",
        `Update failed: ${failure}; rollback also failed: ${rollbackFailure}${
          evidenceError
            ? `; evidence capture failed: ${boundedMessage(evidenceError)}`
            : ""
        }`,
      );
    } catch (persistError) {
      causes.push(persistError);
    }
    process.exitCode = 1;
    throw new AggregateError(causes, "Update and rollback failed.", {
      cause: rollbackError,
    });
  }
  const evidenceSuffix = evidenceError
    ? `; evidence capture failed: ${boundedMessage(evidenceError)}`
    : "";
  await updatePhase(
    context,
    "rollback",
    "failed",
    activeDatabaseMutated || pointerMutated
      ? `Update failed and previous runtime/database were restored: ${failure}${evidenceSuffix}`
      : oldStopped
        ? `Update failed after quiescing the active runtime; no runtime/database cutover occurred and the previous runtime was restarted: ${failure}${evidenceSuffix}`
        : `Update failed before runtime/database cutover; the active runtime and database were left untouched: ${failure}${evidenceSuffix}`,
    {
      backupPath,
      backupSha256,
      previousPointer,
      previousReleasePath,
      newReleaseCreated,
      activeDatabaseMutated,
      pointerMutated,
    },
  ).catch((persistError) => {
    const causes = [error];
    if (evidenceError) causes.push(evidenceError);
    causes.push(persistError);
    throw new AggregateError(
      causes,
      "Update failed and terminal state could not be persisted.",
      {
        cause: error,
      },
    );
  });
  process.exitCode = 1;
} finally {
  if (releaseUpdateLock) await releaseUpdateLock();
}
