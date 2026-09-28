import { describe, expect, it } from "vitest";

import { patchEditableReactScene, readEditableReactScene } from "../src/index.js";
import type { PairedAuthoringDeclarationCatalog } from "../src/project/pair-authoring-declarations.js";

const source = `import { definePresentation } from "@unframe/unframe-authoring";
// Keep this comment and the shared constant.
const sharedTitle = "Shared";
export default definePresentation({
  scene: [
    { id: "first", component: Hero, props: { title: "One", count: 1 }, transform: { position: [-1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    { id: "second", component: Hero, props: { title: "Two", count: 2 }, transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  ],
});`;

const fixture = (text = source, shared = false): PairedAuthoringDeclarationCatalog => {
  const scene = ["first", "second"].map((id, index) => ({
    id,
    component: { id: "hero", version: 1 },
    props: {
      title: shared && index === 0 ? "Shared" : index === 0 ? "One" : "Two",
      count: index + 1,
    },
    transform: { position: [index === 0 ? -1 : 1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  }));
  const sourceMap = scene.map((item, index) => {
    const start = text.indexOf(`{ id: "${item.id}"`);
    const end = text.indexOf("\n", start) - 1;
    return {
      path: ["scene", index],
      origin: { fileName: "presentation.unframe.tsx", start, end, line: 1, column: 1 },
    };
  });
  return {
    presentation: {
      role: "presentation",
      rootBuilder: "definePresentation",
      fileName: "presentation.unframe.tsx",
      value: { scene },
      sourceMap,
    },
    themes: [],
    components: [
      {
        metadata: {
          id: "hero",
          version: 1,
          props: {
            title: { kind: "string", required: true },
            count: { kind: "number", required: true },
          },
        },
      },
    ],
  } as unknown as PairedAuthoringDeclarationCatalog;
};

describe("direct React scene source editing", () => {
  it("exposes published scalar props and full host transforms for independent instances", () => {
    const result = readEditableReactScene(fixture(), source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.instanceId)).toEqual(["first", "second"]);
    expect(result.value[0]?.props.title).toEqual({ kind: "string", value: "One", editable: true });
    expect(result.value[0]?.transform).toEqual({
      position: [-1, 2, 3],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    expect(result.value[0]?.transformEditable).toBe(true);
  });

  it("changes only the selected literal and preserves the other instance and comments", () => {
    const result = patchEditableReactScene(fixture(), source, {
      kind: "setProp",
      instanceId: "first",
      propId: "title",
      value: "Changed",
    });
    expect(result).toEqual({
      ok: true,
      value: source.replace('title: "One"', 'title: "Changed"'),
      diagnostics: [],
    });
  });

  it("patches every transform axis and rejects invalid scale", () => {
    const command = {
      kind: "setTransform" as const,
      instanceId: "second",
      transform: {
        position: [4, 5, 6] as const,
        rotation: [0, 1, 0, 0] as const,
        scale: [2, 3, 4] as const,
      },
    };
    const result = patchEditableReactScene(fixture(), source, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain(
      'id: "second", component: Hero, props: { title: "Two", count: 2 }, transform: { position: [4, 5, 6], rotation: [0, 1, 0, 0], scale: [2, 3, 4] }',
    );
    expect(result.value).toContain(
      'id: "first", component: Hero, props: { title: "One", count: 1 }, transform: { position: [-1, 2, 3]',
    );
    expect(
      patchEditableReactScene(fixture(), source, {
        ...command,
        transform: { ...command.transform, scale: [0, 1, 1] },
      }).ok,
    ).toBe(false);
  });

  it("rejects wrong scalar types and unsupported shared values", () => {
    expect(
      patchEditableReactScene(fixture(), source, {
        kind: "setProp",
        instanceId: "first",
        propId: "count",
        value: "bad",
      }).ok,
    ).toBe(false);
    const sharedSource = source.replace('title: "One"', "title: sharedTitle");
    const metadata = readEditableReactScene(fixture(sharedSource, true), sharedSource);
    expect(metadata.ok).toBe(true);
    if (!metadata.ok) return;
    expect(metadata.value[0]?.props.title?.editable).toBe(false);
    expect(
      patchEditableReactScene(fixture(sharedSource, true), sharedSource, {
        kind: "setProp",
        instanceId: "first",
        propId: "title",
        value: "Changed",
      }).ok,
    ).toBe(false);
  });

  it("marks spread props and shared transforms as unavailable", () => {
    const spreadSource = source.replace(
      'props: { title: "One", count: 1 }',
      'props: { ...sharedProps, title: "One", count: 1 }',
    );
    const spread = readEditableReactScene(fixture(spreadSource), spreadSource);
    expect(spread.ok).toBe(true);
    if (!spread.ok) return;
    expect(spread.value[0]?.props.title?.editable).toBe(false);

    const sharedSource = source.replace(
      "transform: { position: [-1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }",
      "transform: sharedTransform",
    );
    const shared = readEditableReactScene(fixture(sharedSource), sharedSource);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    expect(shared.value[0]?.transformEditable).toBe(false);
  });

  it("requires source positions from the current parsed snapshot", () => {
    const stale = patchEditableReactScene(fixture(), `// outside edit\n${source}`, {
      kind: "setProp",
      instanceId: "first",
      propId: "title",
      value: "Changed",
    });
    expect(stale.ok).toBe(false);
    const fresh = patchEditableReactScene(
      fixture(`// outside edit\n${source}`),
      `// outside edit\n${source}`,
      { kind: "setProp", instanceId: "first", propId: "title", value: "Changed" },
    );
    expect(fresh.ok).toBe(true);
  });
});

it("refuses a direct prop hidden by a later instance spread even when the values match", () => {
  const shadowed = source.replace(
    "count: 1 }, transform:",
    "count: 1 }, ...sharedPlacement, transform:",
  );
  const result = patchEditableReactScene(fixture(shadowed), shadowed, {
    kind: "setProp",
    instanceId: "first",
    propId: "title",
    value: "Changed",
  });
  expect(result.ok).toBe(false);
});
