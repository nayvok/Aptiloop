import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
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
  sourcemap: process.env.NODE_ENV !== "production",
  outDir: "dist",
  noExternal: [/^@aptiloop\//u],
});
