import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  removeNodeProtocol: false,
  sourcemap: true,
  dts: true,
  outDir: "dist",
  noExternal: [/^@dlh\//u],
});
