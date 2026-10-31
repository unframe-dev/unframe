import { tokenRef } from "@unframe/unframe-authoring";

export const palette = {
  canvas: { red: 0.96, green: 0.97, blue: 1, alpha: 1 },
  ink: { red: 0.08, green: 0.1, blue: 0.18, alpha: 1 },
  accent: { red: 0.2, green: 0.3, blue: 0.85, alpha: 1 },
  white: { red: 1, green: 1, blue: 1, alpha: 1 },
} as const;

export const sharedTextStyle = {
  font: tokenRef({ category: "fontFace", tokenId: "bodyFont" }),
  color: tokenRef({ category: "color", tokenId: "ink" }),
} as const;

export const presentationOwner = { kind: "presentation" } as const;

export const staticRenderIntent = {
  updateModel: "static",
  interaction: "none",
  internalAnimation: "none",
  rendererPreference: "baked-web",
  fallbackPolicy: "reject",
} as const;
