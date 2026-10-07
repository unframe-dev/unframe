import { assert, describe, expect, it } from "vitest";

import { hashCanonicalJsonPayload, validateRenderBundle } from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

describe("partition State bindings", () => {
  it("accepts a partition with a texture in one State and an explicit empty State", () => {
    const { renderBundle } = makeM3AArtifacts();
    const surface = renderBundle.surfaces.baked!;
    surface.semanticsByState.hidden = structuredClone(surface.semanticsByState.default!);
    surface.interactionsByState.hidden = [];
    const partition = surface.renderSurfaces[surface.renderSurfaceIds[0]!]!;
    partition.stateBindings.hidden = { kind: "empty" };

    expect(validateRenderBundle(renderBundle)).toMatchObject({ valid: true });
  });

  it("accepts a Surface with no visible paint and no partitions", () => {
    const { renderBundle } = makeM3AArtifacts();
    const surface = renderBundle.surfaces.baked!;
    surface.renderSurfaceIds = [];
    surface.renderSurfaces = {};

    expect(validateRenderBundle(renderBundle)).toMatchObject({ valid: true });
  });

  it("rejects a partition empty in every State", () => {
    const { renderBundle } = makeM3AArtifacts();
    const surface = renderBundle.surfaces.baked!;
    const partition = surface.renderSurfaces[surface.renderSurfaceIds[0]!]!;
    partition.stateBindings.default = { kind: "empty" };
    partition.artifacts = {};

    expect(validateRenderBundle(renderBundle)).toMatchObject({ valid: false });
  });

  it("rejects textures retained for an empty State", () => {
    const { renderBundle } = makeM3AArtifacts();
    const surface = renderBundle.surfaces.baked!;
    const partition = surface.renderSurfaces[surface.renderSurfaceIds[0]!]!;
    partition.stateBindings.default = { kind: "empty" };

    expect(validateRenderBundle(renderBundle)).toMatchObject({ valid: false });
  });

  it("rejects an unreferenced artifact", () => {
    const { renderBundle } = makeM3AArtifacts();
    const surface = renderBundle.surfaces.baked!;
    const partition = surface.renderSurfaces[surface.renderSurfaceIds[0]!]!;
    const artifact = Object.values(partition.artifacts)[0]!;
    partition.artifacts.orphan = { ...structuredClone(artifact), id: "orphan" };

    expect(validateRenderBundle(renderBundle)).toMatchObject({ valid: false });
  });

  it("counts a shared texture once against the encoded output budget across partitions", () => {
    const { renderBundle } = makeM3AArtifacts();
    const surface = renderBundle.surfaces.baked!;
    const original = surface.renderSurfaces[surface.renderSurfaceIds[0]!]!;
    const artifact = Object.values(original.artifacts)[0]!;
    const second = {
      ...structuredClone(original),
      id: "second",
      layer: 1,
      artifacts: { repeated: { ...structuredClone(artifact), id: "repeated" } },
      stateBindings: { default: { kind: "artifacts" as const, artifactIds: ["repeated"] } },
    };
    surface.renderSurfaceIds.push(second.id);
    surface.renderSurfaces.second = second;
    const policy = renderBundle.buildContext.textureBuildPolicy;
    const { policyHash: _previousHash, ...payload } = policy;
    payload.maxBuildOutputBytes = 64;
    renderBundle.buildContext.textureBuildPolicy = {
      ...payload,
      policyHash: hashCanonicalJsonPayload(payload),
    };

    expect(validateRenderBundle(renderBundle)).toMatchObject({ valid: true });
  });

  it("rejects conflicting byte sizes for the same texture checksum across States", () => {
    const { renderBundle } = makeM3AArtifacts();
    const surface = renderBundle.surfaces.baked!;
    const partition = surface.renderSurfaces[surface.renderSurfaceIds[0]!]!;
    const artifact = Object.values(partition.artifacts)[0]!;
    assert(artifact.kind === "baked-web");
    surface.semanticsByState.second = structuredClone(surface.semanticsByState.default!);
    surface.interactionsByState.second = [];
    partition.stateBindings.second = { kind: "artifacts", artifactIds: [artifact.id] };
    artifact.states.second = {
      ...structuredClone(artifact.states.default!),
      stateId: "second",
      texture: { ...artifact.states.default!.texture, encodedSizeBytes: 65 },
    };

    expect(validateRenderBundle(renderBundle)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "artifact.invalid" })]),
    });
  });
});
