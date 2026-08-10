import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { classifyNpmAuditReports } from "./npm-audit-policy.mjs";
import { runPolicy, TRUSTED_VERIFIER_PATHS } from "./github-actions-policy.mjs";

export const REQUIRED_EVIDENCE_FILES = Object.freeze([
  "workflow-provenance.json",
  "npm-audit.json",
  "npm-audit-production.json",
  "npm-audit-summary.json",
  "sbom.cdx.json",
]);

const maximumEvidenceBytes = 64 * 1024 * 1024;
const commitSha = /^[0-9a-f]{40}$/u;
const sha256Digest = /^[0-9a-f]{64}$/u;

export function validateSupplyChainEvidence({
  evidenceDirectory,
  expectedProvenance,
}) {
  if (typeof evidenceDirectory !== "string" || evidenceDirectory.length === 0) {
    throw new Error("evidence directory is required");
  }
  if (!isRecord(expectedProvenance)) {
    throw new Error("trusted workflow provenance recomputation is required");
  }
  const resolvedEvidenceDirectory = resolve(evidenceDirectory);
  let directoryMetadata;
  try {
    directoryMetadata = lstatSync(resolvedEvidenceDirectory);
  } catch {
    throw new Error("evidence directory is required");
  }
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error("evidence directory must be a regular directory");
  }

  const evidence = Object.fromEntries(
    REQUIRED_EVIDENCE_FILES.map((fileName) => [
      fileName,
      readExactEvidenceFile(resolvedEvidenceDirectory, fileName),
    ]),
  );
  const provenance = parseJsonObject(
    evidence["workflow-provenance.json"].text,
    "workflow-provenance.json",
  );
  validateProvenanceShape(provenance);
  if (!isDeepStrictEqual(provenance, expectedProvenance)) {
    throw new Error(
      "workflow-provenance.json does not match trusted policy recomputation",
    );
  }

  const fullAuditText = evidence["npm-audit.json"].text;
  const productionAuditText = evidence["npm-audit-production.json"].text;
  const recomputedSummary = classifyNpmAuditReports(
    fullAuditText,
    productionAuditText,
  );
  const suppliedSummary = parseJsonObject(
    evidence["npm-audit-summary.json"].text,
    "npm-audit-summary.json",
  );
  if (!isDeepStrictEqual(suppliedSummary, recomputedSummary)) {
    throw new Error(
      "npm-audit-summary.json does not match the exact audit reports",
    );
  }

  const sbom = parseJsonObject(evidence["sbom.cdx.json"].text, "sbom.cdx.json");
  validateCycloneDxSbom(sbom);

  return {
    files: Object.fromEntries(
      REQUIRED_EVIDENCE_FILES.map((fileName) => [
        fileName,
        sha256(evidence[fileName].bytes),
      ]),
    ),
  };
}

function readExactEvidenceFile(evidenceDirectory, fileName) {
  const path = resolve(evidenceDirectory, fileName);
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    throw new Error(`${fileName} is required`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${fileName} must be a regular file`);
  }
  if (metadata.size === 0 || metadata.size > maximumEvidenceBytes) {
    throw new Error(`${fileName} has an unsupported size`);
  }

  const bytes = readFileSync(path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${fileName} is not valid UTF-8`);
  }
  return { bytes, text };
}

function parseJsonObject(text, fileName) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${fileName} is not valid JSON`);
  }
  if (!isRecord(value)) {
    throw new Error(`${fileName} must contain a JSON object`);
  }
  return value;
}

function validateProvenanceShape(provenance) {
  if (
    provenance.schemaVersion !== 2 ||
    !commitSha.test(provenance.sourceCommit ?? "") ||
    !commitSha.test(provenance.runnerWorkflowCommit ?? "") ||
    typeof provenance.runnerWorkflowPath !== "string" ||
    !sha256Digest.test(provenance.runnerWorkflowSha256 ?? "") ||
    !isRecord(provenance.trustedVerifierDigests) ||
    !Array.isArray(provenance.actions) ||
    !Array.isArray(provenance.errors) ||
    !isRecord(provenance.decision)
  ) {
    throw new Error("workflow-provenance.json has an unsupported shape");
  }
  const verifierPaths = Object.keys(provenance.trustedVerifierDigests);
  if (
    verifierPaths.length !== TRUSTED_VERIFIER_PATHS.length ||
    TRUSTED_VERIFIER_PATHS.some(
      (path) => !Object.hasOwn(provenance.trustedVerifierDigests, path),
    ) ||
    Object.values(provenance.trustedVerifierDigests).some(
      (digest) => typeof digest !== "string" || !sha256Digest.test(digest),
    ) ||
    provenance.errors.some((error) => typeof error !== "string") ||
    typeof provenance.decision.passed !== "boolean" ||
    !Number.isSafeInteger(provenance.decision.errorCount) ||
    provenance.decision.errorCount !== provenance.errors.length ||
    provenance.decision.passed !== (provenance.errors.length === 0)
  ) {
    throw new Error("workflow-provenance.json is internally inconsistent");
  }
}

function validateCycloneDxSbom(sbom) {
  if (
    sbom.bomFormat !== "CycloneDX" ||
    typeof sbom.specVersion !== "string" ||
    !/^1\.[0-9]+$/u.test(sbom.specVersion) ||
    typeof sbom.serialNumber !== "string" ||
    !/^urn:uuid:[0-9a-f-]{36}$/iu.test(sbom.serialNumber) ||
    !Number.isSafeInteger(sbom.version) ||
    sbom.version < 1 ||
    !isRecord(sbom.metadata) ||
    !Array.isArray(sbom.components) ||
    !Array.isArray(sbom.dependencies)
  ) {
    throw new Error("sbom.cdx.json is not a supported CycloneDX document");
  }
}

function parseArguments(arguments_) {
  const options = {
    evidenceDirectory: resolve(".verify/supply-chain"),
    expectedSourceCommit: process.env.GITHUB_SHA ?? null,
    runnerWorkflowCommit: process.env.GITHUB_WORKFLOW_SHA ?? null,
    runnerWorkflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    trustedPolicyRoot: resolve(fileURLToPath(new URL("..", import.meta.url))),
  };
  const names = new Map([
    ["--evidence-dir", "evidenceDirectory"],
    ["--expected-source-commit", "expectedSourceCommit"],
    ["--runner-workflow-commit", "runnerWorkflowCommit"],
    ["--runner-workflow-ref", "runnerWorkflowRef"],
    ["--repository", "repository"],
    ["--trusted-policy-root", "trustedPolicyRoot"],
  ]);

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const option = names.get(argument);
    if (!option) throw new Error(`Unknown evidence-policy option: ${argument}`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires one value`);
    }
    options[option] =
      option === "evidenceDirectory" || option === "trustedPolicyRoot"
        ? resolve(value)
        : value;
    index += 1;
  }
  return options;
}

function repositoryCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error("source checkout commit could not be read");
  }
  return result.stdout.trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const expectedProvenance = runPolicy({
    sourceCommit: repositoryCommit(),
    runnerWorkflowCommit: options.runnerWorkflowCommit,
    runnerWorkflowRef: options.runnerWorkflowRef,
    repository: options.repository,
    expectedSourceCommit: options.expectedSourceCommit,
    trustedPolicyRoot: options.trustedPolicyRoot,
    outputPath: null,
  });
  const result = validateSupplyChainEvidence({
    evidenceDirectory: options.evidenceDirectory,
    expectedProvenance,
  });
  for (const fileName of REQUIRED_EVIDENCE_FILES) {
    process.stdout.write(
      `Verified ${fileName} sha256=${result.files[fileName]}\n`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
