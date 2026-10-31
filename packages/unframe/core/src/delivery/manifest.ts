import { asUint64, modelFeature, featureSet, buildResidencyPlan } from "./residency.js";
import type { CapabilityProfile, DeliveryManifestWire } from "@unframe/contracts/presentation";
import { idSchema } from "@unframe/contracts/presentation";
import { buildProjectionProfile } from "./profile.js";
import type { DeliverySourceInput } from "./input.js";
import { snapshotPlainJson } from "../publication/plain-json.js";

const limits = (value: Record<string, string | number>) =>
  Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "tierId" ? entry : asUint64(entry as number),
    ]),
  );
const capabilityWire = (capability: CapabilityProfile) => ({
  schemaVersion: capability.schemaVersion,
  capabilityProfileId: capability.capabilityProfileId,
  contractVersions: capability.contractVersions,
  renderers: {
    bakedWeb: {
      supported: capability.renderers.bakedWeb.supported,
      contractVersion: capability.renderers.bakedWeb.contractVersion,
      features: featureSet(capability.renderers.bakedWeb.features, {
        png: 1,
        srgb: 2,
        "alpha-opaque": 3,
        "alpha-straight": 4,
      }),
    },
    nativeUi: {
      supported: capability.renderers.nativeUi.supported,
      contractVersion: capability.renderers.nativeUi.contractVersion,
      features: featureSet(capability.renderers.nativeUi.features, {
        clip: 1,
        ellipsis: 2,
        explicitFontFallback: 3,
      }),
    },
    video: {
      supported: capability.renderers.video.supported,
      contractVersion: capability.renderers.video.contractVersion,
      features: featureSet(capability.renderers.video.features, {
        h264: 1,
        vp9: 2,
        av1: 3,
        alpha: 4,
        audio: 5,
      }),
    },
  },
  model: {
    supported: capability.model.supported,
    contractVersion: capability.model.contractVersion,
    formats: capability.model.formats.map(() => 1),
    features: featureSet(capability.model.features, modelFeature),
  },
  limits: {
    texture: limits(capability.limits.texture),
    nativeUi: limits(capability.limits.nativeUi),
    video: limits(capability.limits.video),
    model: limits(capability.limits.model),
  },
  localOverlaySupported: capability.localOverlaySupported,
});

export type AssetAccessGrant = { url: string; expiresAtUnixMilliseconds: number };
type AssetUrl = {
  protocol: string;
  host: string;
  username: string;
  password: string;
  hash: string;
};
type AssetUrlConstructor = new (input: string) => AssetUrl;
export type DeliveryManifestBuildInput = DeliverySourceInput & {
  role: "presenter" | "viewer";
  sessionId: string;
  participantId: string;
  assignmentEpoch: number;
  issuedAtUnixMilliseconds: number;
  assetAccess: Record<string, AssetAccessGrant>;
};

export const buildDeliveryManifest = (input: DeliveryManifestBuildInput) => {
  const frozen = snapshotPlainJson(input);
  if (!frozen.valid)
    throw new TypeError("Delivery Manifest input must be plain JSON data properties.");
  input = frozen.value as unknown as DeliveryManifestBuildInput;
  idSchema.parse(input.sessionId);
  idSchema.parse(input.participantId);
  const { profile, selection } = buildProjectionProfile(
    {
      definition: input.definition,
      renderBundle: input.renderBundle,
      assetSet: input.assetSet,
      buildManifest: input.buildManifest,
      publishedPresentation: input.publishedPresentation,
      capability: input.capability,
    },
    input.role,
  );
  if (!profile.projectionProfileId) throw new Error("Projection profile identity is missing.");
  if (!Number.isSafeInteger(input.assignmentEpoch) || input.assignmentEpoch <= 0)
    throw new Error("assignmentEpoch must be positive.");
  if (!Number.isSafeInteger(input.issuedAtUnixMilliseconds) || input.issuedAtUnixMilliseconds < 0)
    throw new Error("issuedAtUnixMilliseconds must be a safe unsigned integer.");
  const selectedIds = new Set(selection.assets.map((asset) => asset.assetId));
  if (
    Object.keys(input.assetAccess).length !== selectedIds.size ||
    Object.keys(input.assetAccess).some((id) => !selectedIds.has(id))
  )
    throw new Error("Asset access keys must exactly match selected Asset closure.");
  const Url = (globalThis as unknown as { URL?: AssetUrlConstructor }).URL;
  if (typeof Url !== "function") throw new Error("WHATWG URL parser is unavailable.");
  const assetAccess = selection.assets.map(({ assetId, descriptor }) => {
    const grant = input.assetAccess[assetId];
    if (!grant) throw new Error(`Missing Asset access for ${assetId}.`);
    let url: AssetUrl;
    try {
      url = new Url(grant.url);
    } catch {
      throw new Error(`Asset ${assetId} URL is invalid.`);
    }
    if (url.protocol !== "https:" || !url.host || url.username || url.password || url.hash)
      throw new Error(
        `Asset ${assetId} URL must be absolute HTTPS without credentials or fragment.`,
      );
    if (
      !Number.isSafeInteger(grant.expiresAtUnixMilliseconds) ||
      grant.expiresAtUnixMilliseconds <= input.issuedAtUnixMilliseconds
    )
      throw new Error(`Asset ${assetId} access expiry must follow issuance.`);
    return {
      assetId,
      checksum: descriptor.checksum,
      mediaType: descriptor.mediaType,
      encodedSizeBytes: asUint64(descriptor.encodedSizeBytes),
      url: grant.url,
      expiresAtUnixMs: asUint64(grant.expiresAtUnixMilliseconds),
    };
  });
  const manifest: DeliveryManifestWire = {
    schemaVersion: 3,
    deliveryContractVersion: 3,
    sessionId: input.sessionId,
    publication: {
      presentationId: input.publishedPresentation.presentationId,
      publicationEpoch: asUint64(input.publishedPresentation.publicationEpoch),
      publicationManifestHash: input.publishedPresentation.publicationManifestHash,
    },
    definitionHash: input.publishedPresentation.definitionHash,
    renderBundleHash: input.publishedPresentation.renderBundleHash,
    assetSetHash: input.publishedPresentation.assetSetHash,
    capabilityProfile: capabilityWire(input.capability),
    projectionProfile: profile,
    projectionInstance: {
      projectionProfileId: profile.projectionProfileId,
      participantId: input.participantId,
      assignmentEpoch: asUint64(input.assignmentEpoch),
    },
    assetAccess,
    residency: buildResidencyPlan(input, selection),
  };
  return JSON.parse(JSON.stringify(manifest)) as typeof manifest;
};
