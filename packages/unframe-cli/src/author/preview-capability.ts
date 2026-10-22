import {
  createUnityMediaCapabilityProfile,
  type CapabilityProfile,
} from "@unframe/contracts/presentation";

export const previewCapability = (): CapabilityProfile => {
  const profile = createUnityMediaCapabilityProfile();
  profile.capabilityProfileId = "local-web-preview";
  for (const budget of Object.values(profile.limits))
    if (budget.tierId === "unity-media-v1") budget.tierId = "local-web-preview";
  return profile;
};
