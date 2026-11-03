import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [/^@unframe-dev\/contracts(?:\/|$)/, /^@noble\/hashes(?:\/|$)/],
      neverBundle: [/^@unframe-dev\/(?!contracts(?:\/|$))/, /^zod(?:\/|$)/, "react"],
      onlyBundle: false,
      onlyImport: [
        "@unframe-dev/artifacts",
        "@unframe-dev/authoring",
        "@unframe-dev/presentation",
        "zod",
        "react",
      ],
    },
    format: "esm",
    platform: "neutral",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
