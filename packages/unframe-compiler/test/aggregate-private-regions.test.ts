import { describe, expect, it } from "vitest";
import { aggregatePrivateRegions } from "../src/api/aggregate-private-regions.js";

describe("aggregatePrivateRegions", () => {
  it("normalizes partition-local regions across two partitions and sorts by priority", () => {
    const regions = aggregatePrivateRegions(
      [200, 100],
      ["active", "idle"],
      [
        {
          logicalBounds: { x: 0, y: 0, width: 100, height: 100 },
          hitRegionsByState: {
            active: [
              {
                interactionId: "left",
                semanticNodeId: "button-left",
                bounds: { x: 20, y: 10, width: 40, height: 20 },
                priority: 1,
              },
            ],
            idle: [],
          },
        },
        {
          logicalBounds: { x: 100, y: 0, width: 100, height: 100 },
          hitRegionsByState: {
            active: [
              {
                interactionId: "right",
                semanticNodeId: "button-right",
                bounds: { x: 10, y: 20, width: 30, height: 40 },
                priority: 2,
              },
            ],
            idle: [],
          },
        },
      ],
    );
    expect(regions.active).toEqual([
      {
        interactionId: "right",
        semanticNodeId: "button-right",
        bounds: { x: 0.55, y: 0.2, width: 0.15, height: 0.4 },
        priority: 2,
        coordinateSpace: "normalized",
      },
      {
        interactionId: "left",
        semanticNodeId: "button-left",
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        priority: 1,
        coordinateSpace: "normalized",
      },
    ]);
    expect(regions.idle).toEqual([]);
  });
});
