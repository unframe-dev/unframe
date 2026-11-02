import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts", worker: "src/opaque/capture/worker.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [
        /^@unframe\/(?!build(?:\/|$))/,
        /^@noble\/hashes(?:\/|$)/,
        "canonicalize",
        "jsonc-parser",
        "@jridgewell/trace-mapping",
      ],
      neverBundle: [
        "@unframe/build",
        /^zod(?:\/|$)/,
        "typescript",
        "react",
        "react-dom",
        "playwright-core",
        "pngjs",
        "rolldown",
      ],
      onlyBundle: false,
      onlyImport: [
        "@unframe/build",
        /^node:/,
        "zod",
        "typescript",
        "react",
        "react-dom",
        "playwright-core",
        "pngjs",
        "rolldown",
      ],
    },
    format: "esm",
    platform: "node",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
