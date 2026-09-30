import { assetRef, defineTheme, tokenRef } from "@unframe/unframe-authoring";
import { palette, sharedTextStyle } from "./reference-values";

const theme = defineTheme({
  id: "reference-theme",
  namedStyles: {
    body: {
      kind: "text",
      style: {
        ...sharedTextStyle,
        fontSize: tokenRef({ category: "logicalLength", tokenId: "bodySize" }),
        lineHeight: 44,
      },
    },
    card: {
      kind: "frame",
      style: {
        backgroundColor: palette.white,
        border: {
          color: tokenRef({ category: "color", tokenId: "highlight" }),
          width: 2,
          radius: 24,
        },
        clip: true,
      },
    },
    heading: {
      kind: "text",
      style: { ...sharedTextStyle, fontSize: 56, lineHeight: 88, weight: "bold" },
    },
  },
  tokens: {
    accent: { category: "color", value: palette.accent },
    bodyFont: { category: "fontFace", value: assetRef({ assetId: "reference-font" }) },
    bodySize: { category: "logicalLength", value: 32 },
    canvas: { category: "color", value: palette.canvas },
    highlight: {
      category: "color",
      value: tokenRef({ category: "color", tokenId: "accent" }),
    },
    ink: { category: "color", value: palette.ink },
    surfaceWidth: { category: "spatialLength", value: 1 },
    transitionDuration: { category: "duration", value: 300 },
    transitionEasing: { category: "easing", value: "cubicInOut" },
  },
});

export default theme;
