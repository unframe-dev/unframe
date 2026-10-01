import { describe, expect, it } from "vitest";
import { SUPPORTED_RENDERER_CONTRACT_VERSION } from "@unframe/unframe-renderer-api";
import { opaquePartitionIdentity } from "../src/api/opaque-partition-identity.js";

describe("opaquePartitionIdentity", () => {
  const bounds = { x: 0, y: 0, width: 100, height: 50 };
  const renderer = {
    id: "baked-web",
    version: "1",
    contractVersion: SUPPORTED_RENDERER_CONTRACT_VERSION,
    implementationHash: "sha256:renderer-a",
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
      kind: "opaque",
      entryId: "surface",
      moduleHash: "sha256:module-a",
    });
    expect(changedModule.id).not.toBe(initial.id);
    expect(changedRenderer.id).not.toBe(initial.id);
    expect(changedModule.partitionRendererKey).not.toBe(initial.partitionRendererKey);
    expect(changedRenderer.partitionRendererKey).not.toBe(initial.partitionRendererKey);
  });
});
