import { describe, expect, it } from "vitest";
import { lowerAuthoringDeclarationFile } from "../src/lowering/lower-authoring-declaration.js";
import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

import {
  checkAuthoringProject,
  checkAuthoringProjectAssembly,
  hashThemeDeclaration,
} from "../src/index.js";

const builders = [
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
  "stringProp",
  "state",
  "surfaceState",
  "playTimeline",
  "frame",
  "after",
]
  .map((name) => `export const ${name} = (...args: any[]): any => { throw 0; };`)
  .concat("export type PresentationDeclaration = any;")
  .join("\n");

type VirtualFile = { readonly fileName: string; readonly sourceText: string };

const project = (files: readonly VirtualFile[]) => ({
  projectRoot: "/virtual/static-dsl",
  entryFile: "entry.ts",
  files,
  packageDependencies: [
    {
      packageName: "@unframe/unframe-authoring",
      packageVersion: "1",
      packageIntegrity: "integrity",
    },
  ],
  packages: [
    {
      packageName: "@unframe/unframe-authoring",
      packageVersion: "1",
      packageIntegrity: "integrity",
      files: [{ fileName: "index.ts", sourceText: builders }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      dependencies: [],
    },
  ],
});

const literalSource = `
import { definePresentation } from "@unframe/unframe-authoring";
export default definePresentation({
  id: "presentation",
  metadata: { title: "Composed" },
  stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 2, 3] },
  theme: { themeId: "theme" },
  scene: { spatial: [], components: [] },
  assets: [],
  flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } } }, variables: {} },
  operations: [],
});`;

const themeFile: VirtualFile = {
  fileName: "theme.unframe.ts",
  sourceText:
    'import { defineTheme } from "@unframe/unframe-authoring"; export default defineTheme({ id: "theme", tokens: {}, namedStyles: {} });',
};

const composedFiles = (): readonly VirtualFile[] => [
  {
    fileName: "values.ts",
    sourceText: `
export const axes = { upAxis: "+Y", forwardAxis: "-Z" } as const;
const dimensions = [1, 2] as const;
type Bag = { [key: string]: unknown };
export default { axes, dimensions, tail: [3] } satisfies Bag;`,
  },
  {
    fileName: "barrel.ts",
    sourceText: 'export { default as values, axes } from "./values.js";',
  },
  {
    fileName: "shared.tsx",
    sourceText: `
import { values, axes as namedAxes } from "./barrel.js";
export const stage = {
  coordinateSystem: { unit: "meter", ...{ handedness: "left" }, ...values.axes, ...{ handedness: "right" } },
  size: [...values.dimensions, ...values["tail"]],
};
export const metadata = { title: "Composed" };
export const selectedAxes = namedAxes;`,
  },
  {
    fileName: "entry.ts",
    sourceText: `
import type { PresentationDeclaration } from "@unframe/unframe-authoring";
import { definePresentation } from "@unframe/unframe-authoring";
import { metadata, stage } from "./shared.js";
const empty = [] as const;
const identity = "presentation";
const declaration: PresentationDeclaration = definePresentation({
  id: identity,
  metadata,
  stage,
  theme: { themeId: "theme" },
  scene: { spatial: empty, components: [...empty] },
  assets: empty,
  flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: empty } } } }, variables: {} },
  operations: empty,
});
export default declaration;`,
  },
  themeFile,
];

describe("extended static TypeScript authoring", () => {
  it("resolves const declarations, project imports, property access, shorthand, and spreads", () => {
    const result = checkAuthoringProject(project(composedFiles()));

    expect(result).toMatchObject({
      valid: true,
      value: {
        presentation: {
          fileName: "entry.ts",
          value: {
            id: "presentation",
            metadata: { title: "Composed" },
            stage: {
              coordinateSystem: {
                unit: "meter",
                handedness: "right",
                upAxis: "+Y",
                forwardAxis: "-Z",
              },
              size: [1, 2, 3],
            },
          },
        },
        components: [],
      },
    });
  });

  it("reads and spreads statically evaluated builder results", () => {
    const result = checkAuthoringProject(
      project([
        { fileName: "entry.ts", sourceText: literalSource },
        themeFile,
        {
          fileName: "manifest-values.ts",
          sourceText: `
import { defineTheme } from "@unframe/unframe-authoring";
const theme = defineTheme({ id: "helper-theme", tokens: {}, namedStyles: {} });
export const themeId = theme.id;
export const copied = { ...theme, id: "copied-theme" };`,
        },
      ]),
    );

    expect(result.valid).toBe(true);
  });

  it("reads and spreads every canonical builder result shape", () => {
    const result = checkAuthoringProject(
      project([
        { fileName: "entry.ts", sourceText: literalSource },
        themeFile,
        {
          fileName: "builder-values.ts",
          sourceText: `
import { after, state, stringProp, surfaceState } from "@unframe/unframe-authoring";
const property = stringProp({ default: "x" });
const initial = state();
const transition = surfaceState("surface", "active");
const timer = after(25);
export const values = {
  propertyKind: property.kind,
  initialKind: initial.kind,
  surfaceId: transition.surfaceId,
  timerKind: timer.kind,
  property: { ...property },
  initial: { ...initial },
  transition: { ...transition },
  timer: { ...timer },
};`,
        },
      ]),
    );

    expect(result.valid).toBe(true);
  });

  it.each([
    [
      "strict object field",
      `
import { stringProp } from "@unframe/unframe-authoring";
const declaration = stringProp({ default: "x", extra: "Injected" } as any);
export const escaped = declaration.extra;`,
      "compiler-static-property-access-invalid",
    ],
    [
      "builder semantic constraint",
      `
import { after } from "@unframe/unframe-authoring";
const declaration = after(-1);
export const escaped = declaration.afterMilliseconds;`,
      "compiler-static-property-access-invalid",
    ],
    [
      "spread composition",
      `
import { stringProp } from "@unframe/unframe-authoring";
const declaration = stringProp({ default: "x", extra: "Injected" } as any);
export const escaped = { ...declaration };`,
      "compiler-static-object-spread-invalid",
    ],
    [
      "generated discriminator conflict",
      `import { stringProp } from "@unframe/unframe-authoring";
const declaration = stringProp({ kind: "bad", default: "x" } as any);
export const escaped = declaration.default;`,
      "compiler-static-property-access-invalid",
    ],
    [
      "generated positional field conflict",
      `import { playTimeline } from "@unframe/unframe-authoring";
const declaration = playTimeline("original", { timelineId: "replacement", completion: "blocking" } as any);
export const escaped = { ...declaration };`,
      "compiler-static-object-spread-invalid",
    ],
  ])("does not allow projection to erase an invalid %s", (_label, sourceText, code) => {
    const result = checkAuthoringProject(
      project([
        { fileName: "entry.ts", sourceText: literalSource },
        themeFile,
        { fileName: "invalid-projection.ts", sourceText },
      ]),
    );

    expect(result).toMatchObject({ valid: false });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code,
          fileName: "invalid-projection.ts",
        }),
      ]),
    );
  });

  it("bounds a shared builder graph before materializing a projected field", () => {
    const levels = Array.from(
      { length: 13 },
      (_, index) =>
        `const f${index} = frame({ id: "frame", layout, children: ${index === 0 ? "[]" : `[f${index - 1}, f${index - 1}]`} });`,
    ).join("\n");
    const sourceText = `import { frame, definePresentation } from "@unframe/unframe-authoring";
const layout = { kind: "absolute", x: 0, y: 0, width: 100, height: 100 };
${levels}
export default definePresentation({ id: f12.id });`;
    const parsed = parseAuthoringProject(project([{ fileName: "entry.ts", sourceText }]));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const analyzed = analyzeAuthoringProject(parsed.value);
    if (!analyzed.ok) throw new Error(JSON.stringify(analyzed.diagnostics));
    const lowered = lowerAuthoringDeclarationFile(analyzed, undefined, false);
    expect(lowered.ok).toBe(false);
  });

  it("produces the same checked definition and hashes as the equivalent literal", () => {
    const literalProject = project([
      { fileName: "entry.ts", sourceText: literalSource },
      themeFile,
    ]);
    const literalCatalog = checkAuthoringProject(literalProject);
    if (!literalCatalog.valid) throw new Error("Literal fixture must be valid.");
    const carrier = {
      themeHashes: literalCatalog.value.themes.map((theme) => ({
        themeId: theme.value.id,
        hash: hashThemeDeclaration(theme.value),
      })),
      componentLocks: [],
      assets: {},
    };
    const literal = checkAuthoringProjectAssembly(literalProject, carrier);
    const composed = checkAuthoringProjectAssembly(project(composedFiles()), carrier);

    expect(literal.valid).toBe(true);
    expect(composed.valid).toBe(true);
    if (!literal.valid || !composed.valid) return;
    expect(composed.value.definition).toEqual(literal.value.definition);
    expect(composed.value.definitionHash).toBe(literal.value.definitionHash);
    expect(composed.value.sourceHash).toBe(literal.value.sourceHash);
  });

  it.each([
    ["mutable binding", "let unsafe = 1; export const value = unsafe;"],
    ["assignment", "const value: any = {}; value.x = 1; export { value };"],
    ["function call", "export const value = (() => 1)();"],
    ["getter", "export const value = { get x() { return 1; } };"],
    ["method", "export const value = { x() { return 1; } };"],
    ["dynamic import", 'export const value = import("./other.js");'],
  ])("rejects unused helper side effects: %s", (_label, helper) => {
    const result = checkAuthoringProject(
      project([
        { fileName: "entry.ts", sourceText: literalSource },
        { fileName: "unsafe.ts", sourceText: helper },
        { fileName: "other.ts", sourceText: "export const value = 1;" },
      ]),
    );

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ fileName: "unsafe.ts" })]),
    );
  });

  it("rejects static reference cycles with a stable diagnostic", () => {
    const files = [
      { fileName: "entry.ts", sourceText: literalSource },
      {
        fileName: "a.ts",
        sourceText: 'import { b } from "./b.js"; export const a: any = b;',
      },
      {
        fileName: "b.ts",
        sourceText: 'import { a } from "./a.js"; export const b: any = a;',
      },
    ];

    const first = checkAuthoringProject(project(files));
    const second = checkAuthoringProject(project([...files].reverse()));
    expect(first).toEqual(second);
    expect(first).toMatchObject({ valid: false });
    expect(first.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "compiler-static-reference-cycle" }),
      ]),
    );
  });

  it("stops exponential array spread expansion with a stable diagnostic", () => {
    const declarations = ["export const a0: readonly number[] = [0];"];
    for (let index = 1; index <= 18; index += 1)
      declarations.push(
        `export const a${index}: readonly number[] = [...a${index - 1}, ...a${index - 1}];`,
      );
    const files = [
      { fileName: "entry.ts", sourceText: literalSource },
      { fileName: "expansion.ts", sourceText: declarations.join("\n") },
    ];

    const first = checkAuthoringProject(project(files));
    const second = checkAuthoringProject(project(files));

    expect(first).toEqual(second);
    expect(first).toMatchObject({ valid: false });
    expect(first.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "compiler-static-expansion-limit",
          fileName: "expansion.ts",
        }),
      ]),
    );
  });

  it("counts repeated nested values against the graph expansion budget", () => {
    const declarations = ["export const a0: readonly unknown[] = [0];"];
    for (let index = 1; index <= 18; index += 1)
      declarations.push(
        `export const a${index}: readonly unknown[] = [a${index - 1}, a${index - 1}];`,
      );

    const result = checkAuthoringProject(
      project([
        { fileName: "entry.ts", sourceText: literalSource },
        { fileName: "nested-expansion.ts", sourceText: declarations.join("\n") },
      ]),
    );

    expect(result).toMatchObject({ valid: false });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "compiler-static-expansion-limit",
          fileName: "nested-expansion.ts",
        }),
      ]),
    );
  });

  it("rejects deeply nested expression syntax before recursive evaluation overflows", () => {
    const nested = `${"[".repeat(140)}0${"]".repeat(140)}`;
    const result = checkAuthoringProject(
      project([
        { fileName: "entry.ts", sourceText: literalSource },
        {
          fileName: "deep-expression.ts",
          sourceText: `export const value: unknown = ${nested};`,
        },
      ]),
    );

    expect(result).toMatchObject({ valid: false });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "compiler-static-expansion-limit",
          fileName: "deep-expression.ts",
        }),
      ]),
    );
  });

  it.each([
    ["raw duplicate key", "const value = { x: 1, x: 2 };"],
    ["prototype key", 'const value = { "__proto__": 1 };'],
  ])("rejects %s", (_label, declaration) => {
    const result = checkAuthoringProject(
      project([
        { fileName: "entry.ts", sourceText: literalSource },
        {
          fileName: "unsafe.ts",
          sourceText: `${declaration} export { value };`,
        },
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ fileName: "unsafe.ts" })]),
    );
  });
});
