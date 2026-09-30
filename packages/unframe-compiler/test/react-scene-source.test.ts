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

const fixture = (
  text = source,
  shared = false,
  firstTitle?: string,
  additionalPropId?: string,
): PairedAuthoringDeclarationCatalog => {
  const scene = ["first", "second"].map((id, index) => ({
    id,
    component: { id: "hero", version: 1 },
    props: {
      title:
        index === 0 && firstTitle !== undefined
          ? firstTitle
          : shared && index === 0
            ? "Shared"
            : index === 0
              ? "One"
              : "Two",
      count: index + 1,
      ...(index === 0 && additionalPropId ? { [additionalPropId]: "Shared" } : {}),
    },
    transform: { position: [index === 0 ? -1 : 1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  }));
  const sourceMap = scene.map((item, index) => {
    const start = text.lastIndexOf("    {", text.indexOf(`id: "${item.id}"`)) + 4;
    const end =
      index === 0
        ? text.indexOf('},\n    { id: "second"', start) + 1
        : text.indexOf("},\n  ],", start) + 1;
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
            ...(additionalPropId ? { [additionalPropId]: { kind: "string", required: true } } : {}),
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
    expect(result.value[0]?.props.title).toEqual({
      kind: "string",
      value: "One",
      editable: true,
      inherited: false,
    });
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

  it("rejects wrong scalar types and locally overrides a shared value", () => {
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
    expect(metadata.value[0]?.props.title?.editable).toBe(true);
    expect(metadata.value[0]?.props.title?.inherited).toBe(true);
    expect(metadata.value[0]?.props.title?.inheritanceExpression).toBe("sharedTitle");
    const changed = patchEditableReactScene(fixture(sharedSource, true), sharedSource, {
      kind: "setProp",
      instanceId: "first",
      propId: "title",
      value: "Changed",
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value).toContain('title: "Changed", count: 1');
    expect(changed.value).toContain('const sharedTitle = "Shared";');
    expect(changed.value).toContain('id: "second", component: Hero');
    const restored = patchEditableReactScene(
      fixture(changed.value, true, "Changed"),
      changed.value,
      {
        kind: "restoreProp",
        instanceId: "first",
        propId: "title",
        expression: "sharedTitle",
      },
    );
    expect(restored).toEqual({ ok: true, value: sharedSource, diagnostics: [] });
  });

  it("overrides spread props and shared transforms in one instance", () => {
    const spreadSource = source.replace(
      'props: { title: "One", count: 1 }',
      'props: { ...sharedProps, title: "One", count: 1 }',
    );
    const spread = readEditableReactScene(fixture(spreadSource), spreadSource);
    expect(spread.ok).toBe(true);
    if (!spread.ok) return;
    expect(spread.value[0]?.props.title?.editable).toBe(true);

    const sharedSource = source.replace(
      "transform: { position: [-1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }",
      "transform: sharedTransform",
    );
    const shared = readEditableReactScene(fixture(sharedSource), sharedSource);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    expect(shared.value[0]?.transformEditable).toBe(true);
    expect(shared.value[0]?.transformInherited).toBe(true);
    expect(shared.value[0]?.transformInheritanceExpression).toBe("sharedTransform");
    const changed = patchEditableReactScene(fixture(sharedSource), sharedSource, {
      kind: "setTransform",
      instanceId: "first",
      transform: { position: [4, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value).toContain("transform: { position: [4,2,3]");
    expect(changed.value).toContain('id: "second"');
    expect(
      patchEditableReactScene(fixture(changed.value), changed.value, {
        kind: "restoreTransform",
        instanceId: "first",
        expression: "sharedTransform",
      }),
    ).toEqual({ ok: true, value: sharedSource, diagnostics: [] });
  });

  it("adds a prop after a props spread and restores inheritance", () => {
    const text = source.replace(
      'props: { title: "One", count: 1 }',
      "props: { ...sharedProps, count: 1 }",
    );
    const changed = patchEditableReactScene(fixture(text, true), text, {
      kind: "setProp",
      instanceId: "first",
      propId: "title",
      value: "Changed",
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value).toContain('props: { ...sharedProps, count: 1, title: "Changed" }');
    const restored = patchEditableReactScene(
      fixture(changed.value, true, "Changed"),
      changed.value,
      {
        kind: "inheritProp",
        instanceId: "first",
        propId: "title",
      },
    );
    expect(restored).toEqual({ ok: true, value: text, diagnostics: [] });
  });

  it("adds a transform after a scene spread while preserving the other axes", () => {
    const text = source.replace(
      '{ id: "first", component: Hero, props: { title: "One", count: 1 }, transform: { position: [-1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }',
      '{ ...sharedPlacement, id: "first", component: Hero, props: { title: "One", count: 1 } }',
    );
    const changed = patchEditableReactScene(fixture(text), text, {
      kind: "setTransform",
      instanceId: "first",
      transform: { position: [4, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value).toContain(
      "transform: { position: [4,2,3], rotation: [0,0,0,1], scale: [1,1,1] }",
    );
    expect(changed.value).toContain('id: "second", component: Hero');
    expect(
      patchEditableReactScene(fixture(changed.value), changed.value, {
        kind: "inheritTransform",
        instanceId: "first",
      }),
    ).toEqual({ ok: true, value: text, diagnostics: [] });
  });

  it("preserves spread transform source and comments when changing one axis, then restores it", () => {
    const inherited = "{ ...sharedTransform, /* keep rotation and scale */ position: [-1, 2, 3] }";
    const text = source.replace(
      "{ position: [-1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }",
      inherited,
    );
    const changed = patchEditableReactScene(fixture(text), text, {
      kind: "setTransform",
      instanceId: "first",
      transform: { position: [4, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value).toBe(text.replace("position: [-1, 2, 3]", "position: [4, 2, 3]"));
    const restored = patchEditableReactScene(fixture(changed.value), changed.value, {
      kind: "restoreTransform",
      instanceId: "first",
      expression: inherited,
    });
    expect(restored).toEqual({ ok: true, value: text, diagnostics: [] });
  });

  it("adds an override before a trailing line comment in a spread transform", () => {
    const text = source.replace(
      "{ position: [-1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }",
      "{ ...sharedTransform // keep\n      }",
    );
    const changed = patchEditableReactScene(fixture(text), text, {
      kind: "setTransform",
      instanceId: "first",
      transform: { position: [4, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value).toContain("...sharedTransform, position: [4,2,3] // keep");
    expect(changed.value).toContain('id: "second", component: Hero');
  });

  it("adds only the changed field to a spread transform and restores its original object", () => {
    const inherited = "{ ...sharedTransform /* keep shared axes */ }";
    const text = source.replace(
      "{ position: [-1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }",
      inherited,
    );
    const changed = patchEditableReactScene(fixture(text), text, {
      kind: "setTransform",
      instanceId: "first",
      transform: { position: [4, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value).toContain("...sharedTransform /* keep shared axes */, position: [4,2,3]");
    expect(changed.value).not.toContain("rotation: [0,0,0,1]");
    expect(
      patchEditableReactScene(fixture(changed.value), changed.value, {
        kind: "restoreTransform",
        instanceId: "first",
        expression: inherited,
      }),
    ).toEqual({ ok: true, value: text, diagnostics: [] });
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

it("quotes a non-identifier prop name when adding an inherited override", () => {
  const text = source.replace(
    'props: { title: "One", count: 1 }',
    'props: { ...sharedProps, title: "One", count: 1 }',
  );
  const changed = patchEditableReactScene(fixture(text, false, undefined, "button-label"), text, {
    kind: "setProp",
    instanceId: "first",
    propId: "button-label",
    value: "Changed",
  });
  expect(changed.ok).toBe(true);
  if (!changed.ok) return;
  expect(changed.value).toContain('"button-label": "Changed"');
});

it("marks scene-spread props without direct source as read-only", () => {
  const text = source.replace(
    '{ id: "first", component: Hero, props: { title: "One", count: 1 }, transform:',
    '{ ...sharedPlacement, id: "first", component: Hero, transform:',
  );
  const scene = readEditableReactScene(fixture(text), text);
  expect(scene.ok).toBe(true);
  if (!scene.ok) return;
  expect(scene.value[0]?.props.title?.editable).toBe(false);
  expect(
    patchEditableReactScene(fixture(text), text, {
      kind: "setProp",
      instanceId: "first",
      propId: "title",
      value: "Changed",
    }).ok,
  ).toBe(false);
});

it("keeps comments and object shape when removing a spread prop override", () => {
  const text = source.replace(
    'props: { title: "One", count: 1 }',
    "props: { /* keep shared context */ ...sharedProps }",
  );
  const changed = patchEditableReactScene(fixture(text, true), text, {
    kind: "setProp",
    instanceId: "first",
    propId: "title",
    value: "Changed",
  });
  expect(changed.ok).toBe(true);
  if (!changed.ok) return;
  const restored = patchEditableReactScene(fixture(changed.value, true, "Changed"), changed.value, {
    kind: "inheritProp",
    instanceId: "first",
    propId: "title",
  });
  expect(restored).toEqual({ ok: true, value: text, diagnostics: [] });
});
