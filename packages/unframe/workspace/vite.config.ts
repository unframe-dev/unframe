import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: { index: "src/index.ts" },
    dts: { eager: true },
    deps: {
      alwaysBundle: [/^@unframe\//, /^@noble\/hashes(?:\/|$)/, "canonicalize", "jsonc-parser"],
      neverBundle: [
        /^zod(?:\/|$)/,
        "typescript",
        "react",
        "semver",
        "ssri",
        "validate-npm-package-name",
        "yaml",
      ],
      onlyBundle: false,
      onlyImport: [
        "zod",
        "typescript",
        "react",
        "semver",
        "ssri",
        "validate-npm-package-name",
        "yaml",
      ],
    },
    format: "esm",
    platform: "node",
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    sourcemap: true,
  },
});
