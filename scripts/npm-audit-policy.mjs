import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const auditReportVersion = 2;
const severities = ["info", "low", "moderate", "high", "critical"];
const severitySet = new Set(severities);
const severityRank = new Map(
  severities.map((severity, index) => [severity, index]),
);
const vulnerabilityCountKeys = [...severities, "total"];
const dependencyCountKeys = [
  "prod",
  "dev",
  "optional",
  "peer",
  "peerOptional",
  "total",
];
const blockedSeverities = new Set(["high", "critical"]);

export function parseNpmAuditReport(jsonText) {
  return parseReport(jsonText, "npm audit report");
}

export function classifyNpmAuditReports(fullJsonText, productionJsonText) {
  const full = parseReport(fullJsonText, "full npm audit report");
  const production = parseReport(
    productionJsonText,
    "production npm audit report",
  );
  const fullByPackage = new Map(
    full.vulnerabilities.map((vulnerability) => [
      vulnerability.package,
      vulnerability,
    ]),
  );

  for (const vulnerability of production.vulnerabilities) {
    const fullVulnerability = fullByPackage.get(vulnerability.package);
    if (!fullVulnerability) {
      invalidReport(
        "production npm audit report",
        "contains a vulnerability absent from the full npm audit report",
      );
    }
    if (
      severityRank.get(vulnerability.severity) >
      severityRank.get(fullVulnerability.severity)
    ) {
      invalidReport(
        "production npm audit report",
        "contains vulnerability severity not supported by the full npm audit report",
      );
    }
  }

  const productionByPackage = new Map(
    production.vulnerabilities.map((vulnerability) => [
      vulnerability.package,
      vulnerability,
    ]),
  );
  const devOnlyFindings = full.vulnerabilities
    .map((vulnerability) => {
      const productionVulnerability = productionByPackage.get(
        vulnerability.package,
      );
      const residual = productionVulnerability
        ? devOnlyResidual(vulnerability, productionVulnerability)
        : vulnerability;
      return residual ? auditFinding(residual, "dev-only") : null;
    })
    .filter((finding) => finding !== null);
  const findings = [
    ...production.vulnerabilities.map((vulnerability) =>
      auditFinding(vulnerability, "production"),
    ),
    ...devOnlyFindings,
  ].sort(
    (left, right) =>
      left.scope.localeCompare(right.scope) ||
      left.severity.localeCompare(right.severity) ||
      left.package.localeCompare(right.package),
  );
  const blockingFindingCount = full.vulnerabilities.filter((vulnerability) =>
    blockedSeverities.has(vulnerability.severity),
  ).length;

  return {
    schemaVersion: 1,
    policy: {
      scope: "shipped-installed-tree",
      blockedSeverities: ["high", "critical"],
      approvedExceptions: [],
    },
    full: full.counts,
    production: production.counts,
    findings,
    decision: {
      passed: blockingFindingCount === 0,
      blockingFindingCount,
    },
  };
}

function auditFinding(vulnerability, scope) {
  return {
    package: vulnerability.package,
    severity: vulnerability.severity,
    scope,
    direct: vulnerability.direct,
    range: vulnerability.range,
    nodes: vulnerability.nodes,
    advisories: vulnerability.advisories,
  };
}

function devOnlyResidual(full, production) {
  const productionNodes = new Set(production.nodes);
  const nodes = full.nodes.filter((node) => !productionNodes.has(node));
  const productionAdvisories = new Set(
    production.advisories.map(advisoryFingerprint),
  );
  const advisories = full.advisories.filter(
    (advisory) => !productionAdvisories.has(advisoryFingerprint(advisory)),
  );
  if (
    full.severity === production.severity &&
    full.direct === production.direct &&
    full.range === production.range &&
    nodes.length === 0 &&
    advisories.length === 0
  ) {
    return null;
  }
  return { ...full, nodes, advisories };
}

function advisoryFingerprint(advisory) {
  return JSON.stringify([
    advisory.id,
    advisory.dependency,
    advisory.severity,
    advisory.url,
  ]);
}

function runAuditPolicy() {
  const outputDirectory = parseOutputDirectory(process.argv.slice(2));

  mkdirSync(outputDirectory, { recursive: true });
  const fullJsonText = runNpmAuditCommand({
    auditArguments: ["audit", "--json"],
    outputPath: resolve(outputDirectory, "npm-audit.json"),
  });
  const productionJsonText = runNpmAuditCommand({
    auditArguments: ["audit", "--omit=dev", "--json"],
    outputPath: resolve(outputDirectory, "npm-audit-production.json"),
  });
  const summary = classifyNpmAuditReports(fullJsonText, productionJsonText);
  writeFileSync(
    resolve(outputDirectory, "npm-audit-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    `npm audit production: ${formatCounts(summary.production)}\n` +
      `npm audit full: ${formatCounts(summary.full)}\n`,
  );
  for (const finding of summary.findings) {
    const advisoryIds = finding.advisories
      .map((advisory) => advisory.id)
      .filter(Boolean)
      .join(", ");
    process.stdout.write(
      `report ${finding.scope} ${finding.severity}: ${finding.package}${advisoryIds ? ` (${advisoryIds})` : ""}\n`,
    );
  }
  if (summary.decision.blockingFindingCount > 0) {
    process.stderr.write(
      `Blocked by ${summary.decision.blockingFindingCount} shipped installed-tree high/critical npm audit finding(s); no owner exceptions are configured.\n`,
    );
    process.exitCode = 1;
  }
}

function parseOutputDirectory(arguments_) {
  let outputDirectory = resolve(".verify/supply-chain");
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--output-dir") {
      throw new Error(`Unknown audit-policy option: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--output-dir requires one path");
    }
    outputDirectory = resolve(value);
    index += 1;
  }
  return outputDirectory;
}

export function runNpmAuditCommand({
  npmExecutable = null,
  auditArguments,
  outputPath,
  execute = spawnSync,
  persistRawReport = writeFileSync,
}) {
  const command = npmExecutable ?? process.execPath;
  const commandArguments =
    npmExecutable === null
      ? [bundledNpmCliPath(), ...auditArguments]
      : auditArguments;
  let result;
  try {
    result = execute(command, commandArguments, {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
    });
  } catch {
    throw new Error("npm audit command could not be executed");
  }
  if (
    !isRecord(result) ||
    (result.error !== undefined && result.error !== null)
  ) {
    throw new Error("npm audit command could not be executed");
  }
  if (typeof result.stdout === "string") {
    persistRawReport(outputPath, result.stdout, "utf8");
  }
  if (result.signal !== null) {
    throw new Error("npm audit command terminated by a signal");
  }
  if (result.status === null) {
    throw new Error("npm audit command did not return an exit status");
  }
  if (
    !Number.isSafeInteger(result.status) ||
    result.status < 0 ||
    (result.status !== 0 && result.status !== 1)
  ) {
    const status = Number.isSafeInteger(result.status)
      ? String(result.status)
      : "invalid";
    throw new Error(
      `npm audit command returned unsupported exit status ${status}`,
    );
  }
  if (typeof result.stdout !== "string") {
    throw new Error("npm audit command did not return text output");
  }
  return result.stdout;
}

function parseReport(jsonText, reportName) {
  if (typeof jsonText !== "string") {
    invalidReport(reportName, "must be supplied as JSON text");
  }

  let report;
  try {
    report = JSON.parse(jsonText);
  } catch {
    invalidReport(reportName, "is not valid JSON");
  }
  if (!isRecord(report)) {
    invalidReport(reportName, "must be a JSON object");
  }
  if (report.auditReportVersion !== auditReportVersion) {
    invalidReport(
      reportName,
      `uses an unsupported auditReportVersion; expected ${auditReportVersion}`,
    );
  }
  if (!isRecord(report.metadata)) {
    invalidReport(reportName, "metadata must be an object");
  }
  if (!isRecord(report.vulnerabilities)) {
    invalidReport(reportName, "vulnerabilities must be an object");
  }

  const counts = readCounts(
    report.metadata.vulnerabilities,
    vulnerabilityCountKeys,
    reportName,
    "metadata.vulnerabilities",
  );
  const dependencies = readCounts(
    report.metadata.dependencies,
    dependencyCountKeys,
    reportName,
    "metadata.dependencies",
  );
  for (const category of dependencyCountKeys) {
    if (category !== "total" && dependencies[category] > dependencies.total) {
      invalidReport(
        reportName,
        `metadata.dependencies.${category} cannot exceed metadata.dependencies.total`,
      );
    }
  }

  const derivedCounts = Object.fromEntries(
    vulnerabilityCountKeys.map((key) => [key, 0]),
  );
  const unresolvedVulnerabilities = Object.entries(report.vulnerabilities).map(
    ([packageName, vulnerability], index) => {
      const normalized = normalizeVulnerability(
        packageName,
        vulnerability,
        index + 1,
        reportName,
      );
      derivedCounts[normalized.declaredSeverity] += 1;
      return normalized;
    },
  );
  const vulnerabilities = resolveVulnerabilityGraph(
    unresolvedVulnerabilities,
    reportName,
  );
  derivedCounts.total = vulnerabilities.length;

  for (const severity of severities) {
    if (counts[severity] !== derivedCounts[severity]) {
      invalidReport(
        reportName,
        `metadata.vulnerabilities.${severity} contradicts the vulnerability objects`,
      );
    }
  }
  const metadataSeverityTotal = safeIntegerSum(
    severities.map((severity) => counts[severity]),
    reportName,
  );
  if (counts.total !== metadataSeverityTotal) {
    invalidReport(
      reportName,
      "metadata.vulnerabilities.total must equal the sum of severity counts",
    );
  }
  if (counts.total !== derivedCounts.total) {
    invalidReport(
      reportName,
      "metadata.vulnerabilities.total contradicts the vulnerability objects",
    );
  }

  return {
    auditReportVersion,
    counts,
    dependencies,
    vulnerabilities,
  };
}

function readCounts(value, requiredKeys, reportName, path) {
  if (!isRecord(value)) {
    invalidReport(reportName, `${path} must be an object`);
  }
  const counts = {};
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      invalidReport(reportName, `${path}.${key} is required`);
    }
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      invalidReport(
        reportName,
        `${path}.${key} must be a non-negative safe integer`,
      );
    }
    counts[key] = value[key];
  }
  if (Object.keys(value).some((key) => !requiredKeys.includes(key))) {
    invalidReport(reportName, `${path} contains unsupported count categories`);
  }
  return counts;
}

function normalizeVulnerability(packageName, value, index, reportName) {
  const path = `vulnerabilities entry ${index}`;
  if (!packageName) {
    invalidReport(reportName, `${path} must have a non-empty package key`);
  }
  if (!isRecord(value)) {
    invalidReport(reportName, `${path} must be an object`);
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    invalidReport(reportName, `${path}.name must be a non-empty string`);
  }
  if (value.name !== packageName) {
    invalidReport(reportName, `${path}.name must match its package key`);
  }
  if (!severitySet.has(value.severity)) {
    invalidReport(reportName, `${path}.severity is unsupported`);
  }
  if (typeof value.isDirect !== "boolean") {
    invalidReport(reportName, `${path}.isDirect must be a boolean`);
  }
  if (typeof value.range !== "string" || value.range.length === 0) {
    invalidReport(reportName, `${path}.range must be a non-empty string`);
  }
  const nodes = readStringArray(value.nodes, reportName, `${path}.nodes`);
  readStringArray(value.effects, reportName, `${path}.effects`);
  const via = normalizeVia(
    value.via,
    value.severity,
    reportName,
    `${path}.via`,
  );

  return {
    package: packageName,
    path,
    declaredSeverity: value.severity,
    direct: value.isDirect,
    range: value.range,
    nodes: [...nodes].sort(),
    directAdvisories: via.advisories,
    references: via.references,
  };
}

function readStringArray(value, reportName, path) {
  if (!Array.isArray(value)) {
    invalidReport(reportName, `${path} must be an array`);
  }
  if (value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    invalidReport(reportName, `${path} must contain only non-empty strings`);
  }
  return value;
}

function normalizeVia(value, parentSeverity, reportName, path) {
  if (!Array.isArray(value)) {
    invalidReport(reportName, `${path} must be an array`);
  }
  if (value.length === 0) {
    invalidReport(reportName, `${path} must not be empty`);
  }
  const advisories = [];
  const references = [];
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path} entry ${index + 1}`;
    if (typeof entry === "string") {
      if (entry.length === 0) {
        invalidReport(reportName, `${entryPath} must not be empty`);
      }
      references.push(entry);
      continue;
    }
    if (!isRecord(entry)) {
      invalidReport(reportName, `${entryPath} has an unsupported shape`);
    }
    if (typeof entry.dependency !== "string" || entry.dependency.length === 0) {
      invalidReport(
        reportName,
        `${entryPath}.dependency must be a non-empty string`,
      );
    }
    if (!severitySet.has(entry.severity)) {
      invalidReport(reportName, `${entryPath}.severity is unsupported`);
    }
    if (severityRank.get(entry.severity) > severityRank.get(parentSeverity)) {
      invalidReport(
        reportName,
        `${entryPath}.severity exceeds its parent vulnerability severity`,
      );
    }
    if (typeof entry.url !== "string" || entry.url.length === 0) {
      invalidReport(reportName, `${entryPath}.url must be a non-empty string`);
    }
    if (
      Object.hasOwn(entry, "source") &&
      !isSupportedAdvisorySource(entry.source)
    ) {
      invalidReport(reportName, `${entryPath}.source is unsupported`);
    }
    advisories.push({
      id: advisoryId(entry),
      dependency: entry.dependency,
      severity: entry.severity,
      url: entry.url,
    });
  }
  return {
    advisories: sortAndDedupeAdvisories(advisories),
    references: [...new Set(references)].sort(),
  };
}

function resolveVulnerabilityGraph(vulnerabilities, reportName) {
  const byPackage = new Map(
    vulnerabilities.map((vulnerability) => [
      vulnerability.package,
      vulnerability,
    ]),
  );
  const states = new Map();
  const resolved = new Map();

  function visit(vulnerability) {
    const state = states.get(vulnerability.package);
    if (state === "visiting") {
      invalidReport(
        reportName,
        `${vulnerability.path}.via contains a cyclic vulnerability reference`,
      );
    }
    if (state === "resolved") return resolved.get(vulnerability.package);

    states.set(vulnerability.package, "visiting");
    let maximumSeverity = vulnerability.declaredSeverity;
    const advisories = [...vulnerability.directAdvisories];
    for (const reference of vulnerability.references) {
      const referenced = byPackage.get(reference);
      if (!referenced) {
        invalidReport(
          reportName,
          `${vulnerability.path}.via references missing vulnerability ${JSON.stringify(reference)}`,
        );
      }
      const resolvedReference = visit(referenced);
      if (
        severityRank.get(resolvedReference.severity) >
        severityRank.get(maximumSeverity)
      ) {
        maximumSeverity = resolvedReference.severity;
      }
      advisories.push(...resolvedReference.advisories);
    }

    const normalized = {
      package: vulnerability.package,
      severity: maximumSeverity,
      direct: vulnerability.direct,
      range: vulnerability.range,
      nodes: vulnerability.nodes,
      advisories: sortAndDedupeAdvisories(advisories),
    };
    states.set(vulnerability.package, "resolved");
    resolved.set(vulnerability.package, normalized);
    return normalized;
  }

  return vulnerabilities.map(visit);
}

function sortAndDedupeAdvisories(advisories) {
  return [
    ...new Map(
      advisories.map((advisory) => [advisoryFingerprint(advisory), advisory]),
    ).values(),
  ].sort((left, right) =>
    String(left.id ?? left.dependency).localeCompare(
      String(right.id ?? right.dependency),
    ),
  );
}

function isSupportedAdvisorySource(value) {
  return (
    (Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && value.length > 0)
  );
}

function advisoryId(entry) {
  const match = entry.url.match(/GHSA-[a-z0-9-]+/iu);
  if (match) return match[0].toUpperCase();
  if (Object.hasOwn(entry, "source")) return String(entry.source);
  return null;
}

function safeIntegerSum(values, reportName) {
  let total = 0;
  for (const value of values) {
    if (value > Number.MAX_SAFE_INTEGER - total) {
      invalidReport(
        reportName,
        "metadata.vulnerabilities severity counts exceed the safe integer range",
      );
    }
    total += value;
  }
  return total;
}

function bundledNpmCliPath() {
  return process.platform === "win32"
    ? resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
    : resolve(
        dirname(process.execPath),
        "../lib/node_modules/npm/bin/npm-cli.js",
      );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidReport(reportName, detail) {
  throw new Error(`${reportName}: ${detail}`);
}

function formatCounts(counts) {
  return `critical=${counts.critical}, high=${counts.high}, moderate=${counts.moderate}, low=${counts.low}, info=${counts.info}, total=${counts.total}`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runAuditPolicy();
}
