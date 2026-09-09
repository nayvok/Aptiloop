import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/service.ts", "src/shortcuts.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  removeNodeProtocol: false,
  sourcemap: true,
  clean: true,
  dts: true,
  outDir: "dist",
});
