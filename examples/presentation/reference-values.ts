import { tokenRef } from "@unframe/unframe-authoring";

export const palette = {
  accent: { alpha: 1, blue: 0.85, green: 0.3, red: 0.2 },
  canvas: { alpha: 1, blue: 1, green: 0.97, red: 0.96 },
  ink: { alpha: 1, blue: 0.18, green: 0.1, red: 0.08 },
  white: { alpha: 1, blue: 1, green: 1, red: 1 },
} as const;

export const sharedTextStyle = {
  color: tokenRef({ category: "color", tokenId: "ink" }),
  font: tokenRef({ category: "fontFace", tokenId: "bodyFont" }),
} as const;

export const presentationOwner = { kind: "presentation" } as const;

export const staticRenderIntent = {
  fallbackPolicy: "reject",
  interaction: "none",
  internalAnimation: "none",
  rendererPreference: "baked-web",
  updateModel: "static",
} as const;
