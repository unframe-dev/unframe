import { assert, describe, expect, it } from "vitest";
import { standardComponents } from "@unframe/unframe-components";
import {
  buildOpaqueComponentManifest,
  validateStaticComponentMetadata,
} from "@unframe/unframe-authoring";
import { checkDeclarationProject } from "../src/api/check-declaration-project.js";
import { reactResourceId } from "../src/resolution/resolve-opaque-component.js";

const metadata = validateStaticComponentMetadata({
  id: "hero",
  props: {
    subtitle: { default: "Default", kind: "string" },
    title: { kind: "string", required: true },
  },
  semantics: {
    nodes: {
      heading: {
        level: 1,
        order: 0,
        parentId: null,
        role: "heading",
        text: { kind: "prop-ref", name: "title" },
      },
      paragraph: {
        order: 1,
        parentId: null,
        role: "paragraph",
        text: { kind: "prop-ref", name: "subtitle" },
      },
    },
    rootNodeIds: ["heading", "paragraph"],
  },
  surface: { logicalSize: [800, 450] },
  version: 1,
});
const manifest = buildOpaqueComponentManifest(metadata, "hero.component.tsx#render");
const lock = {
  manifestHash: "sha256:manifest",
  mode: "opaque",
  origin: {
    entryFile: "hero.component.tsx",
    files: [{ hash: "sha256:source", path: "hero.component.tsx" }],
    kind: "local",
    sourceHash: "sha256:source",
  },
  rendererInputHash: "sha256:renderer",
};
const item = (id: string, props: Record<string, string> = { title: "Hello" }) => ({
  audience: { kind: "all" },
  component: { id: "hero", version: 1 },
  fit: "contain",
  id,
  owner: { kind: "presentation" },
  parent: { kind: "stage" },
  physicalSizeMeters: [1.6, 0.9],
  props,
  transform: { position: [0, 1, -2], rotation: [0, 0, 0, 2], scale: [1, 1, 1] },
});
const project = (scene: Array<ReturnType<typeof item>>) => ({
  assets: {},
  components: [
    {
      lock,
      manifest,
      metadata,
      rendererEntry: "hero.component.tsx#render",
      rendererSource: "export default () => null",
    },
  ],
  presentation: {
    assets: [],
    flow: {
      groups: {
        main: { id: "main", initialStepId: "first", steps: { first: { cues: [], id: "first" } } },
      },
      initialGroupId: "main",
      variables: {},
    },
    id: "deck",
    metadata: { title: "Deck" },
    operations: [],
    scene,
    stage: {
      coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
      size: [4, 3, 4],
    },
    theme: { themeId: standardComponents.theme.id },
  },
  themes: [{ declaration: standardComponents.theme, hash: "sha256:theme" }],
});

describe("Opaque React lowering", () => {
  it("lowers finite State, button Interaction and Output-to-Action Cue", () => {
    const finiteMetadata = validateStaticComponentMetadata({
      ...metadata,
      actions: {
        reveal: {
          effects: [{ kind: "setState", stateId: "revealed" }],
          inputs: {},
          preconditions: [],
        },
      },
      initialState: "hidden",
      interactions: { reveal: { event: "quiz.reveal", hitPriority: 0, kind: "click" } },
      outputs: {
        revealRequested: {
          payload: {},
          producer: { interactionId: "reveal", kind: "surfaceInteraction" },
        },
      },
      semantics: {
        nodes: {
          button: {
            interactionId: "reveal",
            order: 1,
            parentId: null,
            role: "button",
            text: "Reveal",
          },
          heading: metadata.semantics.nodes.heading,
        },
        rootNodeIds: ["heading", "button"],
      },
      states: {
        hidden: {
          enabledInteractionIds: ["reveal"],
          semanticOverrides: [{ id: "hide-heading", included: false, targetId: "heading" }],
        },
        revealed: { enabledInteractionIds: [], semanticOverrides: [] },
      },
    });
    const input = project([item("quiz")]);
    expect(
      buildOpaqueComponentManifest(
        validateStaticComponentMetadata(finiteMetadata),
        "hero.component.tsx#render",
      ),
    ).toEqual(buildOpaqueComponentManifest(finiteMetadata, "hero.component.tsx#render"));
    const cue = {
      actions: [
        {
          actionId: "reveal",
          arguments: {},
          componentInstanceId: "quiz",
          kind: "component.action",
        },
      ],
      id: "show",
      trigger: {
        componentInstanceId: "quiz",
        kind: "component.output",
        outputId: "revealRequested",
      },
    };
    const result = checkDeclarationProject({
      ...input,
      components: [
        {
          ...input.components[0],
          manifest: buildOpaqueComponentManifest(finiteMetadata, "hero.component.tsx#render"),
          metadata: finiteMetadata,
        },
      ],
      presentation: {
        ...input.presentation,
        flow: {
          ...input.presentation.flow,
          groups: {
            main: {
              id: "main",
              initialStepId: "first",
              steps: { first: { cues: [cue], id: "first" } },
            },
          },
        },
      },
    });
    if (!result.valid) {
      throw new Error(JSON.stringify(result.diagnostics));
    }
    const surface = result.value.definition.scene.surfaces[reactResourceId("surface", "quiz")]!;
    expect(surface.initialStateId).toBe(reactResourceId("state", "quiz", "hidden"));
    expect(
      surface.baseSemanticTree.nodes[reactResourceId("semantic", "quiz", "button")],
    ).toMatchObject({
      interactionId: reactResourceId("interaction", "quiz", "reveal"),
      role: "button",
    });
    expect(
      surface.states[reactResourceId("state", "quiz", "hidden")]?.semanticOverrides[0],
    ).toMatchObject({
      nodes: { [reactResourceId("semantic", "quiz", "heading")]: { included: false } },
    });
    expect(result.value.definition.flow.groups.main?.steps.first?.cues[0]).toMatchObject({
      actions: [
        { kind: "surface.setState", stateId: reactResourceId("state", "quiz", "revealed") },
      ],
      trigger: {
        interactionId: reactResourceId("interaction", "quiz", "reveal"),
        kind: "surfaceInteraction",
      },
    });
  });
  it("accepts an Opaque project without a selected Theme or Theme catalog", () => {
    const input = project([item("one")]);
    const { theme: _theme, ...presentation } = input.presentation;
    const result = checkDeclarationProject({ ...input, presentation, themes: [] });
    expect(result.valid).toBe(true);
  });

  it("rejects an explicitly selected Theme that does not resolve", () => {
    const result = checkDeclarationProject({ ...project([item("one")]), themes: [] });
    assert(!result.valid);
    expect(result.diagnostics.map((item) => item.code)).toContain("compiler-theme-not-found");
  });

  it("creates a Core-valid Surface and stable IDs independent of scene order", () => {
    const first = checkDeclarationProject(project([item("one"), item("two")]));
    const reordered = checkDeclarationProject(project([item("two"), item("one")]));
    expect(first.valid).toBe(true);
    expect(reordered.valid).toBe(true);
    if (!first.valid || !reordered.valid) {
      return;
    }
    const surfaceId = reactResourceId("surface", "one");
    const hostId = reactResourceId("host", "one");
    const semanticId = reactResourceId("semantic", "one", "heading");
    const surface = first.value.definition.scene.surfaces[surfaceId]!;
    expect(surface.hostNodeId).toBe(hostId);
    expect(surface.content).toEqual({
      bindings: {
        "node:heading": semanticId,
        "node:paragraph": reactResourceId("semantic", "one", "paragraph"),
      },
      kind: "opaque",
    });
    const heading = surface.baseSemanticTree.nodes[semanticId];
    expect(heading?.role).toBe("heading");
    if (heading?.role === "heading") {
      expect(heading.text).toBe("Hello");
    }
    expect(first.value.definition.scene.nodes[hostId]?.transform.rotation).toEqual([0, 0, 0, 1]);
    expect(reordered.value.definition.scene.surfaces[surfaceId]).toEqual(surface);
    expect(Object.keys(reordered.value.definition.scene.surfaces).sort()).toEqual(
      Object.keys(first.value.definition.scene.surfaces).sort(),
    );
    expect(Object.keys(reordered.value.definition.scene.nodes).sort()).toEqual(
      Object.keys(first.value.definition.scene.nodes).sort(),
    );
    expect(reactResourceId("host", "one")).toMatch(/^r:[0-9a-f]{64}$/);
  });

  it("rejects missing required props and duplicate Instance IDs", () => {
    const missing = checkDeclarationProject(project([item("one", {})]));
    const duplicate = checkDeclarationProject(project([item("one"), item("one")]));
    expect(missing.valid).toBe(false);
    expect(duplicate.valid).toBe(false);
    if (!missing.valid && !duplicate.valid) {
      expect(missing.diagnostics.map((item) => item.code)).toContain(
        "compiler-required-prop-missing",
      );
      expect(duplicate.diagnostics.map((item) => item.code)).toContain(
        "compiler-duplicate-component-instance-id",
      );
    }
  });

  it("rejects unknown props, invalid rotation, and a mismatched static contract", () => {
    const unknown = checkDeclarationProject(
      project([item("one", { extra: "no", title: "Hello" })]),
    );
    const badRotation = project([item("one")]);
    badRotation.presentation.scene[0]!.transform.rotation = [0, 0, 0, 0];
    const rotation = checkDeclarationProject(badRotation);
    const mismatched = project([item("one")]);
    mismatched.components[0]!.rendererEntry = "other.component.tsx#render";
    const contract = checkDeclarationProject(mismatched);
    for (const [result, code] of [
      [unknown, "compiler-prop-not-found"],
      [rotation, "compiler-invalid-quaternion"],
      [contract, "compiler-opaque-contract-mismatch"],
    ] as const) {
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.diagnostics.map((item) => item.code)).toContain(code);
      }
    }
  });
});
