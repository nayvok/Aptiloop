import { defineConfig } from "tsup";

const shared = {
  platform: "node",
  target: "node24",
  sourcemap: true,
  dts: true,
} as const;

export default defineConfig([
  {
    ...shared,
    clean: true,
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
    noExternal: [/@aptiloop\//],
    outExtension: () => ({ js: ".js" }),
  },
  {
    ...shared,
    clean: false,
    entry: {
      bootstrap: "src/bootstrap.ts",
      "runtime-cli": "src/cli.ts",
      postinstall: "src/postinstall.ts",
    },
    noExternal: [/@aptiloop\//],
    banner: { js: "#!/usr/bin/env node" },
    outExtension: () => ({ js: ".cjs" }),
  },
]);
