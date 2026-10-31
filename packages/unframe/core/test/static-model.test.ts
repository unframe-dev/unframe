import type { PresentationDefinition, RenderBundle } from "@unframe/contracts/presentation";
import { describe, expect, it } from "vitest";

import definitionFixture from "../../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../../contracts/presentation/fixtures/render-bundle.json";
import {
  canonicalizePresentationDefinition,
  hashCanonicalJsonPayload,
  hashPresentationDefinition,
  validatePresentationArtifacts,
  validatePresentationDefinition,
  validateRenderBundle,
} from "../src/index.js";
import { makeM3AArtifacts } from "./fixtures.js";

const makeStaticModelArtifacts = () => {
  const artifacts = makeM3AArtifacts();
  const fullDefinition = structuredClone(definitionFixture) as unknown as PresentationDefinition;
  const fullBundle = structuredClone(bundleFixture) as unknown as RenderBundle;
  artifacts.definition.scene.nodes.model = fullDefinition.scene.nodes.model!;
  artifacts.renderBundle.models = fullBundle.models;
  artifacts.renderBundle.definitionHash = hashCanonicalJsonPayload(artifacts.definition);
  return artifacts;
};

describe("static Model artifacts", () => {
  it.each([false, true])("validates and hashes static Models with model-only=%s", (modelOnly) => {
    const { definition, renderBundle } = makeStaticModelArtifacts();
    if (modelOnly) {
      delete definition.scene.nodes["node-baked"];
      definition.scene.surfaces = {};
      renderBundle.surfaces = {};
      renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
    }

    expect(validatePresentationDefinition(definition)).toMatchObject({ valid: true });
    expect(canonicalizePresentationDefinition(definition)).toMatchObject({ valid: true });
    expect(hashPresentationDefinition(definition)).toEqual({
      valid: true,
      value: hashCanonicalJsonPayload(definition),
      diagnostics: [],
    });
    expect(validateRenderBundle(renderBundle)).toMatchObject({ valid: true });
    expect(validatePresentationArtifacts(definition, renderBundle)).toMatchObject({ valid: true });
  });

  it("rejects a Model Node without its compiled model entry", () => {
    const { definition, renderBundle } = makeStaticModelArtifacts();
    renderBundle.models = {};

    expect(validatePresentationArtifacts(definition, renderBundle)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "reference.invalid", path: ["scene", "nodes", "model", "assetId"] }],
    });
  });

  it("validates Model clip actions in the default execution subset", () => {
    const { definition } = makeStaticModelArtifacts();
    const fullDefinition = structuredClone(definitionFixture) as unknown as PresentationDefinition;
    const clipCue = fullDefinition.flow.groups.intro!.steps.start!.cues.find((cue) =>
      cue.actions.some((action) => action.kind === "modelClip.play"),
    );
    expect(clipCue).toBeDefined();
    definition.flow.groups.intro!.steps.start!.cues = [clipCue!];

    expect(validatePresentationDefinition(definition)).toMatchObject({ valid: true });
  });
});

describe("Model clip artifact references", () => {
  it.each(["action", "trigger"] as const)(
    "rejects an unknown clip in a %s only when the compiled catalog is available",
    (referenceKind) => {
      const { definition, renderBundle } = makeStaticModelArtifacts();
      const cue = {
        id: "clip-reference",
        priority: 0,
        order: 0,
        trigger:
          referenceKind === "trigger"
            ? { kind: "modelClipCompleted" as const, nodeId: "model", clipId: "missing" }
            : {
                kind: "logicalInput" as const,
                action: "next",
                actor: { kind: "presenter" as const },
              },
        firePolicy: { kind: "oncePerStepEntry" as const },
        actions:
          referenceKind === "action"
            ? [
                {
                  kind: "modelClip.play" as const,
                  nodeId: "model",
                  clipId: "missing",
                  speed: 1,
                  loop: false,
                  completion: "nonBlocking" as const,
                  transition: { kind: "immediate" as const },
                  conflict: "reject" as const,
                },
              ]
            : [],
        next: { kind: "stay" as const },
      };
      definition.flow.groups.intro!.steps.start!.cues = [cue];
      renderBundle.definitionHash = hashCanonicalJsonPayload(definition);

      expect(validatePresentationDefinition(definition)).toMatchObject({ valid: true });
      expect(validatePresentationArtifacts(definition, renderBundle)).toMatchObject({
        valid: false,
        diagnostics: [
          {
            code: "reference.invalid",
            path: [
              "flow",
              "groups",
              "intro",
              "steps",
              "start",
              "cues",
              "0",
              ...(referenceKind === "action" ? ["actions", "0"] : ["trigger"]),
              "clipId",
            ],
          },
        ],
      });
    },
  );

  it("reports a missing compiled model even when its Asset ID is an Object prototype member", () => {
    const { definition, renderBundle } = makeStaticModelArtifacts();
    const node = definition.scene.nodes.model!;
    if (node.kind !== "model") throw new Error("Expected Model fixture.");
    node.assetId = "toString";
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "clip-reference",
        priority: 0,
        order: 0,
        trigger: { kind: "modelClipCompleted", nodeId: "model", clipId: "wave" },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
    renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
    expect(validatePresentationArtifacts(definition, renderBundle)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "reference.invalid", path: ["scene", "nodes", "model", "assetId"] }],
    });
  });

  it("accepts catalog-backed play and completion references", () => {
    const { definition, renderBundle } = makeStaticModelArtifacts();
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "clip-reference",
        priority: 0,
        order: 0,
        trigger: { kind: "modelClipCompleted", nodeId: "model", clipId: "wave" },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          {
            kind: "modelClip.play",
            nodeId: "model",
            clipId: "wave",
            speed: 1,
            loop: false,
            completion: "nonBlocking",
            transition: { kind: "immediate" },
            conflict: "reject",
          },
        ],
        next: { kind: "stay" },
      },
    ];
    renderBundle.definitionHash = hashCanonicalJsonPayload(definition);

    expect(validatePresentationArtifacts(definition, renderBundle)).toMatchObject({
      valid: true,
      diagnostics: [],
    });
  });
});
