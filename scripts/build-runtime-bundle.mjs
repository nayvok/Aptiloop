import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
const root = path.resolve(import.meta.dirname, "..");
function runNpm(npmArgs) {
  const npmScript =
    process.env.npm_execpath ??
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
  return spawnSync(process.execPath, [npmScript, ...npmArgs], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
}
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key?.startsWith("--"))
    args.set(key.slice(2), process.argv[index + 1] ?? "");
}
const version =
  args.get("version") ||
  JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
    .version;
const target = args.get("platform") ?? `${process.platform}-${process.arch}`;
const outRoot = path.resolve(
  args.get("out") ?? path.join(root, "release-artifacts", target),
);
const archiveName =
  target === "win32-x64"
    ? `aptiloop-runtime-${target}.zip`
    : `aptiloop-runtime-${target}.tar.gz`;
const staging = path.join(outRoot, `.staging-${version}-${randomUUID()}`);

// Every listed input is required for a runnable release. A future optional
// asset must be marked explicitly and cannot silently disappear.
const sourceMappings = [
  ["packages/cli/dist/runtime-cli.cjs", "runtime-cli.cjs", true],
  [
    "scripts/local-process-launcher.mjs",
    "scripts/local-process-launcher.mjs",
    true,
  ],
  ["scripts/update-worker.mjs", "scripts/update-worker.mjs", true],
  ["scripts/update-launcher-env.mjs", "scripts/update-launcher-env.mjs", true],
  ["apps/orchestrator/dist", "apps/orchestrator/dist", true],
  ["apps/web/.next/standalone", "apps/web/.next/standalone", true],
  [
    "apps/web/.next/static",
    "apps/web/.next/standalone/apps/web/.next/static",
    true,
  ],
  ["apps/web/public", "apps/web/.next/standalone/apps/web/public", true],
  [
    "apps/web/app/icon.svg",
    "apps/web/.next/standalone/apps/web/app/icon.svg",
    true,
  ],
  ["packages/database/migrations", "packages/database/migrations", true],
  [
    "packages/course-authoring-kit/schema",
    "packages/course-authoring-kit/schema",
    true,
  ],
  [
    "packages/course-authoring-kit/templates",
    "packages/course-authoring-kit/templates",
    true,
  ],
  ["packages/update-core/dist", "packages/update-core/dist", true],
  ["NOTICE", "NOTICE", true],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md", true],
];

function runtimeCopyFilter(candidate, source) {
  const relative = path.relative(source, candidate).split(path.sep).join("/");
  const basename = path.basename(candidate);
  if (relative === "") return true;
  if (/(?:\.d\.ts|\.map|\.md|\.ts)$/u.test(relative)) return false;
  if (
    /(?:^|\/)(?:test|tests|docs|examples|benchmarks?)(?:\/|$)/u.test(relative)
  )
    return false;
  if (/(?:\.test|\.spec)\.[^.]+$/u.test(basename)) return false;
  return true;
}
async function copyIfPresent(sourceRelative, destinationRelative, required) {
  const source = path.join(root, sourceRelative);
  try {
    await fs.stat(source);
  } catch (error) {
    if (required)
      throw new Error(`Required runtime input is missing: ${sourceRelative}`, {
        cause: error,
      });
    return;
  }
  const destination = path.join(staging, destinationRelative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (candidate) => runtimeCopyFilter(candidate, source),
  });
}

async function walk(directory, prefix = "") {
  const result = [];
  for (const entry of (
    await fs.readdir(directory, { withFileTypes: true })
  ).sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing symlink in runtime payload: ${relative}`);
    if (entry.isDirectory()) result.push(...(await walk(absolute, relative)));
    else if (entry.isFile())
      result.push({ relative, data: await fs.readFile(absolute) });
    else
      throw new Error(`Refusing special file in runtime payload: ${relative}`);
  }
  return result;
}

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipArchive(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.relative, "utf8");
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc32(file.data), 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    name.copy(header, 30);
    local.push(header, file.data);
    const directory = Buffer.alloc(46 + name.length);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc32(file.data), 16);
    directory.writeUInt32LE(file.data.length, 20);
    directory.writeUInt32LE(file.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    name.copy(directory, 46);
    central.push(directory);
    offset += header.length + file.data.length;
  }
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, end]);
}
function splitTarPath(name) {
  const direct = Buffer.byteLength(name) <= 100 && !name.includes("/");
  if (direct) return { shortName: name, prefix: "" };
  const pieces = name.split("/");
  for (let index = pieces.length - 1; index > 0; index -= 1) {
    const shortName = pieces.slice(index).join("/");
    const prefix = pieces.slice(0, index).join("/");
    if (Buffer.byteLength(shortName) <= 100 && Buffer.byteLength(prefix) <= 155)
      return { shortName, prefix };
  }
  return null;
}
function tarHeader(name, size, type = "0") {
  const split = splitTarPath(name);
  const shortName = Buffer.from(split?.shortName ?? "file", "utf8");
  const prefix = Buffer.from(split?.prefix ?? "", "utf8");
  const header = Buffer.alloc(512);
  shortName.copy(header, 0);
  prefix.copy(header, 345);
  header.write("0000644", 100, 6, "ascii");
  header[106] = 0;
  header.write("0000000", 108, 7, "ascii");
  header[115] = 0;
  header.write("0000000", 116, 7, "ascii");
  header[123] = 0;
  header.write(size.toString(8).padStart(11, "0"), 124, 11, "ascii");
  header[135] = 0;
  header.write("00000000000", 136, 11, "ascii");
  header[147] = 0;
  header[156] = type.charCodeAt(0);
  header.write("ustar", 257, 5, "ascii");
  header[262] = 0;
  header.write("00", 263, 2, "ascii");
  for (let i = 148; i < 156; i += 1) header[i] = 0x20;
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0x20;
  header[155] = 0;
  return header;
}
function paxPathRecord(name) {
  let length = Buffer.byteLength(`path=${name}\n`) + 2;
  for (;;) {
    const record = `${length} path=${name}\n`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return Buffer.from(record, "utf8");
    length = actual;
  }
}
function tarArchive(files) {
  const chunks = [];
  for (const file of files) {
    const split = splitTarPath(file.relative);
    if (!split) {
      const pax = paxPathRecord(file.relative);
      chunks.push(tarHeader("PaxHeaders/0", pax.length, "x"), pax);
      const paxPadding = (512 - (pax.length % 512)) % 512;
      if (paxPadding) chunks.push(Buffer.alloc(paxPadding));
    }
    chunks.push(
      tarHeader(split ? file.relative : "file", file.data.length),
      file.data,
    );
    const padding = (512 - (file.data.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { mtime: 0 });
}

async function packageDirectory(name, fromDirectory = root, optional = false) {
  let current = fromDirectory;
  for (;;) {
    const candidate = path.join(current, "node_modules", ...name.split("/"));
    try {
      if ((await fs.lstat(candidate)).isSymbolicLink())
        throw new Error(
          `Runtime dependency is a workspace link, not bundled: ${name}`,
        );
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Runtime dependency is a workspace link")
      )
        throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      if (optional) return null;
      throw new Error(`Runtime dependency is not installed: ${name}`);
    }
    current = parent;
  }
}
const productionDependencyNames = new Set();
async function copyProductionDependencies() {
  const required = [
    "@hono/node-server",
    "hono",
    "zod",
    "typebox",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@opencode-ai/sdk",
  ];
  const copied = new Set();
  const visit = async (name, fromDirectory = root, optional = false) => {
    if (copied.has(name)) return;
    const source = await packageDirectory(name, fromDirectory, optional);
    if (!source) return;
    copied.add(name);
    productionDependencyNames.add(name);
    const destination = path.join(staging, "node_modules", ...name.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (candidate) => {
        const relative = path
          .relative(source, candidate)
          .split(path.sep)
          .join("/");
        return (
          relative === "package.json" ||
          !/(?:\.d\.ts|\.map|\.md|\.ts)$/u.test(relative)
        );
      },
    });
    const manifest = JSON.parse(
      await fs.readFile(path.join(source, "package.json"), "utf8"),
    );
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      await visit(dependency, source);
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {}))
      await visit(dependency, source, true);
    for (const dependency of Object.keys(manifest.peerDependencies ?? {}))
      await visit(dependency, source, true);
  };
  for (const dependency of required) await visit(dependency);
}

function normalizeSbom(value) {
  if (!value || typeof value !== "object")
    throw new Error("Invalid CycloneDX SBOM.");
  const sbom = globalThis.structuredClone(value);
  delete sbom.serialNumber;
  if (sbom.metadata && typeof sbom.metadata === "object")
    delete sbom.metadata.timestamp;
  for (const key of [
    "components",
    "dependencies",
    "services",
    "externalReferences",
  ]) {
    if (Array.isArray(sbom[key]))
      sbom[key].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  }
  return sbom;
}

async function writeSbom() {
  const result = runNpm([
    "sbom",
    "--sbom-format=cyclonedx",
    "--workspaces",
    "--include-workspace-root",
    "--legacy-peer-deps",
  ]);
  if (result.error || result.status !== 0)
    throw new Error(
      `CycloneDX SBOM generation failed: ${result.stderr ?? result.error?.message ?? result.status}`,
    );
  const sbom = normalizeSbom(JSON.parse(String(result.stdout)));
  if (sbom?.bomFormat !== "CycloneDX")
    throw new Error("npm sbom did not produce CycloneDX output.");
  if (Array.isArray(sbom.components)) {
    sbom.components = sbom.components.filter((component) =>
      productionDependencyNames.has(component.name),
    );
  }
  if (Array.isArray(sbom.dependencies)) {
    sbom.dependencies = sbom.dependencies.filter((dependency) => {
      const ref = typeof dependency.ref === "string" ? dependency.ref : "";
      return [...productionDependencyNames].some((name) => ref.includes(name));
    });
  }
  await fs.writeFile(
    path.join(staging, "SBOM.cdx.json"),
    `${JSON.stringify(sbom, null, 2)}\n`,
  );
}

await fs.mkdir(outRoot, { recursive: true });
await fs.mkdir(staging, { recursive: false });
try {
  for (const [source, destination, required] of sourceMappings)
    await copyIfPresent(source, destination, required);
  await copyProductionDependencies();
  await writeSbom();
  const files = await walk(staging);
  if (!files.some((file) => file.relative === "runtime-cli.cjs"))
    throw new Error(
      "Runtime CLI build output is missing; run the CLI build first.",
    );
  const manifestFiles = Object.fromEntries(
    files.map((file) => [
      file.relative,
      createHash("sha256").update(file.data).digest("hex"),
    ]),
  );
  const manifest = {
    version: String(version),
    bootstrapProtocol: 1,
    minBootstrapProtocol: 1,
    files: manifestFiles,
  };
  await fs.writeFile(
    path.join(staging, "version-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const finalFiles = await walk(staging);
  const archive =
    target === "win32-x64" ? zipArchive(finalFiles) : tarArchive(finalFiles);
  await fs.writeFile(path.join(outRoot, archiveName), archive, { flag: "wx" });
  process.stdout.write(`${path.join(outRoot, archiveName)}\n`);
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
