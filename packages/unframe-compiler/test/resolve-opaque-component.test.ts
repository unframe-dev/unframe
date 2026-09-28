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
  version: 1,
  props: {
    title: { kind: "string", required: true },
    subtitle: { kind: "string", default: "Default" },
  },
  surface: { logicalSize: [800, 450] },
  semantics: {
    rootNodeIds: ["heading", "paragraph"],
    nodes: {
      heading: {
        role: "heading",
        level: 1,
        parentId: null,
        order: 0,
        text: { kind: "prop-ref", name: "title" },
      },
      paragraph: {
        role: "paragraph",
        parentId: null,
        order: 1,
        text: { kind: "prop-ref", name: "subtitle" },
      },
    },
  },
});
const manifest = buildOpaqueComponentManifest(metadata, "hero.component.tsx#render");
const lock = {
  mode: "opaque",
  origin: {
    kind: "local",
    entryFile: "hero.component.tsx",
    files: [{ path: "hero.component.tsx", hash: "sha256:source" }],
    sourceHash: "sha256:source",
  },
  manifestHash: "sha256:manifest",
  rendererInputHash: "sha256:renderer",
};
const item = (id: string, props: Record<string, string> = { title: "Hello" }) => ({
  id,
  component: { id: "hero", version: 1 },
  props,
  owner: { kind: "presentation" },
  audience: { kind: "all" },
  parent: { kind: "stage" },
  physicalSizeMeters: [1.6, 0.9],
  fit: "contain",
  transform: { position: [0, 1, -2], rotation: [0, 0, 0, 2], scale: [1, 1, 1] },
});
const project = (scene: ReturnType<typeof item>[]) => ({
  presentation: {
    id: "deck",
    metadata: { title: "Deck" },
    stage: {
      coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
      size: [4, 3, 4],
    },
    theme: { themeId: standardComponents.theme.id },
    scene,
    assets: [],
    operations: [],
    flow: {
      initialGroupId: "main",
      groups: {
        main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
      },
      variables: {},
    },
  },
  themes: [{ declaration: standardComponents.theme, hash: "sha256:theme" }],
  components: [
    {
      manifest,
      metadata,
      rendererEntry: "hero.component.tsx#render",
      rendererSource: "export default () => null",
      lock,
    },
  ],
  assets: {},
});

describe("Opaque React lowering", () => {
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
    if (!first.valid || !reordered.valid) return;
    const surfaceId = reactResourceId("surface", "one");
    const hostId = reactResourceId("host", "one");
    const semanticId = reactResourceId("semantic", "one", "heading");
    const surface = first.value.definition.scene.surfaces[surfaceId]!;
    expect(surface.hostNodeId).toBe(hostId);
    expect(surface.content).toEqual({
      kind: "opaque",
      bindings: {
        "node:heading": semanticId,
        "node:paragraph": reactResourceId("semantic", "one", "paragraph"),
      },
    });
    const heading = surface.baseSemanticTree.nodes[semanticId];
    expect(heading?.role).toBe("heading");
    if (heading?.role === "heading") expect(heading.text).toBe("Hello");
    expect(first.value.definition.scene.nodes[hostId]?.transform.rotation).toEqual([0, 0, 0, 1]);
    expect(reordered.value.definition.scene.surfaces[surfaceId]).toEqual(surface);
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
      project([item("one", { title: "Hello", extra: "no" })]),
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
      if (!result.valid) expect(result.diagnostics.map((item) => item.code)).toContain(code);
    }
  });
});
