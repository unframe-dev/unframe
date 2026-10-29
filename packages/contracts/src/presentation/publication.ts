import * as z from "zod";

import {
  contentHashSchema,
  idSchema,
  positiveSafeUIntSchema,
  safeUIntSchema,
  storageSegmentIdSchema,
} from "./common";

export const contractVersionsSchema = z.strictObject({
  definition: z.literal(3),
  renderBundle: z.literal(2),
  assetSet: z.literal(2),
  delivery: z.literal(3),
  runtime: z.literal(3),
  progression: z.literal(2),
  projection: z.literal(2),
});
export const publicationFenceSchema = z.strictObject({
  presentationId: idSchema,
  publicationEpoch: positiveSafeUIntSchema,
  publicationManifestHash: contentHashSchema,
});

export const buildManifestSchema = z.strictObject({
  schemaVersion: z.literal(3),
  buildId: storageSegmentIdSchema,
  presentationId: idSchema,
  sourceDraftRevision: safeUIntSchema,
  definitionHash: contentHashSchema,
  renderBundleHash: contentHashSchema,
  assetSetHash: contentHashSchema,
  contractVersions: contractVersionsSchema,
});

export const publishedPresentationSchema = z.strictObject({
  schemaVersion: z.literal(3),
  presentationId: idSchema,
  publicationEpoch: positiveSafeUIntSchema,
  publicationManifestHash: contentHashSchema,
  sourceDraftRevision: safeUIntSchema,
  buildId: storageSegmentIdSchema,
  definitionHash: contentHashSchema,
  renderBundleHash: contentHashSchema,
  assetSetHash: contentHashSchema,
  contractVersions: contractVersionsSchema,
});

export type BuildManifest = z.infer<typeof buildManifestSchema>;
export type PublishedPresentation = z.infer<typeof publishedPresentationSchema>;
