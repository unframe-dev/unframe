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
      neverBundle: [/^@unframe\/(?:workspace|build)(?:\/|$)/, /^zod(?:\/|$)/, "yaml", "typescript"],
      onlyBundle: false,
      onlyImport: ["@unframe/workspace", "@unframe/build", "zod", "yaml", "typescript"],
    },
    format: "esm",
    platform: "node",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
