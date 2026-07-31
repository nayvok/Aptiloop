import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  transpilePackages: ["@dlh/shared"],
  async rewrites() {
    const orchestrator =
      process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:8787";
    return [
      {
        source: "/api/:path*",
        destination: `${orchestrator}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
