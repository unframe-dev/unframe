import { defineTheme } from "@unframe/unframe-authoring";

export default defineTheme({
  id: "reference-theme",
  tokens: {
    canvas: {
      category: "color",
      value: {
        red: 0.96,
        green: 0.97,
        blue: 1,
        alpha: 1,
      },
    },
    ink: {
      category: "color",
      value: {
        red: 0.08,
        green: 0.1,
        blue: 0.18,
        alpha: 1,
      },
    },
    accent: {
      category: "color",
      value: {
        red: 0.2,
        green: 0.3,
        blue: 0.85,
        alpha: 1,
      },
    },
    highlight: {
      category: "color",
      value: {
        kind: "token-ref",
        category: "color",
        tokenId: "accent",
      },
    },
    bodyFont: {
      category: "fontFace",
      value: {
        kind: "asset-ref",
        assetId: "reference-font",
      },
    },
    bodySize: {
      category: "logicalLength",
      value: 32,
    },
    surfaceWidth: {
      category: "spatialLength",
      value: 1,
    },
    transitionDuration: {
      category: "duration",
      value: 300,
    },
    transitionEasing: {
      category: "easing",
      value: "cubicInOut",
    },
  },
  namedStyles: {
    heading: {
      kind: "text",
      style: {
        font: {
          kind: "token-ref",
          category: "fontFace",
          tokenId: "bodyFont",
        },
        fontSize: 56,
        lineHeight: 88,
        color: {
          kind: "token-ref",
          category: "color",
          tokenId: "ink",
        },
        weight: "bold",
      },
    },
    body: {
      kind: "text",
      style: {
        font: {
          kind: "token-ref",
          category: "fontFace",
          tokenId: "bodyFont",
        },
        fontSize: {
          kind: "token-ref",
          category: "logicalLength",
          tokenId: "bodySize",
        },
        lineHeight: 44,
        color: {
          kind: "token-ref",
          category: "color",
          tokenId: "ink",
        },
      },
    },
    card: {
      kind: "frame",
      style: {
        backgroundColor: {
          red: 1,
          green: 1,
          blue: 1,
          alpha: 1,
        },
        border: {
          color: {
            kind: "token-ref",
            category: "color",
            tokenId: "highlight",
          },
          width: 2,
          radius: 24,
        },
        clip: true,
      },
    },
  },
});
