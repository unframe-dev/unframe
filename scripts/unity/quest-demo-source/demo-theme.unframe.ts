import { assetRef, defineTheme } from "@unframe/unframe-authoring";

export default defineTheme({
  id: "quest-demo-theme",
  tokens: { bodyFont: { category: "fontFace", value: assetRef({ assetId: "reference-font" }) } },
  namedStyles: {
    body: {
      kind: "text",
      style: {
        font: { kind: "token-ref", category: "fontFace", tokenId: "bodyFont" },
        fontSize: 20,
        lineHeight: 28,
        color: { red: 1, green: 1, blue: 1, alpha: 1 },
      },
    },
  },
});
