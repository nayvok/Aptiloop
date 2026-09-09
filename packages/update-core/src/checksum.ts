const SUMS_LINE = /^([0-9a-fA-F]{64})\s+\*?(.+)$/u;

export function parseSha256Sums(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = SUMS_LINE.exec(trimmed);
    if (match?.[1] && match[2])
      entries.set(match[2].trim(), match[1].toLowerCase());
  }
  return entries;
}

/**
 * Verify one asset against the release SHA256SUMS map. Pure (no I/O): the
 * caller hashes the downloaded bytes and passes the hex digest in.
 */
export function verifyDigestForAsset(
  sums: ReadonlyMap<string, string>,
  assetName: string,
  actualHex: string,
): void {
  const expected = sums.get(assetName);
  if (!expected) {
    throw new Error(
      `Refusing to apply ${assetName}: no SHA-256 entry in the release SHA256SUMS manifest. Nothing was changed.`,
    );
  }
  if (actualHex.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `Refusing to apply ${assetName}: SHA-256 mismatch (expected ${expected}, got ${actualHex}). Nothing was changed.`,
    );
  }
}
