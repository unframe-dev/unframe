import { describe, expect, it } from "vitest";
import { createPreviewScene } from "./scene";
import {
  advancePreview,
  createPreviewState,
  dispatchPreviewAction,
  previewActions,
  previewFrame,
} from "./runtime";
import { makePreviewFixture } from "./fixture.test-helper";
import type { PreviewDocument } from "./types";

function documentWithScene(
  artifacts: ReturnType<typeof makePreviewFixture>["artifacts"],
): PreviewDocument {
  return {
    artifacts,
    scene: createPreviewScene(
      artifacts,
      new Map([
        ["texture", "blob:one"],
        ["texture2", "blob:two"],
      ]),
    ),
    dispose() {},
  };
}

describe("preview projection", () => {
  it.each([
    ["contain", [1, 1], [0, 0, 1, 1]],
    ["cover", [2, 1], [0, 0.25, 1, 0.75]],
    ["stretch", [2, 1], [0, 0, 1, 1]],
  ] as const)("fits a baked quad with %s", (fit, size, uvRect) => {
    const { artifacts } = makePreviewFixture();
    const surface = artifacts.definition.scene.surfaces["baked"]!;
    surface.fit = fit;
    surface.physicalSizeMeters = [2, 1];

    const scene = createPreviewScene(artifacts, new Map([["texture", "blob:one"]]));

    expect(scene.quads[0]).toMatchObject({ size, uvRect });
  });

  it("omits a partition fully clipped by cover from scene and frame", () => {
    const { artifacts } = makePreviewFixture();
    const surface = artifacts.definition.scene.surfaces["baked"]!;
    surface.fit = "cover";
    surface.physicalSizeMeters = [2, 1];
    artifacts.renderBundle.surfaces["baked"]!.renderSurfaces["render-baked"]!.logicalBounds = {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
    };
    const document = documentWithScene(artifacts);

    expect(document.scene.quads).toEqual([]);
    expect(previewFrame(document, createPreviewState(document), 1).quads).toEqual([]);
  });

  it("mixes outgoing and incoming textures in one quad during crossfade", () => {
    const { artifacts } = makePreviewFixture();
    const surface = artifacts.definition.scene.surfaces["baked"]!;
    surface.states["other"] = { ...structuredClone(surface.states["default"]!), id: "other" };
    const compiled = artifacts.renderBundle.surfaces["baked"]!;
    const renderSurface = compiled.renderSurfaces["render-baked"]!;
    const baked = renderSurface.artifacts["artifact-baked"]!;
    if (baked.kind !== "baked-web") throw new Error("Expected baked fixture.");
    baked.states["other"] = {
      stateId: "other",
      texture: { ...baked.states["default"]!.texture, assetId: "texture2" },
    };
    renderSurface.stateBindings["other"] = { kind: "artifacts", artifactIds: ["artifact-baked"] };
    compiled.semanticsByState["other"] = structuredClone(compiled.semanticsByState["default"]!);
    compiled.interactionsByState["other"] = [];
    artifacts.definition.flow.groups["intro"]!.steps["start"]!.cues = [
      {
        id: "switch",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          {
            kind: "surface.setState",
            surfaceId: "baked",
            stateId: "other",
            transition: {
              kind: "crossfade",
              durationMilliseconds: 1000,
              easing: "linear",
              completion: "blocking",
            },
          },
        ],
        next: { kind: "stay" },
      },
    ];
    const document = documentWithScene(artifacts);
    const initial = createPreviewState(document);
    const switched = dispatchPreviewAction(
      document,
      initial,
      previewActions(document, initial)[0]!.input,
    );
    const halfway = advancePreview(document, switched, 500);
    const middleQuads = previewFrame(document, halfway, 2).quads;

    expect(middleQuads).toHaveLength(2);
    expect(middleQuads[0]).toMatchObject({
      visible: true,
      opacity: 1,
      blendTextureId: "texture2",
      blendWeight: 0.5,
    });
    expect(middleQuads[1]).toMatchObject({ visible: false, opacity: 0 });
    const finished = advancePreview(document, halfway, 1000);
    expect(previewFrame(document, finished, 3).quads).toMatchObject([
      { visible: false, opacity: 0 },
      { visible: true, opacity: 1 },
    ]);
  });

  it("offers enabled semantic buttons and applies the Cue state change", () => {
    const { artifacts } = makePreviewFixture();
    const surface = artifacts.definition.scene.surfaces["baked"]!;
    surface.states["default"]!.enabledInteractionIds = ["continue"];
    surface.states["other"] = {
      ...structuredClone(surface.states["default"]!),
      id: "other",
      enabledInteractionIds: [],
    };
    const compiled = artifacts.renderBundle.surfaces["baked"]!;
    const renderSurface = compiled.renderSurfaces["render-baked"]!;
    const baked = renderSurface.artifacts["artifact-baked"]!;
    if (baked.kind !== "baked-web") throw new Error("Expected baked fixture.");
    baked.states["other"] = { ...structuredClone(baked.states["default"]!), stateId: "other" };
    renderSurface.stateBindings["other"] = { kind: "artifacts", artifactIds: ["artifact-baked"] };
    compiled.semanticsByState["default"]!.nodes["button"] = {
      id: "button",
      parentId: null,
      order: 1,
      role: "button",
      text: "Continue",
      stateEnabled: true,
      interactionId: "continue",
    };
    compiled.semanticsByState["default"]!.rootNodeIds.push("button");
    compiled.semanticsByState["other"] = structuredClone(compiled.semanticsByState["default"]!);
    compiled.interactionsByState["other"] = [];
    artifacts.definition.flow.groups["intro"]!.steps["start"]!.cues = [
      {
        id: "continue",
        priority: 0,
        order: 0,
        trigger: {
          kind: "surfaceInteraction",
          surfaceId: "baked",
          interactionId: "continue",
          actor: { kind: "presenter" },
        },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [{ kind: "surface.setState", surfaceId: "baked", stateId: "other" }],
        next: { kind: "stay" },
      },
    ];
    const document = documentWithScene(artifacts);
    const initial = createPreviewState(document);

    const actions = previewActions(document, initial);
    expect(actions).toMatchObject([{ label: "Continue" }]);
    const next = dispatchPreviewAction(document, initial, actions[0]!.input);
    expect(next.surfaces["baked"]).toBe("other");
    expect(previewActions(document, next)).toEqual([]);
    expect(previewFrame(document, next, 2).quads).toMatchObject([
      { visible: false },
      { visible: true },
    ]);
  });
});
