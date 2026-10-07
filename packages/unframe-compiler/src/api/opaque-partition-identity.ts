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
    entry: { kind: "opaque" as const, entryId: surfaceId, moduleHash },
  };
  const descriptor = {
    partitionStrategyVersion: 1,
    semanticSurfaceId: surfaceId,
    renderer: rendererEntry,
    executionClass: "baked-web" as const,
    compositingGroupKey: hashCanonicalJsonPayload({ kind: "opaque-entry", version: 1 }),
    ownedContentNodeIds: [] as string[],
    logicalBounds: bounds,
    layer: 0,
  };
  return {
    id: `rs_${hashCanonicalJsonPayload(descriptor).slice(7)}`,
    partitionRendererKey: hashCanonicalJsonPayload({
      renderer: rendererEntry,
      executionClass: "baked-web",
    }),
    descriptor,
  };
};
