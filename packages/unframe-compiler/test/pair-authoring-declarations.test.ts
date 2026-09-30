import { describe, expect, it } from "vitest";

import {
  buildOpaqueComponentManifest,
  defineComponentManifest,
  defineComponentStructure,
  definePresentation,
  defineTheme,
  frame,
  validateStaticComponentMetadata,
} from "@unframe/unframe-authoring";
import type { CollectedAuthoringDeclaration } from "../src/project/collect-authoring-declarations.js";
import {
  pairAuthoringDeclarations,
  resolveAuthoringStructurePath,
} from "../src/project/pair-authoring-declarations.js";

const origin = (fileName: string, start = 0) => ({
  column: start + 1,
  end: start + 1,
  fileName,
  line: 1,
  start,
});

const entry = (
  role: CollectedAuthoringDeclaration["role"],
  fileName: string,
  value: unknown,
  sourceMap: CollectedAuthoringDeclaration["sourceMap"] = [{ origin: origin(fileName), path: [] }],
): CollectedAuthoringDeclaration => ({
  fileName,
  role,
  rootBuilder:
    role === "presentation"
      ? "definePresentation"
      : role === "theme"
        ? "defineTheme"
        : role === "component-manifest"
          ? "defineComponentManifest"
          : "defineComponentStructure",
  sourceMap,
  value: value as CollectedAuthoringDeclaration["value"],
});

const presentation = () =>
  definePresentation({
    assets: [],
    flow: {
      groups: {
        group: { id: "group", initialStepId: "step", steps: { step: { cues: [], id: "step" } } },
      },
      initialGroupId: "group",
      variables: {},
    },
    id: "presentation",
    metadata: { title: "Presentation" },
    operations: [],
    scene: { components: [], spatial: [] },
    stage: {
      coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
      size: [1, 1, 1],
    },
  });

const manifest = (componentId: string, structure = "./Button.structure.tsx", version = 1) =>
  defineComponentManifest({
    actions: {},
    authoring: { mode: "structured", structure },
    componentId,
    outputs: {},
    parts: {},
    props: {},
    renderers: [],
    slots: {},
    states: {},
    variants: {},
    version,
  });

const structure = (componentId: string) =>
  defineComponentStructure({
    baseSemanticTree: { nodes: {}, rootNodeIds: [] },
    componentId,
    id: `${componentId}-structure`,
    partBindings: {},
    root: frame({
      children: [],
      id: `${componentId}-root`,
      layout: { height: 1, kind: "absolute", width: 1, x: 0, y: 0 },
    }),
    timelines: [],
    variantStyles: {},
  });

const collected = (declarations: ReadonlyArray<CollectedAuthoringDeclaration>) => ({
  declarations,
  diagnostics: [] as const,
  ok: true as const,
  reactComponents: [],
});

const nullPrototype = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(nullPrototype);
  }
  if (value !== null && typeof value === "object") {
    const copy = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(value)) {
      copy[key] = nullPrototype(child);
    }
    return copy;
  }
  return value;
};

describe("resolveAuthoringStructurePath", () => {
  it("resolves a root-contained POSIX relative structure path", () => {
    expect(
      resolveAuthoringStructurePath("components/Button.manifest.ts", "./Button.structure.tsx"),
    ).toBe("components/Button.structure.tsx");
    expect(
      resolveAuthoringStructurePath("components/Button.manifest.ts", "../Shared.structure.tsx"),
    ).toBe("Shared.structure.tsx");
    expect(
      resolveAuthoringStructurePath("Button.manifest.ts", "../escape.structure.tsx"),
    ).toBeUndefined();
  });
});

describe("pairAuthoringDeclarations", () => {
  it.each([null, 42])("rejects a mixed scene with malformed component item %s", (item) => {
    const base = presentation();
    const mixed = {
      ...base,
      scene: {
        ...base.scene,
        components: [
          {
            audience: { kind: "all" },
            component: { id: "react", version: 1 },
            fit: "contain",
            id: "react-one",
            owner: { kind: "presentation" },
            parent: { kind: "stage" },
            physicalSizeMeters: [1, 1],
            props: {},
            transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          },
          item,
        ],
      },
    };
    expect(
      pairAuthoringDeclarations(collected([entry("presentation", "entry.ts", mixed)])),
    ).toMatchObject({
      diagnostics: [{ code: "compiler-invalid-declaration", fileName: "entry.ts" }],
      ok: false,
    });
  });
  it("accepts a mixed Presentation descriptor with a React scene item", () => {
    const base = presentation();
    const mixed = {
      ...base,
      scene: {
        ...base.scene,
        components: [
          {
            audience: { kind: "all" },
            component: { id: "react", version: 1 },
            fit: "contain",
            id: "react-one",
            owner: { kind: "presentation" },
            parent: { kind: "stage" },
            physicalSizeMeters: [1, 1],
            props: {},
            transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          },
        ],
      },
    };
    const result = pairAuthoringDeclarations(collected([entry("presentation", "entry.ts", mixed)]));
    expect(result).toMatchObject({
      catalog: { presentation: { value: { scene: { components: [{ id: "react-one" }] } } } },
      ok: true,
    });
  });
  it("pairs structured manifest and structure deterministically while retaining collected entries", () => {
    const declarations = [
      entry("component-structure", "components/Button.structure.tsx", structure("button")),
      entry("theme", "z.unframe.ts", defineTheme({ id: "z", namedStyles: {}, tokens: {} })),
      entry("presentation", "entry.ts", presentation()),
      entry("component-manifest", "components/Button.manifest.ts", manifest("button")),
      entry("theme", "a.unframe.ts", defineTheme({ id: "a", namedStyles: {}, tokens: {} })),
    ];
    const first = pairAuthoringDeclarations(collected(declarations));
    const second = pairAuthoringDeclarations(collected([...declarations].reverse()));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      catalog: {
        components: [
          {
            manifest: { value: { componentId: "button" } },
            structure: { value: { componentId: "button" } },
          },
        ],
        presentation: { fileName: "entry.ts", value: { id: "presentation" } },
        themes: [{ value: { id: "a" } }, { value: { id: "z" } }],
      },
      ok: true,
    });
  });

  it("accepts normalized null-prototype declaration values", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", nullPrototype(presentation())),
        entry("component-manifest", "Button.manifest.ts", nullPrototype(manifest("button"))),
        entry("component-structure", "Button.structure.tsx", nullPrototype(structure("button"))),
      ]),
    );
    expect(result).toMatchObject({
      catalog: { components: [{ manifest: { value: { componentId: "button" } } }] },
      ok: true,
    });
  });

  it("reports invalid role declarations at their source map origin", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", {}, [{ origin: origin("entry.ts", 9), path: [] }]),
      ]),
    );
    expect(result).toEqual({
      diagnostics: [
        {
          code: "compiler-invalid-declaration",
          column: 10,
          end: 10,
          fileName: "entry.ts",
          line: 1,
          message: "Presentation declaration failed Authoring SDK validation.",
          start: 9,
        },
      ],
      ok: false,
    });
  });

  it("requires exactly one presentation declaration", () => {
    const result = pairAuthoringDeclarations(collected([]));
    expect(result).toEqual({
      diagnostics: [
        {
          code: "compiler-presentation-declaration-count-invalid",
          column: 1,
          end: 0,
          fileName: "",
          line: 1,
          message: "Exactly one presentation declaration is required.",
          start: 0,
        },
      ],
      ok: false,
    });
  });

  it("rejects duplicate theme and component identities using property origins", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("theme", "a.unframe.ts", defineTheme({ id: "theme", namedStyles: {}, tokens: {} })),
        entry("theme", "b.unframe.ts", defineTheme({ id: "theme", namedStyles: {}, tokens: {} }), [
          { origin: origin("b.unframe.ts"), path: [] },
          { origin: origin("b.unframe.ts", 7), path: ["id"] },
        ]),
        entry(
          "component-manifest",
          "one.manifest.ts",
          manifest("button", "./Button.structure.tsx"),
        ),
        entry(
          "component-manifest",
          "two.manifest.ts",
          manifest("button", "./Button.structure.tsx"),
          [
            { origin: origin("two.manifest.ts"), path: [] },
            { origin: origin("two.manifest.ts", 4), path: ["componentId"] },
          ],
        ),
        entry("component-structure", "Button.structure.tsx", structure("button")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-theme-duplicate",
      "compiler-component-manifest-duplicate",
    ]);
    expect(result.diagnostics[0]?.start).toBe(7);
    expect(result.diagnostics[1]?.start).toBe(4);
  });

  it("rejects invalid, absent, duplicate, mismatched, and unreferenced structures together", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "bad.manifest.ts", manifest("bad", "../escape.structure.tsx")),
        entry(
          "component-manifest",
          "missing.manifest.ts",
          manifest("missing", "./missing.structure.tsx"),
        ),
        entry("component-manifest", "one.manifest.ts", manifest("one", "./shared.structure.tsx")),
        entry("component-manifest", "two.manifest.ts", manifest("two", "./shared.structure.tsx")),
        entry("component-structure", "shared.structure.tsx", structure("wrong")),
        entry("component-structure", "unused.structure.tsx", structure("unused")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-component-structure-entry-invalid",
      "compiler-component-structure-not-found",
      "compiler-component-identity-mismatch",
      "compiler-component-identity-mismatch",
      "compiler-component-structure-unreferenced",
    ]);
  });

  it("allows same component id at different versions to share one structure", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry(
          "component-manifest",
          "v2.manifest.ts",
          manifest("button", "./shared.structure.tsx", 2),
        ),
        entry("component-structure", "shared.structure.tsx", structure("button")),
        entry(
          "component-manifest",
          "v1.manifest.ts",
          manifest("button", "./shared.structure.tsx", 1),
        ),
      ]),
    );
    expect(result).toMatchObject({
      catalog: {
        components: [
          { manifest: { value: { componentId: "button", version: 1 } } },
          { manifest: { value: { componentId: "button", version: 2 } } },
        ],
      },
      ok: true,
    });
  });

  it("allows same component id at different versions to use separate structures", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "v1.manifest.ts", manifest("button", "./v1.structure.tsx", 1)),
        entry("component-manifest", "v2.manifest.ts", manifest("button", "./v2.structure.tsx", 2)),
        entry("component-structure", "v1.structure.tsx", structure("button")),
        entry("component-structure", "v2.structure.tsx", structure("button")),
      ]),
    );
    expect(result).toMatchObject({ catalog: { components: [{}, {}] }, ok: true });
  });

  it("rejects duplicate manifest identity but not a different version", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry(
          "component-manifest",
          "one.manifest.ts",
          manifest("button", "./shared.structure.tsx", 1),
        ),
        entry(
          "component-manifest",
          "two.manifest.ts",
          manifest("button", "./shared.structure.tsx", 1),
        ),
        entry(
          "component-manifest",
          "three.manifest.ts",
          manifest("button", "./shared.structure.tsx", 2),
        ),
        entry("component-structure", "shared.structure.tsx", structure("button")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-component-manifest-duplicate",
    ]);
  });

  it.each([
    ".",
    "./",
    "Button.structure.tsx/",
    "dir/./Button.structure.tsx",
    "dir/../Button.structure.tsx",
  ])("rejects non-canonical structured entry %s", (structurePath) => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "Button.manifest.ts", manifest("button", structurePath)),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "compiler-component-structure-entry-invalid",
    );
  });

  it("does not suppress an independent unreferenced structure for an invalid manifest without a path", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "invalid.manifest.ts", {}),
        entry("component-manifest", "Button.manifest.ts", manifest("button")),
        entry("component-structure", "Button.structure.tsx", {}),
        entry("component-structure", "unused.structure.tsx", structure("unused")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-invalid-declaration",
      "compiler-invalid-declaration",
      "compiler-component-structure-unreferenced",
    ]);
  });

  it("suppresses only the structure named by an invalid manifest's descriptor-backed path", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "Button.manifest.ts", {
          authoring: { mode: "structured", structure: "./Button.structure.tsx" },
        }),
        entry("component-structure", "Button.structure.tsx", structure("button")),
        entry("component-structure", "unused.structure.tsx", structure("unused")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-invalid-declaration",
      "compiler-component-structure-unreferenced",
    ]);
  });

  it("reads an invalid manifest candidate without invoking its Proxy get trap", () => {
    let reads = 0;
    const candidate = new Proxy(
      { authoring: { mode: "structured", structure: "./Button.structure.tsx" } },
      {
        get() {
          reads += 1;
          throw new Error("get must not run");
        },
      },
    );
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "Button.manifest.ts", candidate),
        entry("component-structure", "Button.structure.tsx", structure("button")),
      ]),
    );
    expect(reads).toBe(0);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toEqual(["compiler-invalid-declaration"]);
  });

  it("treats a throwing Proxy descriptor trap as an invalid manifest without a candidate path", () => {
    let reads = 0;
    const candidate = new Proxy(
      {},
      {
        get() {
          reads += 1;
          throw new Error("get must not run");
        },
        getOwnPropertyDescriptor() {
          throw new Error("descriptor failure");
        },
      },
    );
    expect(() =>
      pairAuthoringDeclarations(
        collected([
          entry("presentation", "entry.ts", presentation()),
          entry("component-manifest", "Button.manifest.ts", candidate),
          entry("component-structure", "unused.structure.tsx", structure("unused")),
        ]),
      ),
    ).not.toThrow();
    expect(reads).toBe(0);
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "Button.manifest.ts", candidate),
        entry("component-structure", "unused.structure.tsx", structure("unused")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-invalid-declaration",
      "compiler-component-structure-unreferenced",
    ]);
  });

  it("keeps diagnostics identical when input declarations are reversed", () => {
    const declarations = [
      entry("component-manifest", "b.manifest.ts", manifest("b", "./missing.structure.tsx")),
      entry("presentation", "entry.ts", presentation()),
      entry("theme", "a.unframe.ts", defineTheme({ id: "theme", namedStyles: {}, tokens: {} })),
      entry("theme", "z.unframe.ts", defineTheme({ id: "theme", namedStyles: {}, tokens: {} })),
    ];
    expect(pairAuthoringDeclarations(collected(declarations))).toEqual(
      pairAuthoringDeclarations(collected([...declarations].reverse())),
    );
  });

  it("rejects standalone opaque manifests without attempting to pair their structures", () => {
    const opaque = defineComponentManifest({
      actions: {},
      authoring: { mode: "opaque" },
      componentId: "opaque",
      outputs: {},
      parts: {},
      props: {},
      renderers: {},
      semantics: { surfaces: [], targets: [] },
      slots: {},
      states: {},
      variants: {},
      version: 1,
    });
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "opaque.manifest.ts", opaque),
        entry("component-structure", "opaque.structure.tsx", structure("opaque")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-opaque-component-unpaired",
      "compiler-component-structure-unreferenced",
    ]);
  });

  it("pairs extracted React metadata and renderer without executing the component", () => {
    const metadata = validateStaticComponentMetadata({
      id: "hero",
      props: {},
      semantics: { nodes: {}, rootNodeIds: [] },
      surface: { logicalSize: [800, 450] },
      version: 1,
    });
    const reactManifest = buildOpaqueComponentManifest(metadata, "hero.component.tsx#render");
    const reactPresentation = {
      ...presentation(),
      scene: [
        {
          audience: { kind: "all" },
          component: { id: "hero", version: 1 },
          fit: "contain",
          id: "hero-instance",
          owner: { kind: "presentation" },
          parent: { kind: "stage" },
          physicalSizeMeters: [1, 1],
          props: {},
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        },
      ],
    };
    const result = pairAuthoringDeclarations({
      declarations: [entry("presentation", "entry.ts", reactPresentation)],
      diagnostics: [],
      ok: true,
      reactComponents: [
        {
          exportName: "Hero",
          fileName: "hero.component.tsx",
          manifest: reactManifest,
          metadata,
          renderer: {
            entrySource: "export default () => null",
            helperOrigins: [],
            localDependencies: [],
            packageImports: [],
            renderOrigin: origin("hero.component.tsx"),
          },
          sourceMap: [{ origin: origin("hero.component.tsx"), path: [] }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.catalog.components).toHaveLength(1);
      expect(result.catalog.components[0]).toMatchObject({
        metadata,
        renderer: { entrySource: "export default () => null" },
        rendererEntry: "hero.component.tsx#render",
      });
    }
  });
});
