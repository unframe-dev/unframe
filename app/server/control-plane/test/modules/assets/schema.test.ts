import { describe, expect, it } from "vitest";
import { assetInitInputSchema } from "../../../src/modules/assets/schema";

const valid = {
  presentationId: "presentation-1",
  name: "scene.glb",
  mediaType: "model/gltf-binary",
  sizeBytes: 1024,
  sha256Hex: "a".repeat(64),
};

describe("asset init input", () => {
  it("accepts supported media within the size limits", () => {
    expect(assetInitInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["unsupported media", { ...valid, mediaType: "application/pdf" }],
    ["too small", { ...valid, sizeBytes: 0 }],
    ["too large", { ...valid, sizeBytes: 50 * 1024 * 1024 + 1 }],
    ["uppercase checksum", { ...valid, sha256Hex: "A".repeat(64) }],
    ["short checksum", { ...valid, sha256Hex: "a".repeat(63) }],
  ])("rejects %s", (_name, input) => {
    expect(assetInitInputSchema.safeParse(input).success).toBe(false);
  });
});
