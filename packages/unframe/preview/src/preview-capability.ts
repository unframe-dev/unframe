import {
  createUnityMediaCapabilityProfile,
  type CapabilityProfile,
} from "@unframe-dev/contracts/presentation";

export const previewCapability = (): CapabilityProfile => {
  const profile = createUnityMediaCapabilityProfile();
  profile.capabilityProfileId = "local-web-preview";
  profile.renderers.nativeUi = { supported: true, contractVersion: 1, features: ["clip"] };
  profile.limits.nativeUi = {
    tierId: "local-web-preview",
    maxNodesPerArtifact: 4096,
    maxTreeDepth: 64,
    maxTextNodesPerArtifact: 1024,
    maxCodePointsPerText: 4096,
    maxGlyphs: 65536,
    maxFontAssets: 32,
  };
  for (const budget of Object.values(profile.limits))
    if (budget.tierId === "unity-media-v1") budget.tierId = "local-web-preview";
  return profile;
};
