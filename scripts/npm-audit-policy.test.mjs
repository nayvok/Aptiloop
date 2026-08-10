import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifyNpmAuditReports,
  parseNpmAuditReport,
  runNpmAuditCommand,
} from "./npm-audit-policy.mjs";

function readFixture(name) {
  return readFile(
    new URL(`./fixtures/npm-audit-policy/${name}`, import.meta.url),
    "utf8",
  );
}

const invalidHighMetadataCases = [
  [
    "missing",
    "production-high-metadata-missing.json",
    /metadata\.vulnerabilities\.high is required/u,
  ],
  [
    "zero",
    "production-high-metadata-zero.json",
    /metadata\.vulnerabilities\.high contradicts the vulnerability objects/u,
  ],
  [
    "string",
    "production-high-metadata-string.json",
    /metadata\.vulnerabilities\.high must be a non-negative safe integer/u,
  ],
  [
    "negative",
    "production-high-metadata-negative.json",
    /metadata\.vulnerabilities\.high must be a non-negative safe integer/u,
  ],
];

for (const invalidCase of invalidHighMetadataCases) {
  const [description, fixtureName, expectedError] = invalidCase;
  test(`rejects ${description} production high metadata`, async () => {
    const [fullJson, productionJson] = await Promise.all([
      readFixture("valid-full-high.json"),
      readFixture(fixtureName),
    ]);

    assert.throws(
      () => classifyNpmAuditReports(fullJson, productionJson),
      expectedError,
    );
  });
}

test("rejects contradictory critical and total metadata", async () => {
  const [fullJson, productionJson] = await Promise.all([
    readFixture("valid-full-critical.json"),
    readFixture("production-critical-total-inconsistent.json"),
  ]);

  assert.throws(
    () => classifyNpmAuditReports(fullJson, productionJson),
    /metadata\.vulnerabilities\.total must equal the sum of severity counts/u,
  );
});

test("rejects unsupported and truncated audit JSON", async () => {
  const [unsupportedJson, truncatedJson] = await Promise.all([
    readFixture("unsupported-version.json"),
    readFixture("truncated.txt"),
  ]);

  assert.throws(
    () => parseNpmAuditReport(unsupportedJson),
    /unsupported auditReportVersion/u,
  );
  assert.throws(() => parseNpmAuditReport(truncatedJson), /is not valid JSON/u);
});

test("rejects unsuccessful audit subprocess outcomes", async () => {
  const validZeroJson = await readFixture("valid-production-zero.json");
  const rejectedOutcomes = [
    {
      label: "exit status 2",
      status: 2,
      signal: null,
      expectedError: /unsupported exit status 2/u,
    },
    {
      label: "null exit status",
      status: null,
      signal: null,
      expectedError: /did not return an exit status/u,
    },
    {
      label: "signal termination",
      status: null,
      signal: "SIGTERM",
      expectedError: /terminated by a signal/u,
    },
  ];

  for (const outcome of rejectedOutcomes) {
    const persisted = [];
    const invoke = () =>
      runNpmAuditCommand({
        auditArguments: ["audit", "--json"],
        outputPath: "fixture-audit.json",
        execute: () => ({
          status: outcome.status,
          signal: outcome.signal,
          stdout: validZeroJson,
          stderr: "private registry diagnostic",
        }),
        persistRawReport(outputPath, contents, encoding) {
          persisted.push({ outputPath, contents, encoding });
        },
      });

    assert.throws(
      invoke,
      (error) => {
        assert.match(error.message, outcome.expectedError, outcome.label);
        assert.doesNotMatch(error.message, /private registry diagnostic/u);
        return true;
      },
      outcome.label,
    );
    assert.deepEqual(persisted, [
      {
        outputPath: "fixture-audit.json",
        contents: validZeroJson,
        encoding: "utf8",
      },
    ]);
  }
});

test("accepts npm audit exit statuses zero and one", async () => {
  const [validZeroJson, validHighJson] = await Promise.all([
    readFixture("valid-production-zero.json"),
    readFixture("valid-production-high.json"),
  ]);

  for (const [status, stdout] of [
    [0, validZeroJson],
    [1, validHighJson],
  ]) {
    const output = runNpmAuditCommand({
      auditArguments: ["audit", "--json"],
      outputPath: "fixture-audit.json",
      execute: () => ({ status, signal: null, stdout }),
      persistRawReport: () => undefined,
    });

    assert.equal(output, stdout);
  }
});

test("invokes npm directly without package-script indirection", async () => {
  const validZeroJson = await readFixture("valid-production-zero.json");
  let invocation;

  runNpmAuditCommand({
    auditArguments: ["audit", "--json"],
    outputPath: "fixture-audit.json",
    execute(command, arguments_, options) {
      invocation = { command, arguments_, options };
      return { status: 0, signal: null, stdout: validZeroJson };
    },
    persistRawReport: () => undefined,
  });

  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.arguments_[0], /npm-cli\.js$/u);
  assert.deepEqual(invocation.arguments_.slice(1), ["audit", "--json"]);
  assert.equal(invocation.options.shell, false);
});

test("rejects unknown vulnerability severity", async () => {
  const [fullJson, productionJson] = await Promise.all([
    readFixture("valid-full-high.json"),
    readFixture("production-unknown-severity.json"),
  ]);

  assert.throws(
    () => classifyNpmAuditReports(fullJson, productionJson),
    /vulnerabilities entry 1\.severity is unsupported/u,
  );
});

test("requires safe integer dependency metadata counts", async () => {
  const [fullJson, stringCountJson, missingCountJson] = await Promise.all([
    readFixture("valid-full-dev-low.json"),
    readFixture("production-dependency-count-string.json"),
    readFixture("production-dependency-count-missing.json"),
  ]);

  assert.throws(
    () => classifyNpmAuditReports(fullJson, stringCountJson),
    /metadata\.dependencies\.prod must be a non-negative safe integer/u,
  );
  assert.throws(
    () => classifyNpmAuditReports(fullJson, missingCountJson),
    /metadata\.dependencies\.peerOptional is required/u,
  );
});

test("rejects embedded advisories above their parent severity", async () => {
  const [highViaJson, criticalViaJson] = await Promise.all([
    readFixture("invalid-low-parent-high-via.json"),
    readFixture("invalid-low-parent-critical-via.json"),
  ]);

  for (const report of [highViaJson, criticalViaJson]) {
    assert.throws(
      () => parseNpmAuditReport(report),
      /severity exceeds its parent vulnerability severity/u,
    );
  }
});

test("rejects missing and cyclic string via references", async () => {
  const [missingReferenceJson, cyclicReferenceJson] = await Promise.all([
    readFixture("invalid-missing-via-reference.json"),
    readFixture("invalid-cyclic-via-reference.json"),
  ]);

  assert.throws(
    () => parseNpmAuditReport(missingReferenceJson),
    /references missing vulnerability/u,
  );
  assert.throws(
    () => parseNpmAuditReport(cyclicReferenceJson),
    /cyclic vulnerability reference/u,
  );
});

test("blocks on the maximum severity resolved through string via references", async () => {
  const [fullJson, productionJson] = await Promise.all([
    readFixture("valid-full-resolved-high-reference.json"),
    readFixture("valid-production-zero.json"),
  ]);

  const summary = classifyNpmAuditReports(fullJson, productionJson);
  assert.deepEqual(summary.decision, {
    passed: false,
    blockingFindingCount: 2,
  });
  assert.deepEqual(
    summary.findings.map(({ package: packageName, severity }) => ({
      package: packageName,
      severity,
    })),
    [
      { package: "high-transitive", severity: "high" },
      { package: "low-parent", severity: "high" },
    ],
  );
  assert.equal(
    summary.findings.find(
      ({ package: packageName }) => packageName === "low-parent",
    ).advisories[0].id,
    "GHSA-REFS-HIGH-BLOCK",
  );
});

test("reports development low without blocking shipped tree", async () => {
  const [fullJson, productionJson] = await Promise.all([
    readFixture("valid-full-dev-low.json"),
    readFixture("valid-production-zero.json"),
  ]);

  assert.deepEqual(classifyNpmAuditReports(fullJson, productionJson), {
    schemaVersion: 1,
    policy: {
      scope: "shipped-installed-tree",
      blockedSeverities: ["high", "critical"],
      approvedExceptions: [],
    },
    full: {
      info: 0,
      low: 1,
      moderate: 0,
      high: 0,
      critical: 0,
      total: 1,
    },
    production: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
      total: 0,
    },
    findings: [
      {
        package: "dev-only-tool",
        severity: "low",
        scope: "dev-only",
        direct: false,
        range: "<2.0.0",
        nodes: ["node_modules/dev-only-tool"],
        advisories: [
          {
            id: "GHSA-1111-2222-3333",
            dependency: "dev-only-tool",
            severity: "low",
            url: "https://github.com/advisories/GHSA-1111-2222-3333",
          },
        ],
      },
    ],
    decision: {
      passed: true,
      blockingFindingCount: 0,
    },
  });
});

test("blocks a shipped dev high with zero production findings", async () => {
  const [fullJson, productionJson] = await Promise.all([
    readFixture("valid-full-dev-high.json"),
    readFixture("valid-production-zero.json"),
  ]);
  const summary = classifyNpmAuditReports(fullJson, productionJson);

  assert.deepEqual(summary.decision, {
    passed: false,
    blockingFindingCount: 1,
  });
  assert.equal(summary.production.total, 0);
  assert.deepEqual(
    summary.findings.map(({ scope, severity }) => ({ scope, severity })),
    [{ scope: "dev-only", severity: "high" }],
  );
});

test("reports mixed-package development residuals", async () => {
  const [fullJson, productionJson] = await Promise.all([
    readFixture("valid-full-mixed-scope.json"),
    readFixture("valid-production-mixed-scope.json"),
  ]);
  const summary = classifyNpmAuditReports(fullJson, productionJson);

  assert.deepEqual(summary.decision, {
    passed: false,
    blockingFindingCount: 1,
  });
  assert.deepEqual(summary.findings, [
    {
      package: "shared-risk",
      severity: "high",
      scope: "dev-only",
      direct: false,
      range: "<3.0.0",
      nodes: ["node_modules/dev-tool/node_modules/shared-risk"],
      advisories: [
        {
          id: "GHSA-3333-4444-5555",
          dependency: "shared-risk",
          severity: "high",
          url: "https://github.com/advisories/GHSA-3333-4444-5555",
        },
      ],
    },
    {
      package: "shared-risk",
      severity: "low",
      scope: "production",
      direct: false,
      range: "<2.0.0",
      nodes: ["node_modules/shared-risk"],
      advisories: [
        {
          id: "GHSA-2222-3333-4444",
          dependency: "shared-risk",
          severity: "low",
          url: "https://github.com/advisories/GHSA-2222-3333-4444",
        },
      ],
    },
  ]);
});

test("counts mixed production overlap once", async () => {
  const [fullJson, productionJson] = await Promise.all([
    readFixture("valid-full-mixed-high.json"),
    readFixture("valid-production-mixed-high.json"),
  ]);
  const summary = classifyNpmAuditReports(fullJson, productionJson);
  const blockingFindings = summary.findings.filter(
    ({ severity }) => severity === "high" || severity === "critical",
  );

  assert.equal(blockingFindings.length, 2);
  assert.deepEqual(
    blockingFindings.map(({ scope }) => scope),
    ["dev-only", "production"],
  );
  assert.deepEqual(summary.decision, {
    passed: false,
    blockingFindingCount: 1,
  });
});

test("blocks a valid production high vulnerability object", async () => {
  const [fullJson, productionJson] = await Promise.all([
    readFixture("valid-full-high.json"),
    readFixture("valid-production-high.json"),
  ]);

  const summary = classifyNpmAuditReports(fullJson, productionJson);

  assert.deepEqual(summary.decision, {
    passed: false,
    blockingFindingCount: 1,
  });
  assert.equal(summary.findings[0].scope, "production");
  assert.equal(summary.findings[0].severity, "high");
});
