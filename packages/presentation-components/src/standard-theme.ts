import { defineTheme } from "@unframe/presentation";

export const standardThemeStyleIds = {
  surfaceRoot: "surface.root",
  surfaceText: "surface.text",
} as const;

export const standardTheme = defineTheme({
  id: "@unframe/themes/standard",
  source: { file: "standard-theme.ts" },
  tokens: {},
  namedStyles: {
    [standardThemeStyleIds.surfaceRoot]: {},
    [standardThemeStyleIds.surfaceText]: {},
  },
});
