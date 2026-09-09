import { promises as fs } from "node:fs";
import { inflateRawSync, gunzipSync } from "node:zlib";

const WINDOWS_DEVICE_NAMES: Record<string, true> = {
  con: true,
  prn: true,
  aux: true,
  nul: true,
  com1: true,
  com2: true,
  com3: true,
  com4: true,
  com5: true,
  com6: true,
  com7: true,
  com8: true,
  com9: true,
  lpt1: true,
  lpt2: true,
  lpt3: true,
  lpt4: true,
  lpt5: true,
  lpt6: true,
  lpt7: true,
  lpt8: true,
  lpt9: true,
};

export interface ArchiveEntry {
  readonly path: string;
  readonly symlink: boolean;
  readonly size: number;
}

export interface ArchiveLimits {
  readonly maxEntries: number;
  readonly maxTotalBytes: number;
  readonly maxEntryBytes: number;
  /** Compressed archive cap, checked before reading bytes. */
  readonly maxArchiveBytes?: number;
}
/** Conservative defaults: 16k entries, 1.5 GiB total, 512 MiB per entry. */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 16_000,
  maxTotalBytes: 1536 * 1024 * 1024,
  maxEntryBytes: 512 * 1024 * 1024,
  maxArchiveBytes: 256 * 1024 * 1024,
};

/** Reject traversal, absolute paths, UNC/device names, and alternate separators. */
export function validateArchiveEntryPath(entryPath: string): string {
  if (entryPath === "")
    throw new Error("Refusing archive entry with an empty path.");
  if (entryPath.includes("\\"))
    throw new Error(`Refusing archive entry with a backslash: ${entryPath}.`);
  if (
    entryPath.startsWith("/") ||
    entryPath.startsWith("//") ||
    /^[A-Za-z]:/u.test(entryPath)
  ) {
    throw new Error(`Refusing absolute archive entry: ${entryPath}.`);
  }
  const segments = entryPath.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..")
      throw new Error(
        `Refusing archive entry with unsafe segment: ${entryPath}.`,
      );
    if (segment.includes(":"))
      throw new Error(
        `Refusing archive entry with device/stream syntax: ${entryPath}.`,
      );
    const base = segment.split(".")[0]?.toLowerCase() ?? "";
    if (
      Object.prototype.hasOwnProperty.call(
        WINDOWS_DEVICE_NAMES,
        segment.toLowerCase(),
      ) ||
      Object.prototype.hasOwnProperty.call(WINDOWS_DEVICE_NAMES, base)
    ) {
      throw new Error(`Refusing archive entry with device name: ${entryPath}.`);
    }
    if ([...segment].some((char) => char.charCodeAt(0) < 0x20)) {
      throw new Error(
        `Refusing archive entry with control character: ${entryPath}.`,
      );
    }
  }
  return segments.join("/");
}

/** Validate names, types, count, and declared uncompressed sizes before extraction. */
export function validateArchiveInventory(
  entries: readonly ArchiveEntry[],
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): string[] {
  if (entries.length === 0) throw new Error("Refusing empty runtime archive.");
  if (entries.length > limits.maxEntries)
    throw new Error(
      `Refusing runtime archive with ${entries.length} entries (limit ${limits.maxEntries}).`,
    );
  let total = 0;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    if (entry.symlink)
      throw new Error(`Refusing archive symlink entry: ${entry.path}.`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0)
      throw new Error(
        `Refusing archive entry with invalid size: ${entry.path}.`,
      );
    if (entry.size > limits.maxEntryBytes)
      throw new Error(
        `Refusing oversized archive entry ${entry.path} (${entry.size} bytes, limit ${limits.maxEntryBytes}).`,
      );
    total += entry.size;
    if (total > limits.maxTotalBytes)
      throw new Error(
        `Refusing runtime archive exceeding ${limits.maxTotalBytes} bytes total.`,
      );
    const clean = validateArchiveEntryPath(entry.path);
    if (seen.has(clean))
      throw new Error(`Refusing archive with duplicate entry: ${entry.path}.`);
    seen.add(clean);
    normalized.push(clean);
  }
  return normalized;
}

interface ParsedContent {
  readonly path: string;
  readonly directory: boolean;
  readonly data?: Buffer;
}

function u16(data: Buffer, offset: number): number {
  return data.readUInt16LE(offset);
}
function u32(data: Buffer, offset: number): number {
  return data.readUInt32LE(offset);
}
function boundedInflate(
  input: Buffer,
  expected: number,
  limits: ArchiveLimits,
  name: string,
): Buffer {
  if (
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    expected > limits.maxEntryBytes
  )
    throw new Error(`Refusing oversized archive entry ${name}.`);
  const output = inflateRawSync(input, {
    maxOutputLength: limits.maxEntryBytes,
  });
  if (output.length !== expected)
    throw new Error(`Archive entry size mismatch: ${name}.`);
  return output;
}

function parseZip(data: Buffer, limits: ArchiveLimits): ParsedContent[] {
  // Zip64, encrypted, multi-disk, and data-descriptor archives are rejected.
  const start = Math.max(0, data.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = data.length - 22; i >= start; i -= 1) {
    if (i >= 0 && u32(data, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new Error(
      "Refusing ZIP without a valid end-of-central-directory record.",
    );
  const disk = u16(data, eocd + 4);
  const centralDisk = u16(data, eocd + 6);
  const entriesOnDisk = u16(data, eocd + 8);
  const count = u16(data, eocd + 10);
  const centralSize = u32(data, eocd + 12);
  const centralOffset = u32(data, eocd + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== count ||
    count === 0 ||
    count > limits.maxEntries ||
    centralOffset + centralSize > data.length
  ) {
    throw new Error(
      "Refusing ZIP multi-disk, Zip64, or invalid central directory.",
    );
  }
  const out: ParsedContent[] = [];
  const inventory: ArchiveEntry[] = [];
  let declaredTotal = 0;
  let offset = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > data.length || u32(data, offset) !== 0x02014b50)
      throw new Error("Refusing malformed ZIP central directory.");
    const versionMadeBy = u16(data, offset + 4);
    const flags = u16(data, offset + 8);
    const method = u16(data, offset + 10);
    const compressedSize = u32(data, offset + 20);
    const size = u32(data, offset + 24);
    const nameLen = u16(data, offset + 28);
    const extraLen = u16(data, offset + 30);
    const commentLen = u16(data, offset + 32);
    const diskNumber = u16(data, offset + 34);
    const external = u32(data, offset + 38);
    const local = u32(data, offset + 42);
    if (
      (flags & 0x01) !== 0 ||
      (flags & 0x08) !== 0 ||
      diskNumber !== 0 ||
      versionMadeBy === 0xffff ||
      size === 0xffffffff ||
      compressedSize === 0xffffffff ||
      local === 0xffffffff
    ) {
      throw new Error(
        "Refusing encrypted, multi-disk, descriptor, or Zip64 entry.",
      );
    }
    const nameBytes = data.subarray(offset + 46, offset + 46 + nameLen);
    const name = nameBytes.toString(flags & 0x800 ? "utf8" : "latin1");
    const clean = validateArchiveEntryPath(
      name.endsWith("/") ? name.slice(0, -1) : name,
    );
    const directory = name.endsWith("/");
    const unixType = (external >>> 16) & 0xf000;
    if (unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000)
      throw new Error(`Refusing ZIP special file: ${name}.`);
    declaredTotal += size;
    if (
      !Number.isSafeInteger(declaredTotal) ||
      declaredTotal > limits.maxTotalBytes
    )
      throw new Error(
        `Refusing runtime archive exceeding ${limits.maxTotalBytes} bytes total.`,
      );
    if (local + 30 > data.length || u32(data, local) !== 0x04034b50)
      throw new Error(`Refusing ZIP entry with invalid local header: ${name}.`);
    const localFlags = u16(data, local + 6);
    const localMethod = u16(data, local + 8);
    const localNameLen = u16(data, local + 26);
    const localExtraLen = u16(data, local + 28);
    const localName = data.subarray(local + 30, local + 30 + localNameLen);
    if (
      localFlags !== flags ||
      localMethod !== method ||
      !localName.equals(nameBytes)
    )
      throw new Error(`Refusing ZIP local/central header mismatch: ${name}.`);
    if (directory || unixType === 0x4000 || (external & 0x10) !== 0) {
      if (size !== 0 || compressedSize !== 0)
        throw new Error(`Refusing non-empty ZIP directory: ${name}.`);
      inventory.push({ path: clean, symlink: false, size: 0 });
      out.push({ path: clean, directory: true });
    } else {
      const begin = local + 30 + localNameLen + localExtraLen;
      const end = begin + compressedSize;
      if (end > data.length)
        throw new Error(`Refusing truncated ZIP entry: ${name}.`);
      const content =
        method === 0
          ? data.subarray(begin, end)
          : method === 8
            ? boundedInflate(data.subarray(begin, end), size, limits, name)
            : (() => {
                throw new Error(
                  `Refusing unsupported ZIP compression for ${name}.`,
                );
              })();
      if (content.length !== size)
        throw new Error(`Archive entry size mismatch: ${name}.`);
      inventory.push({ path: clean, symlink: false, size });
      out.push({ path: clean, directory: false, data: Buffer.from(content) });
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  validateArchiveInventory(inventory, limits);
  return out;
}

function parseTar(data: Buffer, limits: ArchiveLimits): ParsedContent[] {
  const out: ParsedContent[] = [];
  const inventory: ArchiveEntry[] = [];
  let offset = 0;
  let declaredTotal = 0;
  let ended = false;
  let pendingPaxPath: string | null = null;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    const checksumText = header
      .subarray(148, 156)
      .toString("ascii")
      .replace(/\0.*$/u, "")
      .trim();
    const expectedChecksum = Number.parseInt(checksumText, 8);
    let actualChecksum = 0;
    for (let index = 0; index < 512; index += 1)
      actualChecksum +=
        index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
    if (
      !Number.isSafeInteger(expectedChecksum) ||
      actualChecksum !== expectedChecksum
    )
      throw new Error("Refusing TAR with invalid header checksum.");
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const prefix = header
      .subarray(345, 500)
      .toString("utf8")
      .replace(/\0.*$/u, "");
    const archiveName = prefix ? `${prefix}/${name}` : name;
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/u, "")
      .trim();
    const size = sizeText === "" ? 0 : Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error(`Refusing invalid TAR size: ${archiveName}.`);
    declaredTotal += size;
    if (
      !Number.isSafeInteger(declaredTotal) ||
      declaredTotal > limits.maxTotalBytes
    )
      throw new Error(
        `Refusing runtime archive exceeding ${limits.maxTotalBytes} bytes total.`,
      );
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > data.length)
      throw new Error(`Refusing truncated TAR entry: ${archiveName}.`);
    const type = header[156] ?? 0;
    if (type === 120) {
      const pax = data.subarray(bodyStart, bodyEnd).toString("utf8");
      const match = pax.match(/(?:^|\n)\d+ path=(.*)\n/u);
      if (!match?.[1])
        throw new Error("Refusing TAR extended header without a path.");
      pendingPaxPath = match[1];
      offset = bodyStart + Math.ceil(size / 512) * 512;
      continue;
    }
    const full = pendingPaxPath ?? archiveName;
    pendingPaxPath = null;
    const clean = validateArchiveEntryPath(
      full.endsWith("/") ? full.slice(0, -1) : full,
    );
    const directory = type === 53;
    if (!(type === 0 || type === 48 || type === 53))
      throw new Error(`Refusing TAR special/link entry: ${full}.`);
    if (directory) {
      if (size !== 0)
        throw new Error(`Refusing non-empty TAR directory: ${full}.`);
      inventory.push({ path: clean, symlink: false, size: 0 });
      out.push({ path: clean, directory: true });
    } else {
      inventory.push({ path: clean, symlink: false, size });
      out.push({
        path: clean,
        directory: false,
        data: Buffer.from(data.subarray(bodyStart, bodyEnd)),
      });
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (!ended) throw new Error("Refusing TAR without an end-of-archive marker.");
  validateArchiveInventory(inventory, limits);
  return out;
}

export async function extractArchiveSecure(
  archivePath: string,
  destination: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<void> {
  const archiveStat = await fs.stat(archivePath);
  const maxArchiveBytes = limits.maxArchiveBytes ?? 256 * 1024 * 1024;
  if (
    !Number.isSafeInteger(archiveStat.size) ||
    archiveStat.size > maxArchiveBytes
  )
    throw new Error(`Refusing archive larger than ${maxArchiveBytes} bytes.`);
  const raw = await fs.readFile(archivePath);
  if (raw.length > maxArchiveBytes)
    throw new Error(`Refusing archive larger than ${maxArchiveBytes} bytes.`);
  const entries =
    raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b
      ? parseTar(
          gunzipSync(raw, { maxOutputLength: limits.maxTotalBytes }),
          limits,
        )
      : parseZip(raw, limits);
  await fs.mkdir(destination, { recursive: false });
  // Parsing and validation above completes before the first write.
  for (const entry of entries.filter((item) => item.directory))
    await fs.mkdir(`${destination}/${entry.path}`, { recursive: true });
  for (const entry of entries.filter((item) => !item.directory)) {
    const target = `${destination}/${entry.path}`;
    await fs.mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
    });
    const handle = await fs.open(target, "wx");
    try {
      await handle.writeFile(entry.data ?? Buffer.alloc(0));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
