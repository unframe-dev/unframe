import { defineTheme } from "@unframe/unframe-authoring";

export default defineTheme({
  id: "media-theme",
  tokens: {
    bodyFont: {
      category: "fontFace",
      value: {
        kind: "asset-ref",
        assetId: "reference-font",
      },
    },
  },
  namedStyles: {},
});
