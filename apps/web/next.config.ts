import { execFileSync } from "node:child_process";
import path from "node:path";
import type { NextConfig } from "next";
import { validateOrchestratorUrl } from "./orchestrator-url";

export const APTILOOP_BUILD_COMMIT_ENV = "APTILOOP_BUILD_COMMIT";

const BUILD_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const repositoryRoot = path.resolve(import.meta.dirname, "../..");

export function resolveAptiloopBuildCommit(
  environment: Readonly<Record<string, string | undefined>>,
  readRepositoryHead: () => string,
): string | null {
  const override = environment[APTILOOP_BUILD_COMMIT_ENV];
  if (override !== undefined) {
    return BUILD_COMMIT_PATTERN.test(override) ? override : null;
  }
  try {
    const repositoryHead = readRepositoryHead().trim();
    return BUILD_COMMIT_PATTERN.test(repositoryHead) ? repositoryHead : null;
  } catch {
    return null;
  }
}

const aptiloopBuildCommit = resolveAptiloopBuildCommit(process.env, () =>
  execFileSync(
    "git",
    ["-C", repositoryRoot, "rev-parse", "--verify", "HEAD^{commit}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ),
);

const orchestrator = validateOrchestratorUrl(process.env);

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  transpilePackages: ["@aptiloop/course-authoring-kit", "@aptiloop/shared"],
  env: {
    [APTILOOP_BUILD_COMMIT_ENV]: aptiloopBuildCommit ?? "",
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${orchestrator}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
