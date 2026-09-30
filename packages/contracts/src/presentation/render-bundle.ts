import * as z from "zod";

import { boundsSchema, idSchema, semanticTreeSchema, vector2Schema } from "./common";

const bindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty") }),
  z.strictObject({ artifactIds: z.array(idSchema).min(1), kind: z.literal("artifacts") }),
]);

const textureSchema = z.strictObject({
  alphaMode: z.enum(["opaque", "straight", "premultiplied"]),
  assetId: idSchema,
  checksum: idSchema,
  colorSpace: z.literal("srgb"),
  mediaType: z.literal("image/png"),
  pixelSize: vector2Schema,
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
  artifacts: z.record(z.string(), bakedArtifactSchema),
  id: idSchema,
  layer: z.int().nonnegative(),
  logicalBounds: boundsSchema,
  semanticSurfaceId: idSchema,
  stateBindings: z.record(z.string(), bindingSchema),
});

const hitRegionSchema = z.strictObject({
  bounds: boundsSchema,
  coordinateSpace: z.literal("normalized"),
  event: idSchema,
  interactionId: idSchema,
  priority: z.number(),
  semanticNodeId: idSchema,
});

const compiledSurfaceSchema = z.strictObject({
  interactionsByState: z.record(z.string(), z.array(hitRegionSchema)),
  logicalSize: vector2Schema,
  physicalSizeMeters: vector2Schema,
  renderSurfaceIds: z.array(idSchema).min(1),
  renderSurfaces: z.record(z.string(), renderSurfaceSchema),
  semanticsByState: z.record(z.string(), semanticTreeSchema),
  semanticSurfaceId: idSchema,
});

export const renderBundleSchema = z.strictObject({
  buildContext: z.strictObject({
    colorScheme: z.enum(["light", "dark"]),
    locale: idSchema,
    themeHash: idSchema,
    themeId: idSchema,
    timezone: idSchema,
  }),
  bundleId: idSchema,
  compiler: z.strictObject({
    environmentHash: idSchema,
    name: idSchema,
    version: idSchema,
  }),
  definitionHash: idSchema,
  schemaVersion: z.literal(1),
  sourceHash: idSchema,
  surfaces: z.record(z.string(), compiledSurfaceSchema),
});

export type SerializedRenderBundleV1 = z.infer<typeof renderBundleSchema>;
