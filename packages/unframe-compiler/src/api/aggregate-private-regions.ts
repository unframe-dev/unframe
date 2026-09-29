import type { RenderBundle } from "@unframe/unframe-core";
import type { RendererPrivateHitRegion } from "@unframe/unframe-renderer-api";
import { compareStrings } from "../diagnostics/diagnostics.js";

type PortableRegions = RenderBundle["surfaces"][string]["interactionsByState"];
type Bounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export const aggregatePrivateRegions = (
  logicalSize: readonly [number, number],
  stateIds: readonly string[],
  partitions: readonly {
    readonly logicalBounds: Bounds;
    readonly hitRegionsByState: Readonly<Record<string, readonly RendererPrivateHitRegion[]>>;
  }[],
): PortableRegions => {
  const result: PortableRegions = {};
  for (const stateId of stateIds) {
    const regions = partitions.flatMap(({ logicalBounds, hitRegionsByState }) =>
      (hitRegionsByState[stateId] ?? []).map((region) => ({
        interactionId: region.interactionId,
        semanticNodeId: region.semanticNodeId,
        bounds: {
          x: (logicalBounds.x + region.bounds.x) / logicalSize[0],
          y: (logicalBounds.y + region.bounds.y) / logicalSize[1],
          width: region.bounds.width / logicalSize[0],
          height: region.bounds.height / logicalSize[1],
        },
        priority: region.priority,
        coordinateSpace: "normalized" as const,
      })),
    );
    regions.sort(
      (left, right) =>
        right.priority - left.priority ||
        compareStrings(left.interactionId, right.interactionId) ||
        compareStrings(left.semanticNodeId, right.semanticNodeId) ||
        left.bounds.x - right.bounds.x ||
        left.bounds.y - right.bounds.y ||
        left.bounds.width - right.bounds.width ||
        left.bounds.height - right.bounds.height,
    );
    result[stateId] = regions;
  }
  return result;
};
