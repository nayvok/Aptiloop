import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

let outputPath = resolve(".verify/supply-chain/sbom.cdx.json");
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument !== "--output") {
    throw new Error(`Unknown SBOM option: ${argument}`);
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--output requires one path");
  }
  outputPath = resolve(value);
  index += 1;
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is required to generate the npm SBOM");
}

const result = spawnSync(
  process.execPath,
  [
    npmCli,
    "sbom",
    "--sbom-format=cyclonedx",
    "--workspaces",
    "--include-workspace-root",
    // The workspace uses the Zod resolver only. npm otherwise treats an
    // unrelated optional AJV peer as an invalid installed-tree failure.
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
if (result.status !== 0) {
  const detail = result.stderr.trim();
  throw new Error(
    `npm sbom failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`,
  );
}
let sbom;
try {
  sbom = JSON.parse(result.stdout);
} catch {
  throw new Error("npm sbom did not return valid JSON");
}
if (sbom?.bomFormat !== "CycloneDX") {
  throw new Error("npm sbom did not return a CycloneDX document");
}
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
process.stdout.write(`CycloneDX SBOM written: ${outputPath}\n`);
