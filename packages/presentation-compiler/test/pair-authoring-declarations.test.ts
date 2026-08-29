import { describe, expect, it } from "vitest";

import {
  defineComponentManifest,
  defineComponentStructure,
  definePresentation,
  defineTheme,
  frame,
} from "@unframe/presentation";
import type { CollectedAuthoringDeclaration } from "../src/project/collect-authoring-declarations.js";
import {
  pairAuthoringDeclarations,
  resolveAuthoringStructurePath,
} from "../src/project/pair-authoring-declarations.js";

const origin = (fileName: string, start = 0) => ({
  fileName,
  start,
  end: start + 1,
  line: 1,
  column: start + 1,
});

const entry = (
  role: CollectedAuthoringDeclaration["role"],
  fileName: string,
  value: unknown,
  sourceMap: CollectedAuthoringDeclaration["sourceMap"] = [{ path: [], origin: origin(fileName) }],
): CollectedAuthoringDeclaration => ({
  role,
  fileName,
  rootBuilder:
    role === "presentation"
      ? "definePresentation"
      : role === "theme"
        ? "defineTheme"
        : role === "component-manifest"
          ? "defineComponentManifest"
          : "defineComponentStructure",
  value: value as CollectedAuthoringDeclaration["value"],
  sourceMap,
});

const presentation = () =>
  definePresentation({
    id: "presentation",
    metadata: { title: "Presentation" },
    stage: {
      coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
      size: [1, 1, 1],
    },
    scene: { spatial: [], components: [] },
    assets: [],
    flow: {
      initialGroupId: "group",
      groups: {
        group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } },
      },
      variables: {},
    },
    operations: [],
  });

const manifest = (componentId: string, structure = "./Button.structure.tsx", version = 1) =>
  defineComponentManifest({
    componentId,
    version,
    authoring: { mode: "structured", structure },
    props: {},
    slots: {},
    parts: {},
    variants: {},
    states: {},
    actions: {},
    outputs: {},
    renderers: [],
  });

const structure = (componentId: string) =>
  defineComponentStructure({
    id: `${componentId}-structure`,
    componentId,
    root: frame({
      id: `${componentId}-root`,
      layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 },
      children: [],
    }),
    partBindings: {},
    slotPlacements: {},
    timelines: [],
  });

const collected = (declarations: readonly CollectedAuthoringDeclaration[]) => ({
  ok: true as const,
  declarations,
  diagnostics: [] as const,
});

const nullPrototype = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(nullPrototype);
  if (value !== null && typeof value === "object") {
    const copy = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(value)) copy[key] = nullPrototype(child);
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
  it("pairs structured manifest and structure deterministically while retaining collected entries", () => {
    const declarations = [
      entry("component-structure", "components/Button.structure.tsx", structure("button")),
      entry("theme", "z.unframe.ts", defineTheme({ id: "z", tokens: {}, namedStyles: {} })),
      entry("presentation", "entry.ts", presentation()),
      entry("component-manifest", "components/Button.manifest.ts", manifest("button")),
      entry("theme", "a.unframe.ts", defineTheme({ id: "a", tokens: {}, namedStyles: {} })),
    ];
    const first = pairAuthoringDeclarations(collected(declarations));
    const second = pairAuthoringDeclarations(collected([...declarations].reverse()));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      catalog: {
        presentation: { fileName: "entry.ts", value: { id: "presentation" } },
        themes: [{ value: { id: "a" } }, { value: { id: "z" } }],
        components: [
          {
            manifest: { value: { componentId: "button" } },
            structure: { value: { componentId: "button" } },
          },
        ],
      },
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
      ok: true,
      catalog: { components: [{ manifest: { value: { componentId: "button" } } }] },
    });
  });

  it("reports invalid role declarations at their source map origin", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", {}, [{ path: [], origin: origin("entry.ts", 9) }]),
      ]),
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-invalid-declaration",
          fileName: "entry.ts",
          message: "Presentation declaration failed Authoring SDK validation.",
          start: 9,
          end: 10,
          line: 1,
          column: 10,
        },
      ],
    });
  });

  it("requires exactly one presentation declaration", () => {
    const result = pairAuthoringDeclarations(collected([]));
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-presentation-declaration-count-invalid",
          fileName: "",
          message: "Exactly one presentation declaration is required.",
          start: 0,
          end: 0,
          line: 1,
          column: 1,
        },
      ],
    });
  });

  it("rejects duplicate theme and component identities using property origins", () => {
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("theme", "a.unframe.ts", defineTheme({ id: "theme", tokens: {}, namedStyles: {} })),
        entry("theme", "b.unframe.ts", defineTheme({ id: "theme", tokens: {}, namedStyles: {} }), [
          { path: [], origin: origin("b.unframe.ts") },
          { path: ["id"], origin: origin("b.unframe.ts", 7) },
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
            { path: [], origin: origin("two.manifest.ts") },
            { path: ["componentId"], origin: origin("two.manifest.ts", 4) },
          ],
        ),
        entry("component-structure", "Button.structure.tsx", structure("button")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
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
    if (result.ok) return;
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
      ok: true,
      catalog: {
        components: [
          { manifest: { value: { componentId: "button", version: 1 } } },
          { manifest: { value: { componentId: "button", version: 2 } } },
        ],
      },
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
    expect(result).toMatchObject({ ok: true, catalog: { components: [{}, {}] } });
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
    if (result.ok) return;
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
    if (result.ok) return;
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
    if (result.ok) return;
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
    if (result.ok) return;
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
    if (result.ok) return;
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
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-invalid-declaration",
      "compiler-component-structure-unreferenced",
    ]);
  });

  it("keeps diagnostics identical when input declarations are reversed", () => {
    const declarations = [
      entry("component-manifest", "b.manifest.ts", manifest("b", "./missing.structure.tsx")),
      entry("presentation", "entry.ts", presentation()),
      entry("theme", "a.unframe.ts", defineTheme({ id: "theme", tokens: {}, namedStyles: {} })),
      entry("theme", "z.unframe.ts", defineTheme({ id: "theme", tokens: {}, namedStyles: {} })),
    ];
    expect(pairAuthoringDeclarations(collected(declarations))).toEqual(
      pairAuthoringDeclarations(collected([...declarations].reverse())),
    );
  });

  it("rejects opaque manifests without attempting to pair their structures", () => {
    const opaque = defineComponentManifest({
      componentId: "opaque",
      version: 1,
      authoring: { mode: "opaque" },
      props: {},
      slots: {},
      parts: {},
      variants: {},
      states: {},
      actions: {},
      outputs: {},
      renderers: {},
      semantics: { targets: [], surfaces: [] },
    });
    const result = pairAuthoringDeclarations(
      collected([
        entry("presentation", "entry.ts", presentation()),
        entry("component-manifest", "opaque.manifest.ts", opaque),
        entry("component-structure", "opaque.structure.tsx", structure("opaque")),
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "compiler-opaque-component-unsupported",
      "compiler-component-structure-unreferenced",
    ]);
  });
});
