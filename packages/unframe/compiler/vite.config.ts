import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [/^@unframe\/contracts(?:\/|$)/, /^@noble\/hashes(?:\/|$)/],
      neverBundle: [/^@unframe\/(?!contracts(?:\/|$))/, /^zod(?:\/|$)/, "react"],
      onlyBundle: false,
      onlyImport: [
        "@unframe/artifacts",
        "@unframe/authoring",
        "@unframe/presentation",
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
