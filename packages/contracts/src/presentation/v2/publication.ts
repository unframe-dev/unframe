import * as z from "zod";

import {
  contentHashV2Schema,
  idV2Schema,
  positiveSafeUIntV2Schema,
  safeUIntV2Schema,
} from "./common";

export const contractVersionsV2Schema = z.strictObject({
  definition: z.literal(2),
  renderBundle: z.literal(2),
  assetSet: z.literal(2),
  delivery: z.literal(2),
  runtime: z.literal(2),
  progression: z.literal(1),
  projection: z.literal(1),
});
export const publicationFenceV2Schema = z.strictObject({
  presentationId: idV2Schema,
  publicationEpoch: positiveSafeUIntV2Schema,
  publicationManifestHash: contentHashV2Schema,
});

export const buildManifestV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  buildId: idV2Schema,
  presentationId: idV2Schema,
  sourceDraftRevision: safeUIntV2Schema,
  definitionHash: contentHashV2Schema,
  renderBundleHash: contentHashV2Schema,
  assetSetHash: contentHashV2Schema,
  contractVersions: contractVersionsV2Schema,
});

export const publishedPresentationV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  presentationId: idV2Schema,
  publicationEpoch: positiveSafeUIntV2Schema,
  publicationManifestHash: contentHashV2Schema,
  sourceDraftRevision: safeUIntV2Schema,
  buildId: idV2Schema,
  definitionHash: contentHashV2Schema,
  renderBundleHash: contentHashV2Schema,
  assetSetHash: contentHashV2Schema,
  contractVersions: contractVersionsV2Schema,
});

export type BuildManifestV2 = z.infer<typeof buildManifestV2Schema>;
export type PublishedPresentationV2 = z.infer<typeof publishedPresentationV2Schema>;
