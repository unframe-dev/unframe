import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: [
      "*.d.ts",
      "app/web/audience/vendor/**",
      "packages/contracts/openapi/control-plane.openapi.json",
      "packages/contracts/src/control-plane.openapi.ts",
    ],
  },
  fmt: {
    ignorePatterns: [
      "*.d.ts",
      "app/web/audience/vendor/**",
      "packages/contracts/openapi/control-plane.openapi.json",
      "packages/contracts/src/control-plane.openapi.ts",
    ],
  },
  staged: {
    "**/*.{cjs,cts,js,json,jsonc,jsx,mjs,mts,svelte,ts,tsx,yaml,yml}": "vp check --fix",
    "**/*.{css,html,md,mdx}": "vp fmt",
  },
});
