import nkzw from "@nkzw/oxlint-config";
import { defineConfig } from "vite-plus";

const warnExplicitErrors = (rules: NonNullable<typeof nkzw.rules>) => {
  const warnedRules: NonNullable<typeof nkzw.rules> = {};

  for (const [name, setting] of Object.entries(rules)) {
    if (Array.isArray(setting)) {
      if (setting[0] === "error") {
        warnedRules[name] = ["warn", ...setting.slice(1)];
      } else {
        warnedRules[name] = setting;
      }
      continue;
    }

    if (setting === "error") {
      warnedRules[name] = "warn";
    } else {
      warnedRules[name] = setting;
    }
  }

  return warnedRules;
};

export default defineConfig({
  lint: {
    extends: [
      {
        ...nkzw,
        ...(nkzw.overrides && {
          overrides: nkzw.overrides.map((override) => ({
            ...override,
            ...(override.rules && { rules: warnExplicitErrors(override.rules) }),
          })),
        }),
        ...(nkzw.rules && { rules: warnExplicitErrors(nkzw.rules) }),
      },
    ],
    overrides: [
      {
        files: ["packages/unframe-*/src/**/*.{ts,tsx}"],
        rules: {
          complexity: ["warn", { max: 20 }],
          curly: "warn",
          "eslint/no-nested-ternary": "warn",
          "max-depth": ["warn", { max: 4 }],
        },
      },
    ],
  },
  staged: {
    "**/*.{cjs,cts,js,json,jsonc,jsx,mjs,mts,svelte,ts,tsx,yaml,yml}": "vp check --fix",
    "**/*.{css,html,md,mdx}": "vp fmt",
  },
});
