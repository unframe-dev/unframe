import * as z from "zod";

import { boundsSchema, idSchema, semanticTreeSchema, vector2Schema } from "./common";

const bindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({ kind: z.literal("artifacts"), artifactIds: z.array(idSchema).min(1) }),
]);

const textureSchema = z.strictObject({
  assetId: idSchema,
  mediaType: z.literal("image/png"),
  pixelSize: vector2Schema,
  checksum: idSchema,
  colorSpace: z.literal("srgb"),
  alphaMode: z.enum(["opaque", "straight", "premultiplied"]),
});

const bakedArtifactSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("baked-web"),
  states: z.record(
    z.string(),
    z.strictObject({ stateId: idSchema, textures: z.array(textureSchema).min(1) }),
  ),
});

const renderSurfaceSchema = z.strictObject({
  id: idSchema,
  semanticSurfaceId: idSchema,
  logicalBounds: boundsSchema,
  layer: z.int().nonnegative(),
  artifacts: z.record(z.string(), bakedArtifactSchema),
  stateBindings: z.record(z.string(), bindingSchema),
});

const hitRegionSchema = z.strictObject({
  interactionId: idSchema,
  semanticNodeId: idSchema,
  bounds: boundsSchema,
  coordinateSpace: z.literal("normalized"),
  event: idSchema,
  priority: z.number(),
});

const compiledSurfaceSchema = z.strictObject({
  semanticSurfaceId: idSchema,
  logicalSize: vector2Schema,
  physicalSizeMeters: vector2Schema,
  renderSurfaceIds: z.array(idSchema).min(1),
  renderSurfaces: z.record(z.string(), renderSurfaceSchema),
  semanticsByState: z.record(z.string(), semanticTreeSchema),
  interactionsByState: z.record(z.string(), z.array(hitRegionSchema)),
});

export const renderBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bundleId: idSchema,
  sourceHash: idSchema,
  definitionHash: idSchema,
  compiler: z.strictObject({
    name: idSchema,
    version: idSchema,
    environmentHash: idSchema,
  }),
  buildContext: z.strictObject({
    locale: idSchema,
    timezone: idSchema,
    colorScheme: z.enum(["light", "dark"]),
    themeId: idSchema,
    themeHash: idSchema,
  }),
  surfaces: z.record(z.string(), compiledSurfaceSchema),
});

export type SerializedRenderBundleV1 = z.infer<typeof renderBundleSchema>;
