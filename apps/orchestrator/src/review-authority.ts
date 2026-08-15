import { createHash } from "node:crypto";

import { ReviewResultSchema, type ReviewResult } from "@aptiloop/shared";
import { z } from "zod";

const MAX_CANONICAL_REVIEW_BYTES = 64_000;
const MAX_SUMMARY_CHARACTERS = 4_000;
const MAX_FINDINGS = 40;
const MAX_STRENGTHS = 20;
const MAX_MASTERY_SUGGESTIONS = 20;
const MAX_NARRATIVE_CHARACTERS = 2_000;

export type ReviewAuthorityStatus = "accepted";

export class ReviewSemanticValidationError extends Error {
  constructor() {
    super("Reviewer result failed semantic validation");
    this.name = "ReviewSemanticValidationError";
  }
}

interface ChangedFileEvidence {
  readonly path: string;
  readonly visibleTargetLineRanges: readonly {
    readonly start: number;
    readonly end: number;
  }[];
}

export function validateReviewResultAgainstEvidence(
  result: ReviewResult,
  input: {
    readonly diff: string;
    readonly approvedTopicIds: readonly string[];
  },
): {
  readonly result: ReviewResult;
  readonly authorityStatus: ReviewAuthorityStatus;
} {
  const canonical = JSON.stringify(result);
  const changedFiles = changedFileEvidence(input.diff);
  const approvedTopicIds = new Set(input.approvedTopicIds);
  const actionableFindings = result.findings.filter(
    (finding) => finding.severity === "warning" || finding.severity === "error",
  );

  if (
    Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_REVIEW_BYTES ||
    result.summary.length > MAX_SUMMARY_CHARACTERS ||
    result.findings.length > MAX_FINDINGS ||
    result.strengths.length > MAX_STRENGTHS ||
    result.suggestedMasteryChanges.length > MAX_MASTERY_SUGGESTIONS ||
    result.strengths.some(
      (strength) => strength.length > MAX_NARRATIVE_CHARACTERS,
    ) ||
    result.findings.some(
      (finding) => finding.message.length > MAX_NARRATIVE_CHARACTERS,
    ) ||
    result.suggestedMasteryChanges.some(
      (suggestion) =>
        suggestion.reason.length > MAX_NARRATIVE_CHARACTERS ||
        suggestion.evidence.length > MAX_NARRATIVE_CHARACTERS,
    ) ||
    (result.status === "passed" && actionableFindings.length > 0) ||
    (result.status === "changes_requested" && actionableFindings.length === 0)
  ) {
    throw new ReviewSemanticValidationError();
  }

  for (const finding of result.findings) {
    if (finding.line !== undefined && finding.file === undefined) {
      throw new ReviewSemanticValidationError();
    }
    if (finding.file === undefined) continue;
    const normalizedPath = normalizeEvidencePath(finding.file);
    const changedFile = changedFiles.get(normalizedPath);
    if (!changedFile) throw new ReviewSemanticValidationError();
    if (
      finding.line !== undefined &&
      !changedFile.visibleTargetLineRanges.some(
        (range) => finding.line! >= range.start && finding.line! <= range.end,
      )
    ) {
      throw new ReviewSemanticValidationError();
    }
  }

  for (const suggestion of result.suggestedMasteryChanges) {
    if (!approvedTopicIds.has(suggestion.topicId)) {
      throw new ReviewSemanticValidationError();
    }
  }

  return {
    result,
    authorityStatus: "accepted",
  };
}

const persistedEvidenceBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("apt.review-evidence.v1"),
    exercise: z
      .object({
        approvedTopicIds: z.array(z.string().min(1)),
      })
      .passthrough(),
    workspace: z
      .object({
        inputSnapshotHash: z.string().min(1),
      })
      .passthrough(),
    evidence: z
      .object({
        gitDiff: z.string().min(1),
        diffTruncated: z.literal(false),
        trustedCheck: z
          .object({
            operationId: z.string().min(1),
            checkId: z.string().min(1),
            environmentId: z.string().min(1),
            environmentPackDigest: z.string().min(1),
            backendId: z.string().min(1),
            inputSnapshotHash: z.string().min(1),
            status: z.literal("passed"),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export interface PersistedReviewAuthorityBinding {
  readonly reviewStatus: string;
  readonly resultJson: string;
  readonly bundleSha256: string | null;
  readonly bundleJson: string | null;
  readonly bundleTestRunId: string | null;
  readonly bundleWorkspaceSnapshotHash: string | null;
  readonly bundleDiffFingerprint: string | null;
  readonly testRunId: string | null;
  readonly testOperationId: string | null;
  readonly testStatus: string | null;
  readonly testCheckId: string | null;
  readonly testEnvironmentId: string | null;
  readonly testEnvironmentPackDigest: string | null;
  readonly testBackendId: string | null;
  readonly testInputSnapshotHash: string | null;
  readonly testDiffFingerprint: string | null;
  readonly testDiffTruncated: number | null;
}

export function hasAuthoritativeAcceptedReview(
  input: PersistedReviewAuthorityBinding,
): boolean {
  if (
    input.reviewStatus !== "accepted" ||
    input.bundleSha256 === null ||
    input.bundleJson === null ||
    input.bundleTestRunId === null ||
    input.bundleWorkspaceSnapshotHash === null ||
    input.bundleDiffFingerprint === null ||
    input.testRunId === null ||
    input.testOperationId === null ||
    input.testStatus !== "passed" ||
    input.testCheckId === null ||
    input.testEnvironmentId === null ||
    input.testEnvironmentPackDigest === null ||
    input.testBackendId === null ||
    input.testInputSnapshotHash === null ||
    input.testDiffFingerprint === null ||
    input.testDiffTruncated !== 0
  ) {
    return false;
  }

  const result = ReviewResultSchema.safeParse(parseJson(input.resultJson));
  const bundle = persistedEvidenceBundleSchema.safeParse(
    parseJson(input.bundleJson),
  );
  if (!result.success || !bundle.success) {
    return false;
  }
  try {
    validateReviewResultAgainstEvidence(result.data, {
      diff: bundle.data.evidence.gitDiff,
      approvedTopicIds: bundle.data.exercise.approvedTopicIds,
    });
  } catch {
    return false;
  }
  const expectedBundleSha256 = `sha256:${createHash("sha256")
    .update(input.bundleJson, "utf8")
    .digest("hex")}`;
  const trustedCheck = bundle.data.evidence.trustedCheck;
  return (
    input.bundleSha256 === expectedBundleSha256 &&
    input.bundleTestRunId === input.testRunId &&
    input.bundleWorkspaceSnapshotHash === input.testInputSnapshotHash &&
    input.bundleDiffFingerprint === input.testDiffFingerprint &&
    bundle.data.workspace.inputSnapshotHash === input.testInputSnapshotHash &&
    trustedCheck.operationId === input.testOperationId &&
    trustedCheck.checkId === input.testCheckId &&
    trustedCheck.environmentId === input.testEnvironmentId &&
    trustedCheck.environmentPackDigest === input.testEnvironmentPackDigest &&
    trustedCheck.backendId === input.testBackendId &&
    trustedCheck.inputSnapshotHash === input.testInputSnapshotHash
  );
}

function changedFileEvidence(
  diff: string,
): ReadonlyMap<string, ChangedFileEvidence> {
  const files = new Map<string, ChangedFileEvidence>();
  let current: {
    path: string;
    ranges: Array<{ start: number; end: number }>;
  } | null = null;
  const flushCurrent = () => {
    if (!current) return;
    if (files.has(current.path)) throw new ReviewSemanticValidationError();
    files.set(current.path, {
      path: current.path,
      visibleTargetLineRanges: current.ranges,
    });
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      flushCurrent();
      const path = diffHeaderPath(line.slice(4));
      current = path ? { path, ranges: [] } : null;
      continue;
    }
    if (!current || !line.startsWith("@@ ")) continue;
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) throw new ReviewSemanticValidationError();
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) current.ranges.push({ start, end: start + count - 1 });
  }
  flushCurrent();
  if (files.size === 0) throw new ReviewSemanticValidationError();
  return files;
}

function diffHeaderPath(raw: string): string | null {
  if (raw === "/dev/null") return null;
  const decoded = raw.startsWith('"') ? parseQuotedPath(raw) : raw;
  const withoutPrefix = decoded.startsWith("b/") ? decoded.slice(2) : decoded;
  return normalizeEvidencePath(withoutPrefix);
}

function parseQuotedPath(value: string): string {
  if (value.length < 2 || !value.endsWith('"')) {
    throw new ReviewSemanticValidationError();
  }
  const bytes: number[] = [];
  const appendText = (text: string) => {
    bytes.push(...new TextEncoder().encode(text));
  };
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index]!;
    if (character !== "\\") {
      appendText(character);
      continue;
    }
    index += 1;
    const escaped = value[index];
    if (escaped === undefined || index >= value.length - 1) {
      throw new ReviewSemanticValidationError();
    }
    const simpleEscape: Readonly<Record<string, string>> = {
      '"': '"',
      "\\": "\\",
      a: "\u0007",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\u000b",
    };
    const decoded = simpleEscape[escaped];
    if (decoded !== undefined) {
      appendText(decoded);
      continue;
    }
    if (!/[0-7]/u.test(escaped)) throw new ReviewSemanticValidationError();
    let octal = escaped;
    while (
      octal.length < 3 &&
      index + 1 < value.length - 1 &&
      /[0-7]/u.test(value[index + 1]!)
    ) {
      index += 1;
      octal += value[index]!;
    }
    bytes.push(Number.parseInt(octal, 8));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    throw new ReviewSemanticValidationError();
  }
}

function normalizeEvidencePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    normalized.length === 0 ||
    normalized.length > 500 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new ReviewSemanticValidationError();
  }
  return normalized;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
