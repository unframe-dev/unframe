import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import canonicalize from "canonicalize";
import { audienceWebResourcePolicy } from "./audience-resource-policy";
import { capabilityProfileSchema, type CapabilityProfile } from "./capability";
import { runtimeAuthorityVersions } from "./runtime-authority";

const definition = {
  schemaVersion: runtimeAuthorityVersions.capability,
  contractVersions: {
    delivery: runtimeAuthorityVersions.delivery,
    runtime: runtimeAuthorityVersions.runtime,
    progression: runtimeAuthorityVersions.progression,
    projection: runtimeAuthorityVersions.projection,
  },
  renderers: {
    bakedWeb: {
      supported: true,
      contractVersion: 1,
      features: ["png", "srgb", "alpha-opaque", "alpha-straight"],
    },
    nativeUi: { supported: false, contractVersion: 1, features: [] },
    video: { supported: true, contractVersion: 1, features: ["h264", "audio"] },
  },
  model: {
    supported: true,
    contractVersion: 1,
    formats: ["model/gltf-binary"],
    features: [
      "animation",
      "skin",
      "morphTargets",
      "alphaBlend",
      "alphaMask",
      "pbrMetallicRoughness",
      "unlit",
    ],
  },
  limits: audienceWebResourcePolicy,
  localOverlaySupported: false,
} satisfies Omit<CapabilityProfile, "capabilityProfileId">;

const serialized = canonicalize(definition);
if (serialized === undefined) throw new TypeError("Audience capability must be JSON data");

export const audienceWebCapabilityProfileId = `audience-web_${bytesToHex(sha256(utf8ToBytes(serialized)))}`;

const profile = capabilityProfileSchema.parse({
  ...definition,
  capabilityProfileId: audienceWebCapabilityProfileId,
});

export const createAudienceWebCapabilityProfile = (): CapabilityProfile => structuredClone(profile);
