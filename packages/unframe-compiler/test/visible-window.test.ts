import { describe, expect, it } from "vitest";

import definitionFixture from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import type { SemanticSurface } from "@unframe/unframe-core";
import { SUPPORTED_RENDERER_CONTRACT_VERSION } from "@unframe/unframe-renderer-api";
import { planSurfacePartitions } from "../src/api/plan-surface-partitions.js";

const renderer = {
  id: "baked-web",
  version: "2",
  contractVersion: SUPPORTED_RENDERER_CONTRACT_VERSION,
  implementationHash: "sha256:test",
};

const plan = (
  fit: "contain" | "stretch" | "cover",
  physicalSizeMeters: [number, number],
  logicalSize?: [number, number],
) => {
  const base = structuredClone(
    definitionFixture.scene.surfaces.baked,
  ) as unknown as SemanticSurface;
  const surface: SemanticSurface = {
    ...base,
    fit,
    physicalSizeMeters,
    logicalSize: logicalSize ?? base.logicalSize,
  };
  return planSurfacePartitions(surface, renderer);
};

describe("Surface visible window with finite extreme dimensions", () => {
  it.each(["contain", "stretch"] as const)("keeps the full logical window for %s", (fit) => {
    const result = plan(fit, [1e-323, 2e-323]);
    expect(result.valid).toBe(true);
    if (result.valid)
      expect(result.value.partitions[0]?.plan.logicalBounds).toEqual({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
  });

  it("crops cover by aspect ratio without underflowing the physical scale", () => {
    const result = plan("cover", [1e-323, 2e-323]);
    expect(result.valid).toBe(true);
    if (result.valid)
      expect(result.value.partitions[0]?.plan.logicalBounds).toEqual({
        x: 25,
        y: 0,
        width: 50,
        height: 100,
      });
  });

  it("crops cover at an ordinary finite aspect ratio", () => {
    const result = plan("cover", [2, 1]);
    expect(result.valid).toBe(true);
    if (result.valid)
      expect(result.value.partitions[0]?.plan.logicalBounds).toEqual({
        x: 0,
        y: 25,
        width: 100,
        height: 50,
      });
  });

  it.each([
    [1e308, 1e-323],
    [1e-323, 1e308],
  ])("reports a cover crop narrower than representable logical geometry", (width, height) => {
    const result = plan("cover", [width, height]);
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [
        expect.objectContaining({ code: "compiler-partition-geometry-unrepresentable" }),
      ],
    });
  });

  it("reports a logical window too small to compute a finite pixel scale", () => {
    const result = plan("stretch", [1, 1], [Number.MIN_VALUE, Number.MIN_VALUE]);
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [
        expect.objectContaining({ code: "compiler-partition-geometry-unrepresentable" }),
      ],
    });
  });
});
