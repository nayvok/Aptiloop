import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  external: [
    "node:sqlite",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@opencode-ai/sdk",
  ],
  removeNodeProtocol: false,
  sourcemap: true,
  outDir: "dist",
  noExternal: [/^@dlh\//u],
});
