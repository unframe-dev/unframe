import { hashCanonicalJsonPayload } from "@unframe/unframe-core";
import type { RendererIdentity, RenderSurfacePlan } from "@unframe/unframe-renderer-api";

export const opaquePartitionIdentity = (
  surfaceId: string,
  bounds: RenderSurfacePlan["logicalBounds"],
  renderer: RendererIdentity,
  moduleHash: string,
) => {
  const rendererEntry = {
    ...renderer,
    entry: { entryId: surfaceId, kind: "opaque" as const, moduleHash },
  };
  const descriptor = {
    compositingGroupKey: hashCanonicalJsonPayload({ kind: "opaque-entry", version: 1 }),
    executionClass: "baked-web" as const,
    layer: 0,
    logicalBounds: bounds,
    ownedContentNodeIds: [] as Array<string>,
    partitionStrategyVersion: 1,
    renderer: rendererEntry,
    semanticSurfaceId: surfaceId,
  };
  return {
    descriptor,
    id: `rs_${hashCanonicalJsonPayload(descriptor).slice(7)}`,
    partitionRendererKey: hashCanonicalJsonPayload({
      executionClass: "baked-web",
      renderer: rendererEntry,
    }),
  };
};
