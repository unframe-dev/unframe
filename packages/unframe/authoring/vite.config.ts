import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: {
      index: "src/index.ts",
      components: "src/components/index.ts",
      "jsx-runtime": "src/jsx-runtime.ts",
      "jsx-dev-runtime": "src/jsx-dev-runtime.ts",
    },
    dts: { eager: true },
    deps: {
      alwaysBundle: [],
      neverBundle: [/^zod(?:\/|$)/, /^@unframe\/presentation$/, /^react(?:\/|$)/],
      onlyBundle: false,
      onlyImport: ["zod", "@unframe/presentation", "react"],
    },
    format: "esm",
    platform: "neutral",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
