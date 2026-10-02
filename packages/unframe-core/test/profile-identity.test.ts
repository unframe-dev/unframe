import { describe, expect, it } from "vitest";
import { calculateProjectionProfileId } from "../src/delivery/profile-identity.js";

const descriptor = {
  projectionProfileId: "ignored",
  key: {
    publication: {
      presentationId: "presentation",
      publicationEpoch: "2",
      publicationManifestHash: `sha256:${"a".repeat(64)}`,
    },
    projectionContractVersion: 1,
    role: 1,
    capabilityProfileId: "quest",
  },
  visibleNodeIds: ["a", "b"],
  visibleSurfaceIds: [],
  visibleVariableIds: [],
  renderSurfaces: [],
  semanticSurfaces: [],
  localOverlays: [],
  requiredRuntimeCapabilities: [1],
  runtimeCatalog: {
    catalogContractVersion: 2,
    nodes: [],
    surfaces: [],
    variables: [],
    timelines: [],
    modelClips: [],
  },
};

describe("Projection profile identity", () => {
  it("hashes the descriptor without its own identity", () => {
    const id = calculateProjectionProfileId(descriptor);
    expect(id).toMatch(/^pp_[0-9a-f]{64}$/);
    expect(calculateProjectionProfileId({ ...descriptor, projectionProfileId: "different" })).toBe(
      id,
    );
    expect(
      calculateProjectionProfileId({ ...descriptor, key: { ...descriptor.key, role: 2 } }),
    ).not.toBe(id);
  });

  it("rejects unknown fields and noncanonical repeated sets", () => {
    expect(() => calculateProjectionProfileId({ ...descriptor, participantId: "private" })).toThrow(
      "unknown field",
    );
    expect(() =>
      calculateProjectionProfileId({ ...descriptor, visibleNodeIds: ["b", "a"] }),
    ).toThrow("canonical order");
    expect(() =>
      calculateProjectionProfileId({ ...descriptor, visibleNodeIds: ["a", "a"] }),
    ).toThrow("canonical order");
  });

  it("rejects unspecified enum values", () => {
    expect(() =>
      calculateProjectionProfileId({ ...descriptor, key: { ...descriptor.key, role: 0 } }),
    ).toThrow("UNSPECIFIED enum");
    expect(() =>
      calculateProjectionProfileId({ ...descriptor, requiredRuntimeCapabilities: [0] }),
    ).toThrow("UNSPECIFIED enum");
  });
});
