import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

let outputPath = resolve(".verify/supply-chain/sbom.spdx.json");
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument !== "--output")
    throw new Error(`Unknown SPDX SBOM option: ${argument}`);
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error("--output requires one path");
  outputPath = resolve(value);
  index += 1;
}

const npmCli = process.env.npm_execpath;
if (!npmCli)
  throw new Error("npm_execpath is required to generate the SPDX SBOM");
const result = spawnSync(
  process.execPath,
  [
    npmCli,
    "sbom",
    "--sbom-format=cyclonedx",
    "--workspaces",
    "--include-workspace-root",
    "--legacy-peer-deps",
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(
    `npm sbom failed with exit code ${result.status ?? "unknown"}: ${result.stderr.trim()}`,
  );
let cyclonedx;
try {
  cyclonedx = JSON.parse(result.stdout);
} catch {
  throw new Error("npm sbom did not return valid JSON");
}
if (
  cyclonedx?.bomFormat !== "CycloneDX" ||
  !Array.isArray(cyclonedx.components)
) {
  throw new Error(
    "npm sbom did not return a CycloneDX document with components",
  );
}

const documentNamespace = `https://github.com/nayvok/Aptiloop/releases/${process.env.RELEASE_TAG ?? "unreleased"}/sbom`;
const packageId = (component) => {
  const identity = String(
    component.purl ??
      `${component.group ?? ""}/${component.name}@${component.version ?? ""}`,
  );
  return `SPDXRef-Package-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
};
const packages = cyclonedx.components.map((component) => {
  const purl =
    typeof component.purl === "string" && component.purl.length > 0
      ? component.purl
      : "NOASSERTION";
  const packageItem = {
    SPDXID: packageId(component),
    name: String(component.name ?? "unknown"),
    versionInfo: String(component.version ?? "NOASSERTION"),
    downloadLocation: purl,
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared:
      Array.isArray(component.licenses) && component.licenses.length > 0
        ? String(
            component.licenses[0]?.license?.id ??
              component.licenses[0]?.license?.name ??
              "NOASSERTION",
          )
        : "NOASSERTION",
    copyrightText: "NOASSERTION",
    supplier: "NOASSERTION",
  };
  const sha256 = Array.isArray(component.hashes)
    ? component.hashes.find(
        (hash) => hash?.alg === "SHA-256" && typeof hash.content === "string",
      )
    : undefined;
  if (sha256)
    packageItem.checksums = [
      { algorithm: "SHA256", checksumValue: sha256.content },
    ];
  return packageItem;
});
const rootId = "SPDXRef-DOCUMENT";
const document = {
  SPDXID: rootId,
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  name: `aptiloop-${process.env.RELEASE_TAG ?? "unreleased"}`,
  documentNamespace,
  creationInfo: {
    created: new Date().toISOString(),
    creators: ["Tool: Aptiloop release workflow"],
    licenseListVersion: "3.22",
  },
  documentDescribes: packages.map((item) => item.SPDXID),
  packages,
  relationships: packages.map((item) => ({
    spdxElementId: rootId,
    relationshipType: "DESCRIBES",
    relatedSpdxElement: item.SPDXID,
  })),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`SPDX SBOM written: ${outputPath}\n`);
