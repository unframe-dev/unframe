import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "app/server/control-plane/src/worker-configuration.d.ts",
      "packages/contracts/openapi/control-plane.openapi.json",
      "packages/contracts/src/control-plane.openapi.ts",
    ],
  },
  staged: {
    "**/*.{cjs,cts,js,json,jsonc,jsx,mjs,mts,svelte,ts,tsx,yaml,yml}": "vp check --fix",
    "**/*.{css,html,md,mdx}": "vp fmt",
  },
});
