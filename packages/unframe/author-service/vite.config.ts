import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [
        /^@unframe\/(?!build$|workspace$|artifacts$)/,
        /^@noble\/hashes(?:\/|$)/,
        "canonicalize",
        "jsonc-parser",
      ],
      neverBundle: [
        "@unframe/build",
        "@unframe/workspace",
        "@unframe/artifacts",
        /^zod(?:\/|$)/,
        "typescript",
        "react",
      ],
      onlyBundle: false,
      onlyImport: [
        /^node:/,
        "@unframe/build",
        "@unframe/workspace",
        "@unframe/artifacts",
        "zod",
        "typescript",
        "react",
      ],
    },
    format: "esm",
    platform: "node",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
