import { compareVersions, normalizeVersion } from "./version.js";

/** Bootstrap protocol spoken by the public `aptiloop` npm bootstrap. */
export const BOOTSTRAP_PROTOCOL = 1;

export interface VersionManifest {
  readonly version: string;
  readonly bootstrapProtocol: number;
  readonly minBootstrapProtocol: number;
  readonly files: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and strictly validate release version-manifest.json. */
export function parseVersionManifest(raw: unknown): VersionManifest {
  if (!isRecord(raw))
    throw new Error("Invalid version-manifest: not an object.");
  const { version, bootstrapProtocol, minBootstrapProtocol, files } = raw;
  if (typeof version !== "string")
    throw new Error("Invalid version-manifest: version must be a string.");
  normalizeVersion(version);
  if (
    typeof bootstrapProtocol !== "number" ||
    !Number.isSafeInteger(bootstrapProtocol) ||
    bootstrapProtocol < 1
  ) {
    throw new Error(
      "Invalid version-manifest: bootstrapProtocol must be a positive integer.",
    );
  }
  if (
    typeof minBootstrapProtocol !== "number" ||
    !Number.isSafeInteger(minBootstrapProtocol) ||
    minBootstrapProtocol < 1 ||
    minBootstrapProtocol > bootstrapProtocol
  ) {
    throw new Error(
      "Invalid version-manifest: minBootstrapProtocol must be a positive integer <= bootstrapProtocol.",
    );
  }
  if (!isRecord(files) || Object.keys(files).length === 0)
    throw new Error(
      "Invalid version-manifest: files must be a non-empty object.",
    );
  const parsedFiles: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [file, digest] of Object.entries(files)) {
    if (
      typeof digest !== "string" ||
      !/^[0-9a-f]{64}$/iu.test(digest) ||
      file.trim() === "" ||
      file.includes("\\") ||
      file.startsWith("/") ||
      /^[A-Za-z]:/u.test(file) ||
      file
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        )
    ) {
      throw new Error(`Invalid version-manifest file hash: ${file}.`);
    }
    parsedFiles[file] = digest.toLowerCase();
  }
  return {
    version,
    bootstrapProtocol,
    minBootstrapProtocol,
    files: parsedFiles,
  };
}

export type BootstrapCompatibility =
  | { readonly kind: "compatible"; readonly forward: boolean }
  | {
      readonly kind: "downgrade";
      readonly installed: string;
      readonly candidate: string;
    }
  | { readonly kind: "incompatible"; readonly reason: string };

export function checkBootstrapCompatibility(
  installedVersion: string,
  manifest: VersionManifest,
  bootstrapProtocol: number = BOOTSTRAP_PROTOCOL,
): BootstrapCompatibility {
  if (
    bootstrapProtocol < manifest.minBootstrapProtocol ||
    bootstrapProtocol > manifest.bootstrapProtocol
  ) {
    return {
      kind: "incompatible",
      reason: `Release ${manifest.version} requires bootstrap protocol [${manifest.minBootstrapProtocol}..${manifest.bootstrapProtocol}], this npm package speaks ${bootstrapProtocol}. Upgrade the aptiloop npm package before applying.`,
    };
  }
  const comparison = compareVersions(installedVersion, manifest.version);
  if (comparison < 0)
    return {
      kind: "downgrade",
      installed: installedVersion,
      candidate: manifest.version,
    };
  return { kind: "compatible", forward: comparison > 0 };
}
