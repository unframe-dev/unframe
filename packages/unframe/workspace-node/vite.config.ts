import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [
        /^@unframe\/(?:artifacts|contracts)(?:\/|$)/,
        /^@noble\/hashes(?:\/|$)/,
        "canonicalize",
      ],
      neverBundle: ["@unframe/workspace", /^zod(?:\/|$)/, "yaml"],
      onlyBundle: false,
      onlyImport: ["@unframe/workspace", "zod", "yaml"],
    },
    format: "esm",
    platform: "node",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
