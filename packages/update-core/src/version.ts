const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;
const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

export function normalizeVersion(version: string): ParsedVersion {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      `Invalid version "${version}": expected MAJOR.MINOR.PATCH (e.g. 0.3.1).`,
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * Validate a GitHub tag (`vX.Y.Z`) and return its version (`X.Y.Z`).
 * Rejects anything that is not an exact `v` + semver tag.
 */
export function parseTagVersion(tag: string): string {
  const trimmed = tag.trim();
  const match = TAG_PATTERN.exec(trimmed);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      `Invalid release tag "${tag}": expected vMAJOR.MINOR.PATCH (e.g. v0.3.1).`,
    );
  }
  const version = trimmed.slice(1);
  normalizeVersion(version);
  return version;
}

/**
 * Compare semver versions numerically. Returns 1 when `candidate` is newer
 * than `current`, -1 when older, 0 when equal. A stable release outranks its
 * own prerelease (e.g. 1.0.0 > 1.0.0-rc.1). Prerelease-vs-prerelease compares
 * lexically after the numeric triple.
 */
export function compareVersions(current: string, candidate: string): number {
  const left = normalizeVersion(current);
  const right = normalizeVersion(candidate);
  for (const part of ["major", "minor", "patch"] as const) {
    if (right[part] !== left[part]) return right[part] > left[part] ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return -1;
  if (right.prerelease === null) return 1;
  if (right.prerelease === left.prerelease) return 0;
  return right.prerelease > left.prerelease ? 1 : -1;
}
