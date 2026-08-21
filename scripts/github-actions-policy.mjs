import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Reviewed commit SHAs against the official release tag refs:
// https://api.github.com/repos/actions/checkout/git/ref/tags/v4.2.2
// https://api.github.com/repos/actions/setup-node/git/ref/tags/v4.4.0
// https://api.github.com/repos/actions/upload-artifact/git/ref/tags/v4.6.2
export const ACTION_ALLOWLIST = Object.freeze({
  "actions/checkout": Object.freeze({
    sha: "11bd71901bbe5b1630ceea73d27597364c9af683",
    release: "v4.2.2",
  }),
  "actions/setup-node": Object.freeze({
    sha: "49933ea5288caeca8642d1e84afbd3f7d6820020",
    release: "v4.4.0",
  }),
  "actions/upload-artifact": Object.freeze({
    sha: "ea165f8d65b6e75b540449e92b4886f43607fa02",
    release: "v4.6.2",
  }),
});

export const TRUSTED_VERIFIER_PATHS = Object.freeze([
  "scripts/github-actions-policy.mjs",
  "scripts/npm-audit-policy.mjs",
  "scripts/supply-chain-evidence-policy.mjs",
]);

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const STRICT_USES =
  /^\s*(?:-\s+)?uses:\s+([A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9_./-]+)?)@([0-9a-f]{40})\s+#\s+([A-Za-z0-9][A-Za-z0-9._+-]*)\s*$/;
const USES_KEY = /^\s*(?:-\s*)?(?:(?:"uses"|'uses')|uses)\s*:/;
const EXPLICIT_USES_KEY = /^\s*\?\s*(?:(?:"uses"|'uses')|uses)(?:\s|$)/;
const QUOTED_MAPPING_KEY =
  /^\s*(?:-\s*)?(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:/;
const FLOW_COLLECTION_VALUE =
  /^\s*(?:(?:-\s+)?[^\s:#"'{}[\],]+\s*:\s*|-\s*|(?:---\s*)?)(?:[!&][^\s[\]{},]+\s+)*[[{]/;
const BLOCK_SCALAR = /:\s*[>|]([0-9+-]*)\s*$/;
function yamlMappingKeyIndentation(line, indentation) {
  return line.match(/^\s*-\s+/)?.[0].length ?? indentation;
}

function hasYamlAnchorOrAlias(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (character === "\\") index += 1;
      else if (character === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (character !== "'") continue;
      if (line[index + 1] === "'") index += 1;
      else quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (
      character === "#" &&
      (index === 0 || /\s/.test(line[index - 1] ?? ""))
    ) {
      return false;
    }
    if (character !== "&" && character !== "*") continue;

    const previous = line[index - 1];
    const next = line[index + 1];
    const hasBoundary = index === 0 || /[\s,[\]{}:?-]/.test(previous ?? "");
    const hasName = Boolean(next) && !/[\s,[\]{}#&*]/.test(next ?? "");
    if (hasBoundary && hasName) return true;
  }
  return false;
}
function yamlSyntaxBeforeComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (character === "\\") index += 1;
      else if (character === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (character !== "'") continue;
      if (line[index + 1] === "'") index += 1;
      else quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (
      character === "#" &&
      (index === 0 || /\s/.test(line[index - 1] ?? ""))
    ) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function checkoutDisablesCredentials(lines, usesIndex, usesIndentation) {
  let withCount = 0;
  let currentWithIsBlock = false;
  let credentialKeyCount = 0;
  let exactFalse = false;

  for (let index = usesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indentation = line.match(/^\s*/)?.[0].length ?? 0;
    if (indentation < usesIndentation) break;

    if (indentation === usesIndentation) {
      currentWithIsBlock = false;
      if (!/^\s*with\s*:/.test(line)) continue;
      withCount += 1;
      currentWithIsBlock = /^\s*with:\s*(?:#.*)?$/.test(line);
      continue;
    }
    if (!currentWithIsBlock || indentation !== usesIndentation + 2) {
      continue;
    }
    if (
      !/^\s*(?:"persist-credentials"|'persist-credentials'|persist-credentials)\s*:/.test(
        line,
      )
    ) {
      continue;
    }
    credentialKeyCount += 1;
    if (/^\s*persist-credentials:\s+false\s*(?:#.*)?$/.test(line)) {
      exactFalse = true;
    }
  }
  return withCount === 1 && credentialKeyCount === 1 && exactFalse;
}

export function analyzeWorkflow(source, workflowPath) {
  const actions = [];
  const errors = [];
  const lines = source.split(/\r\n|[\r\n]/);
  let blockScalarIndent = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const indentation = line.match(/^\s*/)?.[0].length ?? 0;

    if (blockScalarIndent !== null) {
      if (line.trim() === "" || indentation > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    const trimmed = line.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    if (USES_KEY.test(line) || EXPLICIT_USES_KEY.test(line)) {
      const match = line.match(STRICT_USES);
      if (!match) {
        errors.push(
          `${workflowPath}:${lineNumber}: uses must be an unquoted owner/repository@40-character lowercase commit SHA followed by an inline release comment`,
        );
        continue;
      }

      const [, name, sha, release] = match;
      const approved = ACTION_ALLOWLIST[name];
      if (!approved) {
        errors.push(
          `${workflowPath}:${lineNumber}: action ${name} is not allowlisted`,
        );
        continue;
      }
      if (sha !== approved.sha) {
        errors.push(
          `${workflowPath}:${lineNumber}: action ${name} SHA is not allowlisted`,
        );
        continue;
      }
      if (release !== approved.release) {
        errors.push(
          `${workflowPath}:${lineNumber}: action ${name} release comment must be ${approved.release}`,
        );
        continue;
      }
      if (
        name === "actions/checkout" &&
        !checkoutDisablesCredentials(
          lines,
          index,
          yamlMappingKeyIndentation(line, indentation),
        )
      ) {
        errors.push(
          `${workflowPath}:${lineNumber}: actions/checkout must set persist-credentials: false in its with mapping`,
        );
      }

      actions.push({
        workflow: workflowPath,
        line: lineNumber,
        name,
        sha,
        release,
      });
      continue;
    }

    if (QUOTED_MAPPING_KEY.test(line)) {
      errors.push(
        `${workflowPath}:${lineNumber}: quoted mapping keys are unsupported by the workflow policy`,
      );
      continue;
    }
    if (FLOW_COLLECTION_VALUE.test(line)) {
      errors.push(
        `${workflowPath}:${lineNumber}: flow-style collections are unsupported by the workflow policy`,
      );
      continue;
    }
    if (/^\s*\?/.test(line)) {
      errors.push(
        `${workflowPath}:${lineNumber}: explicit mapping keys are unsupported by the workflow policy`,
      );
      continue;
    }
    if (/^\s*(?:-\s*)?!/.test(line)) {
      errors.push(
        `${workflowPath}:${lineNumber}: tagged mapping nodes are unsupported by the workflow policy`,
      );
      continue;
    }
    if (hasYamlAnchorOrAlias(line)) {
      errors.push(
        `${workflowPath}:${lineNumber}: YAML anchors and aliases are unsupported by the workflow policy`,
      );
      continue;
    }
    const blockScalar = yamlSyntaxBeforeComment(line).match(BLOCK_SCALAR);
    if (blockScalar) {
      if (/\d/.test(blockScalar[1] ?? "")) {
        errors.push(
          `${workflowPath}:${lineNumber}: explicit block-scalar indentation is unsupported by the workflow policy`,
        );
      } else {
        blockScalarIndent = yamlMappingKeyIndentation(line, indentation);
      }
    }
  }

  return { actions, errors };
}

export function evaluateWorkflowSources(
  sources,
  {
    sourceCommit,
    runnerWorkflowCommit = null,
    runnerWorkflowPath = null,
    expectedSourceCommit = null,
    trustedVerifierDigests = null,
    runnerWorkflowSha256 = null,
  },
) {
  const actions = [];
  const errors = [];

  if (!COMMIT_SHA.test(sourceCommit ?? "")) {
    errors.push("source commit must be a 40-character lowercase commit SHA");
  }
  if (runnerWorkflowCommit !== null && !COMMIT_SHA.test(runnerWorkflowCommit)) {
    errors.push(
      "runner workflow commit must be a 40-character lowercase commit SHA",
    );
  }
  if (expectedSourceCommit !== null && !COMMIT_SHA.test(expectedSourceCommit)) {
    errors.push(
      "expected source commit must be a 40-character lowercase commit SHA",
    );
  } else if (
    expectedSourceCommit !== null &&
    sourceCommit !== expectedSourceCommit
  ) {
    errors.push(
      "checked-out source commit does not match expected GitHub source commit",
    );
  }
  if (sources.length === 0) {
    errors.push("no committed workflow YAML files were found");
  }

  for (const source of sources) {
    const result = analyzeWorkflow(source.content, source.path);
    actions.push(...result.actions);
    errors.push(...result.errors);
  }

  return {
    schemaVersion: 2,
    sourceCommit: COMMIT_SHA.test(sourceCommit ?? "") ? sourceCommit : null,
    runnerWorkflowCommit: COMMIT_SHA.test(runnerWorkflowCommit ?? "")
      ? runnerWorkflowCommit
      : null,
    runnerWorkflowPath,
    runnerWorkflowSha256,
    trustedVerifierDigests:
      trustedVerifierDigests === null ? null : { ...trustedVerifierDigests },
    actions,
    decision: { passed: errors.length === 0, errorCount: errors.length },
    errors,
  };
}

export function parseRunnerWorkflowPath(repository, workflowRef) {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(
      repository ?? "",
    )
  ) {
    return null;
  }
  const prefix = `${repository}/`;
  if (typeof workflowRef !== "string" || !workflowRef.startsWith(prefix)) {
    return null;
  }
  const match = workflowRef
    .slice(prefix.length)
    .match(
      /^(\.github\/workflows\/[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?\.ya?ml)@(?:refs\/(?:heads|tags|pull)\/[^\s]+|[0-9a-f]{40})$/i,
    );
  return match?.[1] ?? null;
}

export function runnerWorkflowBindingError(sources, workflowPath, runnerBytes) {
  const source = sources.find((candidate) => candidate.path === workflowPath);
  if (!source) return "runner workflow path is missing from source commit";
  const sourceBytes = source.bytes ?? Buffer.from(source.content, "utf8");
  if (!sourceBytes.equals(runnerBytes)) {
    return "runner workflow bytes differ from analyzed source workflow bytes";
  }
  return null;
}

export function runPolicy({
  sourceCommit,
  runnerWorkflowCommit = null,
  runnerWorkflowRef = null,
  repository = null,
  expectedSourceCommit = null,
  trustedPolicyRoot,
  outputPath,
}) {
  const runnerWorkflowPath = parseRunnerWorkflowPath(
    repository,
    runnerWorkflowRef,
  );
  let sources = [];
  let sourceReadFailed = false;
  try {
    sources = loadCommittedWorkflowSources(sourceCommit);
  } catch {
    sourceReadFailed = true;
  }

  let trustedPolicy = null;
  if (
    runnerWorkflowPath !== null &&
    COMMIT_SHA.test(runnerWorkflowCommit ?? "")
  ) {
    try {
      trustedPolicy = inspectTrustedPolicyCheckout(
        trustedPolicyRoot,
        runnerWorkflowCommit,
        runnerWorkflowPath,
      );
    } catch {
      trustedPolicy = null;
    }
  }

  const report = evaluateWorkflowSources(sources, {
    sourceCommit,
    runnerWorkflowCommit,
    runnerWorkflowPath,
    expectedSourceCommit,
    trustedVerifierDigests: trustedPolicy?.trustedVerifierDigests ?? null,
    runnerWorkflowSha256: trustedPolicy?.runnerWorkflowSha256 ?? null,
  });
  if (sourceReadFailed) {
    addReportError(
      report,
      "committed workflow YAML could not be read as regular Git blobs",
    );
  }
  if (!runnerWorkflowPath) {
    addReportError(
      report,
      "runner workflow reference must identify this repository's direct workflow YAML",
    );
  } else if (COMMIT_SHA.test(runnerWorkflowCommit ?? "")) {
    if (!trustedPolicy) {
      addReportError(
        report,
        "trusted policy checkout does not match the runner workflow commit",
      );
    } else {
      const bindingError = runnerWorkflowBindingError(
        sources,
        runnerWorkflowPath,
        trustedPolicy.runnerWorkflowBytes,
      );
      if (bindingError) addReportError(report, bindingError);
    }
  }
  if (!sourceReadFailed && !workingTreeMatchesCommittedWorkflows(sources)) {
    addReportError(
      report,
      "working-tree workflow YAML differs from the attributed source commit",
    );
  }
  if (outputPath !== null) writeProvenance(outputPath, report);
  return report;
}

function addReportError(report, error) {
  report.errors.push(error);
  report.decision.passed = false;
  report.decision.errorCount = report.errors.length;
}

export function writeProvenance(outputPath, report) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function loadCommittedWorkflowSources(sourceCommit) {
  if (!COMMIT_SHA.test(sourceCommit ?? "")) {
    throw new Error("source commit is invalid");
  }
  const listing = decodeGitOutput(
    gitOutput([
      "ls-tree",
      "-rz",
      "--full-tree",
      sourceCommit,
      "--",
      ".github/workflows",
    ]),
  );
  const sources = [];

  for (const entry of listing.split("\0")) {
    if (entry === "") continue;
    const match = entry.match(/^(\d{6}) (blob|tree) ([0-9a-f]+)\t([\s\S]+)$/);
    if (!match) throw new Error("Git returned malformed workflow metadata");
    const [, mode, type, objectSha, path] = match;
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) continue;
    if ((mode !== "100644" && mode !== "100755") || type !== "blob") {
      throw new Error("workflow YAML is not a regular Git blob");
    }
    const bytes = gitOutput(["cat-file", "blob", objectSha]);
    sources.push({
      path,
      bytes,
      content: decodeGitOutput(bytes),
    });
  }
  return sources.sort((left, right) => left.path.localeCompare(right.path));
}

export function inspectTrustedPolicyCheckout(
  trustedPolicyRoot,
  commit,
  runnerWorkflowPath,
) {
  if (
    typeof trustedPolicyRoot !== "string" ||
    trustedPolicyRoot.length === 0 ||
    !COMMIT_SHA.test(commit ?? "") ||
    typeof runnerWorkflowPath !== "string"
  ) {
    throw new Error("trusted policy checkout attribution is invalid");
  }
  const root = resolve(trustedPolicyRoot);
  const checkedOutCommit = decodeGitOutput(
    gitOutput(["rev-parse", "--verify", "HEAD^{commit}"], root),
  ).trim();
  if (checkedOutCommit !== commit) {
    throw new Error("trusted policy checkout commit does not match");
  }

  const trustedPaths = [...TRUSTED_VERIFIER_PATHS, runnerWorkflowPath];
  const status = gitOutput(
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...trustedPaths,
    ],
    root,
  );
  if (status.length !== 0) {
    throw new Error("trusted policy checkout files differ from their commit");
  }

  const committedBytes = new Map();
  for (const path of trustedPaths) {
    const bytes = loadRegularCommittedBlob(root, commit, path);
    const workingPath = resolve(root, path);
    const metadata = lstatSync(workingPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("trusted policy path is not a regular file");
    }
    if (!readFileSync(workingPath).equals(bytes)) {
      throw new Error("trusted policy working bytes differ from their commit");
    }
    committedBytes.set(path, bytes);
  }

  return {
    trustedVerifierDigests: Object.fromEntries(
      TRUSTED_VERIFIER_PATHS.map((path) => [
        path,
        sha256(committedBytes.get(path)),
      ]),
    ),
    runnerWorkflowSha256: sha256(committedBytes.get(runnerWorkflowPath)),
    runnerWorkflowBytes: committedBytes.get(runnerWorkflowPath),
  };
}

function loadRegularCommittedBlob(repositoryRoot, commit, path) {
  const listing = decodeGitOutput(
    gitOutput(
      ["ls-tree", "-z", "--full-tree", commit, "--", path],
      repositoryRoot,
    ),
  );
  const entries = listing.split("\0").filter(Boolean);
  const match =
    entries.length === 1
      ? entries[0].match(/^(\d{6}) (blob|tree) ([0-9a-f]+)\t([\s\S]+)$/)
      : null;
  if (!match || match[4] !== path) {
    throw new Error("trusted policy path is missing from its commit");
  }
  const [, mode, type, objectSha] = match;
  if ((mode !== "100644" && mode !== "100755") || type !== "blob") {
    throw new Error("trusted policy path is not a regular Git blob");
  }
  return gitOutput(["cat-file", "blob", objectSha], repositoryRoot);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function workingTreeMatchesCommittedWorkflows(sources) {
  const status = gitOutput([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".github/workflows",
  ]);
  if (status.length !== 0) return false;

  try {
    const directory = resolve(".github/workflows");
    const workingPaths = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => /\.ya?ml$/i.test(entry.name))
      .map((entry) => {
        const path = resolve(directory, entry.name);
        if (!entry.isFile() || lstatSync(path).isSymbolicLink()) {
          throw new Error("workflow YAML is not a regular working-tree file");
        }
        return `.github/workflows/${entry.name}`;
      })
      .sort();
    const committedPaths = sources.map((source) => source.path).sort();
    return (
      workingPaths.length === committedPaths.length &&
      workingPaths.every((path, index) => path === committedPaths[index])
    );
  } catch {
    return false;
  }
}

function gitOutput(arguments_, cwd = process.cwd()) {
  const result = spawnSync("git", arguments_, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error("Git could not read committed workflow data");
  }
  return result.stdout;
}

function decodeGitOutput(output) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    throw new Error("committed workflow data is not valid UTF-8");
  }
}

function repositoryCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function parseArguments(arguments_) {
  const options = {
    outputPath: resolve(".verify/supply-chain/workflow-provenance.json"),
    sourceCommit: repositoryCommit(),
    runnerWorkflowCommit: process.env.GITHUB_WORKFLOW_SHA ?? null,
    runnerWorkflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    expectedSourceCommit: process.env.GITHUB_SHA ?? null,
    trustedPolicyRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires one value`);
    }
    if (argument === "--output") {
      options.outputPath = resolve(value);
    } else if (argument === "--expected-source-commit") {
      options.expectedSourceCommit = value;
    } else if (argument === "--runner-workflow-commit") {
      options.runnerWorkflowCommit = value;
    } else if (argument === "--runner-workflow-ref") {
      options.runnerWorkflowRef = value;
    } else if (argument === "--repository") {
      options.repository = value;
    } else if (argument === "--trusted-policy-root") {
      options.trustedPolicyRoot = resolve(value);
    } else {
      throw new Error(`Unknown workflow-policy option: ${argument}`);
    }
    index += 1;
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const report = runPolicy(options);
  if (!report.decision.passed) {
    for (const error of report.errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Verified ${report.actions.length} pinned GitHub Action reference(s).\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
