import { randomUUID } from "node:crypto";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import path from "node:path";

import {
  BOOTSTRAP_PROTOCOL,
  checkBootstrapCompatibility,
  compareVersions,
  extractArchiveSecure,
  parseVersionManifest,
  validateArchiveEntryPath,
  assetNameForPlatform,
  selectReleaseAsset,
  type VersionManifest,
} from "@aptiloop/update-core";
import { defaultRuntimeRoot, findSourceCheckoutRoot } from "./config.js";
import { downloadAsset, fetchReleaseByTag, sha256File } from "./update.js";
import {
  parseSha256Sums,
  verifyDigestForAsset,
  type ReleaseInfo,
} from "@aptiloop/update-core";

export interface InstalledPointer {
  readonly version: string;
  readonly releaseDir: string;
}

export const LAUNCHER_TEMPLATE = `#!/usr/bin/env node
"use strict";
const NODE_EXECUTABLE = __APTILOOP_NODE_JSON__;
const { existsSync, readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const runtimeRoot = __dirname;
let pointer;
try { pointer = JSON.parse(readFileSync(path.join(runtimeRoot, "current.json"), "utf8")); }
catch { console.error("aptiloop: no installed runtime (current.json is missing or invalid). Reinstall the runtime release."); process.exit(1); }
if (!pointer || typeof pointer.releaseDir !== "string" || !/^releases[/][^/]+$/u.test(pointer.releaseDir) || pointer.releaseDir.includes("..") || path.isAbsolute(pointer.releaseDir)) { console.error("aptiloop: installed runtime pointer is invalid. Reinstall the runtime release."); process.exit(1); }
const releaseRoot = path.resolve(runtimeRoot, pointer.releaseDir);
const cliEntry = path.join(releaseRoot, "runtime-cli.cjs");
if (!existsSync(cliEntry)) { console.error(\`aptiloop: installed runtime entry is missing: \${cliEntry}. Reinstall the runtime release.\`); process.exit(1); }
const child = spawnSync(NODE_EXECUTABLE, [cliEntry, ...process.argv.slice(2)], { stdio: "inherit", shell: false, windowsHide: true, env: { ...process.env, APTILOOP_RUNTIME_ROOT: runtimeRoot, APTILOOP_RELEASE_ROOT: releaseRoot, APTILOOP_CLI_ENTRY: cliEntry, APTILOOP_BOOTSTRAP_ENTRY: __filename, APTILOOP_RUNTIME_LAUNCHER: __filename } });
if (child.error) { console.error(\`aptiloop: \${child.error.message}\`); process.exit(1); }
process.exit(child.status ?? 1);
`;

function packageRoot(): string {
  // CJS bundles have __dirname; source ESM is always launched from its checkout.
  return typeof __dirname === "string"
    ? path.resolve(__dirname, "..")
    : process.cwd();
}

export function readOwnVersion(packageRootDir: string = packageRoot()): string {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(packageRootDir, "package.json"), "utf8"),
    ) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim() !== "")
      return parsed.version.trim();
  } catch {
    /* package metadata is unavailable in development source mode */
  }
  return "0.0.0-dev";
}

export function resolveRuntimeRootFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.APTILOOP_RUNTIME_ROOT?.trim();
  return explicit
    ? path.resolve(explicit)
    : defaultRuntimeRoot(platform(), env);
}

export async function readInstalledPointer(
  runtimeRoot: string,
): Promise<InstalledPointer | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(runtimeRoot, "current.json"), "utf8"),
    ) as { version?: unknown; releaseDir?: unknown };
    if (
      typeof parsed.version !== "string" ||
      typeof parsed.releaseDir !== "string"
    )
      return null;
    const releaseDir = validateArchiveEntryPath(parsed.releaseDir);
    if (!releaseDir.startsWith("releases/")) return null;
    return { version: parsed.version, releaseDir };
  } catch {
    return null;
  }
}

async function writeFileSynced(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const replacement = `${target}.old-${process.pid}-${randomUUID()}`;
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : "";
      if (!["EEXIST", "EPERM", "EACCES"].includes(code)) throw error;
      await fs.rename(target, replacement);
      try {
        await fs.rename(temporary, target);
      } catch (replacementError) {
        await fs.rename(replacement, target).catch(() => undefined);
        throw replacementError;
      }
      await fs.rm(replacement, { force: true });
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    await fs.rm(replacement, { force: true }).catch(() => undefined);
  }
  try {
    const directory = await fs.open(path.dirname(target), "r");
    await directory.sync();
    await directory.close();
  } catch {
    /* fsync directory is unavailable on some Windows filesystems */
  }
}

async function listReleaseFiles(root: string): Promise<Set<string>> {
  const files = new Set<string>();
  const visit = async (relative: string): Promise<void> => {
    const absolute = path.join(root, relative);
    for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await fs.lstat(path.join(root, next));
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new Error(`Refusing special release entry: ${next}.`);
      if (stat.isDirectory()) await visit(next);
      else files.add(next);
    }
  };
  await visit("");
  return files;
}

async function verifyReleaseDirectory(
  releaseRoot: string,
  expectedVersion?: string,
): Promise<{ version: string; releaseRoot: string } | null> {
  try {
    const manifest = parseVersionManifest(
      JSON.parse(
        await fs.readFile(
          path.join(releaseRoot, "version-manifest.json"),
          "utf8",
        ),
      ) as unknown,
    );
    if (
      (expectedVersion && manifest.version !== expectedVersion) ||
      !(await fs.stat(releaseRoot)).isDirectory()
    )
      return null;
    const actualFiles = await listReleaseFiles(releaseRoot);
    // version-manifest.json cannot hash itself; all other payload files must
    const declaredFiles = new Set(Object.keys(manifest.files));
    // be declared and hashed.
    if (
      !actualFiles.has("version-manifest.json") ||
      actualFiles.size !== declaredFiles.size + 1 ||
      [...actualFiles].some(
        (file) => file !== "version-manifest.json" && !declaredFiles.has(file),
      )
    )
      return null;
    for (const [relative, expected] of Object.entries(manifest.files)) {
      const clean = validateArchiveEntryPath(relative);
      if (
        clean !== relative ||
        !(await fs.stat(path.join(releaseRoot, clean))).isFile()
      )
        return null;
      if ((await sha256File(path.join(releaseRoot, clean))) !== expected)
        return null;
    }
    return { version: manifest.version, releaseRoot };
  } catch {
    return null;
  }
}

export interface InstallOptions {
  readonly version: string;
  readonly runtimeRoot: string;
  readonly platformName?: string;
  readonly archName?: string;
}

/** Install an exact release into a unique staging directory and atomically switch current.json. */
export async function installExactRelease(
  options: InstallOptions,
): Promise<InstalledPointer> {
  const platformName = options.platformName ?? platform();
  const archName = options.archName ?? arch();
  const expectedAsset = assetNameForPlatform(platformName, archName);
  const tag = `v${options.version}`;
  const release: ReleaseInfo = await fetchReleaseByTag(tag);
  const bundle = selectReleaseAsset(release, platformName, archName);
  if (bundle.name !== expectedAsset)
    throw new Error(`Release ${tag} asset mismatch: ${bundle.name}.`);
  const sumsAsset = release.assets.find((asset) => asset.name === "SHA256SUMS");
  if (!sumsAsset)
    throw new Error(
      `Release ${tag} lacks SHA256SUMS. Refusing to install; nothing was changed.`,
    );
  const staging = path.join(
    options.runtimeRoot,
    ".staging",
    `${options.version}-${process.pid}-${randomUUID()}`,
  );
  const bundlePath = path.join(staging, bundle.name);
  const sumsPath = path.join(staging, "SHA256SUMS");
  const extractDir = path.join(staging, "release");
  await fs.mkdir(path.join(options.runtimeRoot, ".staging"), {
    recursive: true,
  });
  await fs.mkdir(staging, { recursive: false });
  try {
    await downloadAsset(sumsAsset.downloadUrl, sumsPath);
    await downloadAsset(bundle.downloadUrl, bundlePath);
    const sums = parseSha256Sums(await fs.readFile(sumsPath, "utf8"));
    const actual = await sha256File(bundlePath);
    verifyDigestForAsset(sums, bundle.name, actual);
    if (!bundle.digest || !/^sha256:[a-f0-9]{64}$/u.test(bundle.digest)) {
      throw new Error(
        `Release ${tag} lacks an exact GitHub SHA-256 asset digest. Refusing to install; nothing was changed.`,
      );
    }
    verifyDigestForAsset(
      new Map([[bundle.name, bundle.digest.slice("sha256:".length)]]),
      bundle.name,
      actual,
    );
    await extractArchiveSecure(bundlePath, extractDir);
    if (!(await verifyReleaseDirectory(extractDir, options.version)))
      throw new Error(
        "Extracted runtime failed complete version-manifest file-hash validation.",
      );
    const manifest = parseVersionManifest(
      JSON.parse(
        await fs.readFile(
          path.join(extractDir, "version-manifest.json"),
          "utf8",
        ),
      ) as unknown,
    );
    if (manifest.version !== options.version)
      throw new Error(
        `Release manifest version ${manifest.version} does not match requested ${options.version}.`,
      );
    const compatibility = checkBootstrapCompatibility(
      manifest.version,
      manifest,
      BOOTSTRAP_PROTOCOL,
    );
    if (compatibility.kind === "incompatible")
      throw new Error(compatibility.reason);
    const releaseDir = path.join(
      options.runtimeRoot,
      "releases",
      options.version,
    );
    const existing = await verifyReleaseDirectory(releaseDir, options.version);
    if (existing) {
      const pointer = {
        version: existing.version,
        releaseDir: path
          .relative(options.runtimeRoot, releaseDir)
          .split(path.sep)
          .join("/"),
      };
      await fs.mkdir(options.runtimeRoot, { recursive: true });
      await writeFileSynced(
        path.join(options.runtimeRoot, "current.json"),
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      await writeFileSynced(
        path.join(options.runtimeRoot, "launcher.cjs"),
        LAUNCHER_TEMPLATE.replace(
          "__APTILOOP_NODE_JSON__",
          JSON.stringify(process.execPath),
        ),
      );
      return pointer;
    }
    try {
      await fs.access(releaseDir);
      throw new Error(
        `Immutable runtime release ${releaseDir} exists but failed validation; refusing overwrite.`,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        !((error as NodeJS.ErrnoException).code === "ENOENT")
      )
        throw error;
    }
    await fs.mkdir(path.join(options.runtimeRoot, "releases"), {
      recursive: true,
    });
    await fs.rename(extractDir, releaseDir);
    const pointer = {
      version: manifest.version,
      releaseDir: path
        .relative(options.runtimeRoot, releaseDir)
        .split(path.sep)
        .join("/"),
    };
    await writeFileSynced(
      path.join(options.runtimeRoot, "current.json"),
      `${JSON.stringify(pointer, null, 2)}\n`,
    );
    await writeFileSynced(
      path.join(options.runtimeRoot, "launcher.cjs"),
      LAUNCHER_TEMPLATE.replace(
        "__APTILOOP_NODE_JSON__",
        JSON.stringify(process.execPath),
      ),
    );
    return pointer;
  } finally {
    await fs
      .rm(staging, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

export type RuntimeSelection = "install" | "reuse" | "forward";

/** Apply protocol compatibility independently from semver ordering. */
export function selectRuntimeAction(
  bootstrapVersion: string,
  installedVersion: string,
  manifest: VersionManifest,
): RuntimeSelection {
  const protocol = checkBootstrapCompatibility(
    manifest.version,
    manifest,
    BOOTSTRAP_PROTOCOL,
  );
  if (protocol.kind === "incompatible") throw new Error(protocol.reason);
  const order = compareVersions(installedVersion, bootstrapVersion);
  if (order > 0) return "install";
  if (order === 0) return "reuse";
  return "forward";
}
export interface EnsureResult {
  readonly kind: "release" | "source-checkout";
  readonly cliEntry: string;
  readonly releaseRoot: string;
  readonly installedVersion: string | null;
}

export async function ensureRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EnsureResult> {
  const ownVersion = readOwnVersion();
  const runtimeRoot = resolveRuntimeRootFromEnv(env);
  const checkoutRoot = findSourceCheckoutRoot(process.cwd(), { existsSync });
  const pointer = await readInstalledPointer(runtimeRoot);
  if (!pointer) {
    if (checkoutRoot)
      return {
        kind: "source-checkout",
        cliEntry: path.join(checkoutRoot, "packages", "cli", "dist", "cli.js"),
        releaseRoot: checkoutRoot,
        installedVersion: null,
      };
    const installed = await installExactRelease({
      version: ownVersion,
      runtimeRoot,
    });
    const releaseRoot = path.join(runtimeRoot, installed.releaseDir);
    return {
      kind: "release",
      cliEntry: path.join(releaseRoot, "runtime-cli.cjs"),
      releaseRoot,
      installedVersion: installed.version,
    };
  }
  const releaseRoot = path.resolve(runtimeRoot, pointer.releaseDir);
  const verified = await verifyReleaseDirectory(releaseRoot, pointer.version);
  if (!verified)
    throw new Error(
      `Installed runtime ${pointer.version} is incomplete or failed its file manifest; refusing to run.`,
    );
  const manifest = parseVersionManifest(
    JSON.parse(
      await fs.readFile(
        path.join(releaseRoot, "version-manifest.json"),
        "utf8",
      ),
    ) as unknown,
  );
  const action = selectRuntimeAction(ownVersion, pointer.version, manifest);
  if (action === "install") {
    const upgraded = await installExactRelease({
      version: ownVersion,
      runtimeRoot,
    });
    const upgradedRoot = path.join(runtimeRoot, upgraded.releaseDir);
    return {
      kind: "release",
      cliEntry: path.join(upgradedRoot, "runtime-cli.cjs"),
      releaseRoot: upgradedRoot,
      installedVersion: upgraded.version,
    };
  }
  return {
    kind: "release",
    cliEntry: path.join(releaseRoot, "runtime-cli.cjs"),
    releaseRoot,
    installedVersion: pointer.version,
  };
}
