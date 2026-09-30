import * as z from "zod";

import {
  contentHashV2Schema,
  idV2Schema,
  positiveSafeUIntV2Schema,
  safeUIntV2Schema,
} from "./common";

export const contractVersionsV2Schema = z.strictObject({
  assetSet: z.literal(2),
  definition: z.literal(2),
  delivery: z.literal(2),
  progression: z.literal(1),
  projection: z.literal(1),
  renderBundle: z.literal(2),
  runtime: z.literal(2),
});
export const publicationFenceV2Schema = z.strictObject({
  presentationId: idV2Schema,
  publicationEpoch: positiveSafeUIntV2Schema,
  publicationManifestHash: contentHashV2Schema,
});

export const buildManifestV2Schema = z.strictObject({
  assetSetHash: contentHashV2Schema,
  buildId: idV2Schema,
  contractVersions: contractVersionsV2Schema,
  definitionHash: contentHashV2Schema,
  presentationId: idV2Schema,
  renderBundleHash: contentHashV2Schema,
  schemaVersion: z.literal(2),
  sourceDraftRevision: safeUIntV2Schema,
});

export const publishedPresentationV2Schema = z.strictObject({
  assetSetHash: contentHashV2Schema,
  buildId: idV2Schema,
  contractVersions: contractVersionsV2Schema,
  definitionHash: contentHashV2Schema,
  presentationId: idV2Schema,
  publicationEpoch: positiveSafeUIntV2Schema,
  publicationManifestHash: contentHashV2Schema,
  renderBundleHash: contentHashV2Schema,
  schemaVersion: z.literal(2),
  sourceDraftRevision: safeUIntV2Schema,
});

export type BuildManifestV2 = z.infer<typeof buildManifestV2Schema>;
export type PublishedPresentationV2 = z.infer<typeof publishedPresentationV2Schema>;
