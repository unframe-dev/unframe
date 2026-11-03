import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [
        /^@unframe-dev\/contracts(?:\/|$)/,
        /^@noble\/hashes(?:\/|$)/,
        "canonicalize",
        "jsonc-parser",
      ],
      neverBundle: [
        /^@unframe-dev\/(?!contracts(?:\/|$))/,
        /^zod(?:\/|$)/,
        "typescript",
        "react",
        "css-tree",
      ],
      onlyBundle: false,
      onlyImport: [
        /^node:/,
        /^@unframe-dev\/(?!contracts(?:\/|$))/,
        "zod",
        "typescript",
        "react",
        "css-tree",
      ],
    },
    format: "esm",
    platform: "node",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
