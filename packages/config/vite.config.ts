import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: [
      "app/web/audience/vendor/**",
      "app/web/audience/src/fiducials/generated-posit.mjs",
    ],
  },
  fmt: {
    ignorePatterns: [
      "app/web/audience/vendor/**",
      "app/web/audience/src/fiducials/generated-posit.mjs",
      "app/server/control-plane/src/worker-configuration.d.ts",
      "packages/contracts/openapi/control-plane.openapi.json",
      "packages/contracts/src/control-plane.openapi.ts",
      "app/unity/Assets/Resources/QuestDemoPresentation/*.json",
    ],
  },
  staged: {
    "**/*.{cjs,cts,js,json,jsonc,jsx,mjs,mts,svelte,ts,tsx,yaml,yml}": "vp check --fix",
    "**/*.{css,html,md,mdx}": "vp fmt",
  },
});
