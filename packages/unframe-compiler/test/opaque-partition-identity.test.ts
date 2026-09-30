import { describe, expect, it } from "vitest";
import { opaquePartitionIdentity } from "../src/api/opaque-partition-identity.js";

describe("opaquePartitionIdentity", () => {
  const bounds = { height: 50, width: 100, x: 0, y: 0 };
  const renderer = {
    contractVersion: "1",
    id: "baked-web",
    implementationHash: "sha256:renderer-a",
    version: "1",
  };

  it("derives a whole-entry identity that changes with module and renderer implementation", () => {
    const initial = opaquePartitionIdentity("surface", bounds, renderer, "sha256:module-a");
    const changedModule = opaquePartitionIdentity("surface", bounds, renderer, "sha256:module-b");
    const changedRenderer = opaquePartitionIdentity(
      "surface",
      bounds,
      { ...renderer, implementationHash: "sha256:renderer-b" },
      "sha256:module-a",
    );

    expect(initial.id).toMatch(/^rs_[0-9a-f]{64}$/);
    expect(opaquePartitionIdentity("surface", bounds, renderer, "sha256:module-a")).toEqual(
      initial,
    );
    expect(initial.descriptor.renderer.entry).toEqual({
      entryId: "surface",
      kind: "opaque",
      moduleHash: "sha256:module-a",
    });
    expect(changedModule.id).not.toBe(initial.id);
    expect(changedRenderer.id).not.toBe(initial.id);
    expect(changedModule.partitionRendererKey).not.toBe(initial.partitionRendererKey);
    expect(changedRenderer.partitionRendererKey).not.toBe(initial.partitionRendererKey);
  });
});
