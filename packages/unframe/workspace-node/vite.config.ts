import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [
        /^@unframe-dev\/(?:artifacts|contracts)(?:\/|$)/,
        /^@noble\/hashes(?:\/|$)/,
        "canonicalize",
      ],
      neverBundle: [
        /^@unframe-dev\/(?:workspace|build)(?:\/|$)/,
        /^zod(?:\/|$)/,
        "yaml",
        "typescript",
      ],
      onlyBundle: false,
      onlyImport: ["@unframe-dev/workspace", "@unframe-dev/build", "zod", "yaml", "typescript"],
    },
    format: "esm",
    platform: "node",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
