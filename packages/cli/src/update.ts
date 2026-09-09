import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseGithubRelease,
  verifyDigestForAsset,
  type GithubReleasePayload,
  type ReleaseInfo,
} from "@aptiloop/update-core";

import { GITHUB_OWNER, GITHUB_REPO } from "./config.js";

export type { ReleaseInfo };
export { compareVersions, parseSha256Sums } from "@aptiloop/update-core";

const METADATA_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;

function githubHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "aptiloop-cli",
  };
}

async function responseTextBounded(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) throw new Error("Response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes)
      throw new Error("Release metadata exceeds the response size cap.");
    chunks.push(chunk.value);
  }
  return new TextDecoder().decode(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
  );
}

async function fetchReleasePayload(url: string): Promise<GithubReleasePayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: githubHeaders(),
      signal: controller.signal,
    });
    if (response.status === 404) throw new Error("NOT_FOUND");
    if (!response.ok) throw new Error(`STATUS_${response.status}`);
    return JSON.parse(
      await responseTextBounded(response, 2 * 1024 * 1024),
    ) as GithubReleasePayload;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchReleaseByTag(tag: string): Promise<ReleaseInfo> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`;
  try {
    return parseGithubRelease(await fetchReleasePayload(url), tag);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      throw new Error(`Release ${tag} was not found.`, { cause: error });
    }
    if (error instanceof Error && /^STATUS_/u.test(error.message)) {
      throw new Error(
        `GitHub Releases request failed with status ${error.message.slice(7)}.`,
        { cause: error },
      );
    }
    throw new Error(
      "Update status is not-checked: GitHub Releases is unreachable offline.",
      { cause: error },
    );
  }
}

export async function downloadAsset(
  downloadUrl: string,
  destination: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let completed = false;
  let createdDestination = false;
  try {
    const response = await fetch(downloadUrl, {
      headers: githubHeaders(),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with status ${response.status}.`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const file = await fs.open(destination, "wx");
    createdDestination = true;
    let received = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += chunk.value.byteLength;
        if (received > MAX_ASSET_BYTES) {
          throw new Error(
            `Download refused: asset exceeds the ${MAX_ASSET_BYTES}-byte cap. Nothing was applied.`,
          );
        }
        await file.write(chunk.value);
      }
    } finally {
      await file.close();
    }
    completed = true;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Download failed: Releases asset timed out.", {
        cause: error,
      });
    }
    throw error instanceof Error
      ? error
      : new Error(String(error), { cause: error });
  } finally {
    clearTimeout(timer);
    if (createdDestination && !completed)
      await fs.rm(destination, { force: true }).catch(() => undefined);
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export async function verifyAssetAgainstSums(
  assetPath: string,
  sums: Map<string, string>,
  assetName: string,
): Promise<void> {
  const actual = await sha256File(assetPath);
  verifyDigestForAsset(sums, assetName, actual);
}
export async function orchestratorRequest<T>(
  orchestratorUrl: string,
  route: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${orchestratorUrl}${route}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Aptiloop-Client": "cli",
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    { error?: unknown } | T | null;
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Orchestrator request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return body as T;
}
