import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ACTION_ALLOWLIST,
  analyzeWorkflow,
  evaluateWorkflowSources,
  parseRunnerWorkflowPath,
  runnerWorkflowBindingError,
  writeProvenance,
} from "./github-actions-policy.mjs";
import { classifyNpmAuditReports } from "./npm-audit-policy.mjs";
import {
  REQUIRED_EVIDENCE_FILES,
  validateSupplyChainEvidence,
} from "./supply-chain-evidence-policy.mjs";

const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const RUNNER_WORKFLOW_COMMIT = "fedcba9876543210fedcba9876543210fedcba98";
const RUNNER_WORKFLOW_PATH = ".github/workflows/ci.yml";
const REPOSITORY = "example/aptiloop";
const RUNNER_WORKFLOW_SHA256 = "a".repeat(64);
const TRUSTED_VERIFIER_DIGESTS = Object.freeze({
  "scripts/github-actions-policy.mjs": "b".repeat(64),
  "scripts/npm-audit-policy.mjs": "c".repeat(64),
  "scripts/supply-chain-evidence-policy.mjs": "d".repeat(64),
});

function step(name) {
  const action = ACTION_ALLOWLIST[name];
  const uses = `      - uses: ${name}@${action.sha} # ${action.release}`;
  if (name !== "actions/checkout") return uses;
  return `${uses}\n        with:\n          persist-credentials: false`;
}

function safeProvenance() {
  return evaluateWorkflowSources(
    [
      {
        path: RUNNER_WORKFLOW_PATH,
        content: `steps:\n${step("actions/checkout")}`,
      },
    ],
    {
      sourceCommit: SOURCE_COMMIT,
      runnerWorkflowCommit: RUNNER_WORKFLOW_COMMIT,
      runnerWorkflowPath: RUNNER_WORKFLOW_PATH,
      expectedSourceCommit: SOURCE_COMMIT,
      runnerWorkflowSha256: RUNNER_WORKFLOW_SHA256,
      trustedVerifierDigests: TRUSTED_VERIFIER_DIGESTS,
    },
  );
}

function writeSafeEvidence(directory, overrides = {}) {
  const evidenceDirectory = join(directory, "supply-chain");
  mkdirSync(evidenceDirectory, { recursive: true });
  const fullAudit = readFileSync(
    new URL(
      "./fixtures/npm-audit-policy/valid-full-dev-low.json",
      import.meta.url,
    ),
    "utf8",
  );
  const productionAudit = readFileSync(
    new URL(
      "./fixtures/npm-audit-policy/valid-production-zero.json",
      import.meta.url,
    ),
    "utf8",
  );
  const values = {
    "workflow-provenance.json": safeProvenance(),
    "npm-audit.json": JSON.parse(fullAudit),
    "npm-audit-production.json": JSON.parse(productionAudit),
    "npm-audit-summary.json": classifyNpmAuditReports(
      fullAudit,
      productionAudit,
    ),
    "sbom.cdx.json": {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      serialNumber: "urn:uuid:12345678-1234-4234-8234-123456789abc",
      version: 1,
      metadata: {},
      components: [],
      dependencies: [],
    },
    ...overrides,
  };
  for (const [fileName, value] of Object.entries(values)) {
    if (value === null) continue;
    writeFileSync(
      join(evidenceDirectory, fileName),
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
  }
  return evidenceDirectory;
}

test("accepts only the exact reviewed action SHAs and records provenance", () => {
  const source = [
    "name: fixture",
    "jobs:",
    "  policy:",
    "    steps:",
    step("actions/checkout"),
    step("actions/setup-node"),
    step("actions/upload-artifact"),
  ].join("\n");

  const report = evaluateWorkflowSources(
    [{ path: ".github/workflows/fixture.yml", content: source }],
    {
      sourceCommit: SOURCE_COMMIT,
      runnerWorkflowCommit: RUNNER_WORKFLOW_COMMIT,
      expectedSourceCommit: SOURCE_COMMIT,
    },
  );

  assert.equal(report.decision.passed, true);
  assert.equal(report.sourceCommit, SOURCE_COMMIT);
  assert.equal(report.runnerWorkflowCommit, RUNNER_WORKFLOW_COMMIT);
  assert.notEqual(report.sourceCommit, report.runnerWorkflowCommit);
  assert.deepEqual(
    report.actions.map(({ name, sha, release }) => ({ name, sha, release })),
    Object.entries(ACTION_ALLOWLIST).map(([name, action]) => ({
      name,
      sha: action.sha,
      release: action.release,
    })),
  );
});

test("records trusted verifier digests and runner workflow bytes", () => {
  const report = safeProvenance();

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.runnerWorkflowSha256, RUNNER_WORKFLOW_SHA256);
  assert.deepEqual(report.trustedVerifierDigests, TRUSTED_VERIFIER_DIGESTS);
  assert.equal(report.decision.passed, true);
});

test("fails closed when checkout and expected GitHub source commits differ", () => {
  const report = evaluateWorkflowSources(
    [{ path: ".github/workflows/fixture.yml", content: "name: fixture" }],
    {
      sourceCommit: SOURCE_COMMIT,
      runnerWorkflowCommit: RUNNER_WORKFLOW_COMMIT,
      expectedSourceCommit: RUNNER_WORKFLOW_COMMIT,
    },
  );

  assert.equal(report.sourceCommit, SOURCE_COMMIT);
  assert.equal(report.runnerWorkflowCommit, RUNNER_WORKFLOW_COMMIT);
  assert.deepEqual(report.errors, [
    "checked-out source commit does not match expected GitHub source commit",
  ]);
  assert.equal(report.decision.passed, false);
});

test("parses only this repository's exact direct runner workflow reference", () => {
  assert.equal(
    parseRunnerWorkflowPath(
      REPOSITORY,
      `${REPOSITORY}/${RUNNER_WORKFLOW_PATH}@refs/heads/main`,
    ),
    RUNNER_WORKFLOW_PATH,
  );
  for (const malformed of [
    `other/repository/${RUNNER_WORKFLOW_PATH}@refs/heads/main`,
    `${REPOSITORY}/.github/workflows/nested/ci.yml@refs/heads/main`,
    `${REPOSITORY}/${RUNNER_WORKFLOW_PATH}@main`,
    `${REPOSITORY}/${RUNNER_WORKFLOW_PATH}@refs/heads/main trailing`,
  ]) {
    assert.equal(parseRunnerWorkflowPath(REPOSITORY, malformed), null);
  }
});

test("allows the same workflow blob at distinct source and runner commits", () => {
  const content = `steps:\n${step("actions/checkout")}`;
  const sources = [{ path: RUNNER_WORKFLOW_PATH, content }];
  const report = evaluateWorkflowSources(sources, {
    sourceCommit: SOURCE_COMMIT,
    runnerWorkflowCommit: RUNNER_WORKFLOW_COMMIT,
    runnerWorkflowPath: RUNNER_WORKFLOW_PATH,
    expectedSourceCommit: SOURCE_COMMIT,
  });

  assert.notEqual(report.sourceCommit, report.runnerWorkflowCommit);
  assert.equal(
    runnerWorkflowBindingError(
      sources,
      RUNNER_WORKFLOW_PATH,
      Buffer.from(content),
    ),
    null,
  );
  assert.equal(report.decision.passed, true);
});

test("rejects unsafe runner bytes when analyzed source workflow is safe", () => {
  const safeSource = `steps:\n${step("actions/checkout")}`;
  assert.equal(
    runnerWorkflowBindingError(
      [{ path: RUNNER_WORKFLOW_PATH, content: safeSource }],
      RUNNER_WORKFLOW_PATH,
      Buffer.from("steps:\n  - uses: actions/checkout@main\n"),
    ),
    "runner workflow bytes differ from analyzed source workflow bytes",
  );
});

test("rejects differing runner bytes even when both workflows are safe", () => {
  const safeSource = `steps:\n${step("actions/checkout")}`;
  const differentSafeRunner = `steps:\n${step("actions/setup-node")}`;
  assert.equal(
    runnerWorkflowBindingError(
      [{ path: RUNNER_WORKFLOW_PATH, content: safeSource }],
      RUNNER_WORKFLOW_PATH,
      Buffer.from(differentSafeRunner),
    ),
    "runner workflow bytes differ from analyzed source workflow bytes",
  );
});

for (const mutableReference of ["v4", "main", "feature/unreviewed"]) {
  test(`rejects mutable action reference fixture @${mutableReference}`, () => {
    const result = analyzeWorkflow(
      `steps:\n  - uses: actions/checkout@${mutableReference} # fixture`,
      "mutable.yml",
    );

    assert.equal(result.actions.length, 0);
    assert.match(result.errors[0], /40-character lowercase commit SHA/);
  });
}

test("rejects a non-allowlisted SHA for an otherwise approved action", () => {
  const result = analyzeWorkflow(
    `steps:\n  - uses: actions/checkout@${"0".repeat(40)} # v4.2.2`,
    "wrong-sha.yml",
  );

  assert.deepEqual(result.errors, [
    "wrong-sha.yml:2: action actions/checkout SHA is not allowlisted",
  ]);
});

test("rejects an unreviewed action even when its reference is a full SHA", () => {
  const result = analyzeWorkflow(
    `steps:\n  - uses: third-party/action@${"1".repeat(40)} # v1.0.0`,
    "unreviewed.yml",
  );

  assert.deepEqual(result.errors, [
    "unreviewed.yml:2: action third-party/action is not allowlisted",
  ]);
});

for (const checkoutConfiguration of [
  step("actions/checkout").split("\n")[0],
  `${step("actions/checkout").split("\n")[0]}\n        with:\n          persist-credentials: true`,
  `${step("actions/checkout").split("\n")[0]}\n        with:\n          persist-credentials: "false"`,
  [
    "      credential-key: &credential_key persist-credentials",
    step("actions/checkout").split("\n")[0],
    "        with:",
    "          *credential_key: false",
  ].join("\n"),
  `${step("actions/checkout").split("\n")[0]}\n        with: { persist-credentials: false }`,
  `${step("actions/checkout").split("\n")[0]}\n        with:\n          persist-credentials: false\n        with:\n          persist-credentials: true`,
]) {
  test(`rejects unsafe checkout credential fixture ${JSON.stringify(checkoutConfiguration)}`, () => {
    const result = analyzeWorkflow(
      `steps:\n${checkoutConfiguration}`,
      "checkout-credentials.yml",
    );

    assert.ok(
      result.errors.some((error) =>
        error.endsWith(
          "actions/checkout must set persist-credentials: false in its with mapping",
        ),
      ),
    );
  });
}
test("accepts checkout configuration aligned after compact sequence spacing", () => {
  const action = ACTION_ALLOWLIST["actions/checkout"];
  const result = analyzeWorkflow(
    [
      "steps:",
      `  -   uses: actions/checkout@${action.sha} # ${action.release}`,
      "      with:",
      "        persist-credentials: false",
    ].join("\n"),
    "compact-checkout.yml",
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.actions.length, 1);
});

for (const malformedLine of [
  `  - uses: "actions/checkout@${ACTION_ALLOWLIST["actions/checkout"].sha}"`,
  `  - "uses": actions/checkout@${ACTION_ALLOWLIST["actions/checkout"].sha}`,
  `  - { uses: actions/checkout@${ACTION_ALLOWLIST["actions/checkout"].sha} }`,
  `  - uses: actions/checkout@${ACTION_ALLOWLIST["actions/checkout"].sha}`,
  `  - !!str uses: actions/checkout@${ACTION_ALLOWLIST["actions/checkout"].sha}`,
  "  ? uses",
]) {
  test(`fails closed on unsupported YAML fixture ${JSON.stringify(malformedLine)}`, () => {
    const result = analyzeWorkflow(`steps:\n${malformedLine}`, "malformed.yml");

    assert.equal(result.actions.length, 0);
    assert.equal(result.errors.length, 1);
  });
}

test("scans actions after bare carriage-return YAML line breaks", () => {
  const result = analyzeWorkflow(
    ["steps:", "  - uses: attacker/action@main"].join("\r"),
    "bare-cr.yml",
  );

  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.errors, [
    "bare-cr.yml:2: uses must be an unquoted owner/repository@40-character lowercase commit SHA followed by an inline release comment",
  ]);
});

for (const anchoredActionWorkflow of [
  "steps:\n  - &action_key uses: third-party/action@main",
  [
    "action-key: &action_key uses",
    "steps:",
    "  - *action_key: third-party/action@main",
  ].join("\n"),
]) {
  test(`rejects anchored or aliased action key fixture ${JSON.stringify(anchoredActionWorkflow)}`, () => {
    const result = analyzeWorkflow(
      anchoredActionWorkflow,
      "yaml-reference.yml",
    );

    assert.equal(result.actions.length, 0);
    assert.ok(result.errors.length >= 1);
    assert.ok(
      result.errors.every((error) =>
        error.endsWith(
          "YAML anchors and aliases are unsupported by the workflow policy",
        ),
      ),
    );
  });
}

test("ignores anchor-like text inside quoted scalars and comments", () => {
  const result = analyzeWorkflow(
    [
      'name: "literal &anchor *alias"',
      "description: 'literal &anchor *alias'",
      "# &comment_anchor *comment_alias",
      "name: safe # &trailing_anchor *trailing_alias",
    ].join("\n"),
    "quoted-references.yml",
  );

  assert.deepEqual(result, { actions: [], errors: [] });
});

for (const flowStyleWorkflow of [
  "steps: [{ uses: actions/checkout@v4 }]",
  "steps : [ { uses : actions/checkout@main } ]",
  `steps: { first: { uses: actions/checkout@${ACTION_ALLOWLIST["actions/checkout"].sha} } }`,
  "- [ { uses: actions/checkout@feature/unreviewed } ]",
  "steps: &inline [{ uses: actions/checkout@v4 }]",
  "steps: !!seq [ { uses: actions/checkout@main } ]",
]) {
  test(`rejects inline flow-style action fixture ${JSON.stringify(flowStyleWorkflow)}`, () => {
    const result = analyzeWorkflow(flowStyleWorkflow, "inline-action.yml");

    assert.equal(result.actions.length, 0);
    assert.deepEqual(result.errors, [
      "inline-action.yml:1: flow-style collections are unsupported by the workflow policy",
    ]);
  });
}

test("allows GitHub expressions while rejecting YAML flow collections", () => {
  const source = [
    "jobs:",
    "  policy:",
    "    if: ${{ github.ref == 'refs/heads/main' }}",
    "    env:",
    "      NODE_VERSIONS: ${{ fromJSON('[24]') }}",
    "    steps:",
    "      - if: ${{ always() }}",
    step("actions/checkout"),
  ].join("\n");

  const result = analyzeWorkflow(source, "expressions.yml");

  assert.deepEqual(result.errors, []);
  assert.equal(result.actions.length, 1);
});

test("does not interpret uses-like text inside a block scalar as a step", () => {
  const result = analyzeWorkflow(
    "steps:\n  - run: |\n      echo 'uses: actions/checkout@v4'\n      echo '&anchor *alias'\n  - run: echo done",
    "script.yml",
  );

  assert.deepEqual(result, { actions: [], errors: [] });
});

test("inspects sibling uses after a compact block-scalar mapping", () => {
  const result = analyzeWorkflow(
    [
      "steps:",
      "  - name: |",
      "      trusted-looking label",
      "    uses: attacker/action@main",
    ].join("\n"),
    "compact-scalar.yml",
  );

  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0]?.includes("uses must be an unquoted"));
});

test("inspects a scalar sibling after compact sequence spacing", () => {
  const result = analyzeWorkflow(
    [
      "steps:",
      "  -   name: |",
      "        uses: trusted-looking/scalar@main",
      "      uses: attacker/action@main",
    ].join("\n"),
    "compact-spacing.yml",
  );

  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.errors, [
    "compact-spacing.yml:4: uses must be an unquoted owner/repository@40-character lowercase commit SHA followed by an inline release comment",
  ]);
});

test("rejects explicit block-scalar indentation before inspecting sibling uses", () => {
  const result = analyzeWorkflow(
    [
      "jobs:",
      "  policy:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: |4",
      "            trusted-looking label",
      "        uses: attacker/action@main",
    ].join("\n"),
    "explicit-indent.yml",
  );

  assert.ok(
    result.errors.some((error) =>
      error.endsWith(
        "explicit block-scalar indentation is unsupported by the workflow policy",
      ),
    ),
  );
  assert.ok(
    result.errors.some((error) =>
      error.endsWith(
        "uses must be an unquoted owner/repository@40-character lowercase commit SHA followed by an inline release comment",
      ),
    ),
  );
});

test("does not let an inline comment start a fake block scalar", () => {
  const result = analyzeWorkflow(
    "steps:\n  - name: verify # decoy: |\n    uses: attacker/action@main",
    "comment.yml",
  );

  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0]?.includes("uses must be an unquoted"));
});

test("writes the provenance artifact before returning a failed decision", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-actions-policy-"));
  try {
    const output = join(directory, "reports", "workflow-provenance.json");
    const report = evaluateWorkflowSources(
      [
        {
          path: ".github/workflows/branch.yml",
          content: "steps:\n  - uses: actions/checkout@main # branch fixture\n",
        },
      ],
      {
        sourceCommit: SOURCE_COMMIT,
        runnerWorkflowCommit: RUNNER_WORKFLOW_COMMIT,
        expectedSourceCommit: SOURCE_COMMIT,
      },
    );
    writeProvenance(output, report);
    const artifact = JSON.parse(readFileSync(output, "utf8"));

    assert.equal(report.decision.passed, false);
    assert.deepEqual(artifact, report);
    assert.equal(artifact.sourceCommit, SOURCE_COMMIT);
    assert.equal(artifact.runnerWorkflowCommit, RUNNER_WORKFLOW_COMMIT);
    assert.equal(artifact.decision.errorCount, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts and digests all exact supply-chain evidence files", () => {
  const directory = mkdtempSync(join(tmpdir(), "supply-chain-evidence-"));
  try {
    const evidenceDirectory = writeSafeEvidence(directory);
    const result = validateSupplyChainEvidence({
      evidenceDirectory,
      expectedProvenance: safeProvenance(),
    });

    assert.deepEqual(Object.keys(result.files), REQUIRED_EVIDENCE_FILES);
    assert.ok(
      Object.values(result.files).every((digest) =>
        /^[0-9a-f]{64}$/u.test(digest),
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a wildcard decoy when an exact evidence file is missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "supply-chain-evidence-"));
  try {
    const evidenceDirectory = writeSafeEvidence(directory, {
      "npm-audit-summary.json": null,
      "npm-audit-summary-copy.json": { decision: { passed: true } },
    });

    assert.throws(
      () =>
        validateSupplyChainEvidence({
          evidenceDirectory,
          expectedProvenance: safeProvenance(),
        }),
      /npm-audit-summary\.json is required/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects forged provenance and audit summary evidence", () => {
  for (const [fileName, forgedValue, expectedError] of [
    [
      "workflow-provenance.json",
      {
        ...safeProvenance(),
        trustedVerifierDigests: {
          ...TRUSTED_VERIFIER_DIGESTS,
          "scripts/npm-audit-policy.mjs": "e".repeat(64),
        },
      },
      /does not match trusted policy recomputation/u,
    ],
    [
      "npm-audit-summary.json",
      {
        schemaVersion: 1,
        policy: {
          scope: "shipped-installed-tree",
          blockedSeverities: ["high", "critical"],
          approvedExceptions: [],
        },
        full: {
          info: 0,
          low: 0,
          moderate: 0,
          high: 0,
          critical: 0,
          total: 0,
        },
        production: {
          info: 0,
          low: 0,
          moderate: 0,
          high: 0,
          critical: 0,
          total: 0,
        },
        findings: [],
        decision: { passed: true, blockingFindingCount: 0 },
      },
      /does not match the exact audit reports/u,
    ],
  ]) {
    const directory = mkdtempSync(join(tmpdir(), "supply-chain-evidence-"));
    try {
      const evidenceDirectory = writeSafeEvidence(directory, {
        [fileName]: forgedValue,
      });
      assert.throws(
        () =>
          validateSupplyChainEvidence({
            evidenceDirectory,
            expectedProvenance: safeProvenance(),
          }),
        expectedError,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("rejects malformed audit graphs and forged SBOM evidence", () => {
  const malformedAudit = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/npm-audit-policy/invalid-low-parent-critical-via.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const [overrides, expectedError] of [
    [
      { "npm-audit.json": malformedAudit },
      /severity exceeds its parent vulnerability severity/u,
    ],
    [
      {
        "sbom.cdx.json": {
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          serialNumber: "urn:uuid:12345678-1234-4234-8234-123456789abc",
          version: 1,
          metadata: {},
        },
      },
      /not a supported CycloneDX document/u,
    ],
  ]) {
    const directory = mkdtempSync(join(tmpdir(), "supply-chain-evidence-"));
    try {
      const evidenceDirectory = writeSafeEvidence(directory, overrides);
      assert.throws(
        () =>
          validateSupplyChainEvidence({
            evidenceDirectory,
            expectedProvenance: safeProvenance(),
          }),
        expectedError,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
