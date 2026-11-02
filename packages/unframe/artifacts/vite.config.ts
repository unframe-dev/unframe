import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts", "plain-json": "src/publication/plain-json.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [/^@unframe\//, /^@noble\/hashes(?:\/|$)/, "canonicalize", "jsonc-parser"],
      neverBundle: [/^zod(?:\/|$)/],
      onlyBundle: false,
      onlyImport: ["zod"],
    },
    format: "esm",
    platform: "neutral",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
