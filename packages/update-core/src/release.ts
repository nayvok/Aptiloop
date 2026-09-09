import { normalizeVersion, parseTagVersion } from "./version.js";

export interface ReleaseAsset {
  readonly name: string;
  readonly size: number;
  readonly downloadUrl: string;
  readonly digest?: string | undefined;
}

export interface ReleaseInfo {
  readonly version: string;
  readonly tag: string;
  readonly name: string;
  readonly notes: string;
  readonly publishedAt: string;
  readonly assets: readonly ReleaseAsset[];
}

export interface GithubAssetPayload {
  readonly name?: unknown;
  readonly size?: unknown;
  readonly browser_download_url?: unknown;
  readonly digest?: unknown;
}

export interface GithubReleasePayload {
  readonly tag_name?: unknown;
  readonly name?: unknown;
  readonly body?: unknown;
  readonly published_at?: unknown;
  readonly assets?: unknown;
}

/**
 * Exact runtime asset name for a supported platform/arch pair. Throws before
 * any download on unsupported pairs (fail-before-download invariant).
 */
export function assetNameForPlatform(
  platformName: string,
  arch: string,
): string {
  if (platformName === "win32" && arch === "x64") {
    return "aptiloop-runtime-win32-x64.zip";
  }
  if (platformName === "darwin" && (arch === "x64" || arch === "arm64")) {
    return `aptiloop-runtime-darwin-${arch}.tar.gz`;
  }
  if (platformName === "linux" && (arch === "x64" || arch === "arm64")) {
    return `aptiloop-runtime-linux-${arch}.tar.gz`;
  }
  throw new Error(
    `Unsupported platform for Aptiloop runtime bundles: ${platformName}/${arch}. ` +
      `Supported: win32-x64, darwin-x64, darwin-arm64, linux-x64, linux-arm64.`,
  );
}

export function platformAssetCandidates(): readonly string[] {
  return [
    "aptiloop-runtime-win32-x64.zip",
    "aptiloop-runtime-darwin-x64.tar.gz",
    "aptiloop-runtime-darwin-arm64.tar.gz",
    "aptiloop-runtime-linux-x64.tar.gz",
    "aptiloop-runtime-linux-arm64.tar.gz",
  ];
}

type ValidatedAsset = GithubAssetPayload & {
  readonly name: string;
  readonly size: number;
  readonly browser_download_url: string;
};

function isReleaseAsset(value: GithubAssetPayload): value is ValidatedAsset {
  return (
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    typeof value.browser_download_url === "string" &&
    (value.digest === undefined || typeof value.digest === "string")
  );
}

/** Parse and strictly validate a GitHub release payload (tag/version/assets). */
export function parseGithubRelease(
  body: GithubReleasePayload,
  tagOverride?: string,
): ReleaseInfo {
  const payloadTag = typeof body.tag_name === "string" ? body.tag_name : null;
  if (
    tagOverride !== undefined &&
    payloadTag !== null &&
    payloadTag.trim() !== tagOverride.trim()
  ) {
    throw new Error(
      `GitHub release tag mismatch: requested ${tagOverride}, received ${payloadTag}.`,
    );
  }
  const tag = tagOverride ?? payloadTag;
  if (typeof tag !== "string" || tag.trim() === "") {
    throw new Error("GitHub Releases returned an unexpected payload.");
  }
  const version = parseTagVersion(tag);
  normalizeVersion(version);
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const parsed: ReleaseAsset[] = [];
  for (const entry of assets as GithubAssetPayload[]) {
    if (!entry || typeof entry !== "object") continue;
    if (!isReleaseAsset(entry)) continue;
    parsed.push({
      name: entry.name,
      size: entry.size,
      downloadUrl: entry.browser_download_url,
      ...(typeof entry.digest === "string" ? { digest: entry.digest } : {}),
    });
  }
  return {
    version,
    tag,
    name: typeof body.name === "string" ? body.name : tag,
    notes: typeof body.body === "string" ? body.body : "",
    publishedAt: typeof body.published_at === "string" ? body.published_at : "",
    assets: parsed,
  };
}

/** Select the single exact runtime asset for this platform/arch. */
export function selectReleaseAsset(
  release: ReleaseInfo,
  platformName: string,
  arch: string,
): ReleaseAsset {
  const expected = assetNameForPlatform(platformName, arch);
  const matches = release.assets.filter((asset) => asset.name === expected);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Release ${release.tag} has no runtime asset ${expected}. ` +
            `Available: ${release.assets.map((asset) => asset.name).join(", ") || "none"}.`
        : `Release ${release.tag} contains duplicate runtime assets ${expected}.`,
    );
  }
  return matches[0]!;
}
