import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  removeNodeProtocol: false,
  sourcemap: true,
  clean: true,
  dts: true,
  outDir: "dist",
  noExternal: [/^@aptiloop\//u],
});
