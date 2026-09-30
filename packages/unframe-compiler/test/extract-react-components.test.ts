import { expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { extractReactComponents } from "../src/project/extract-react-components.js";
import { collectAuthoringDeclarations } from "../src/project/collect-authoring-declarations.js";
import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";
import { computeFrozenComponentInputs } from "../src/semantic/frozen-component-inputs.js";
import type { PairedAuthoringDeclarationCatalog } from "../src/project/pair-authoring-declarations.js";

const sdk = `
  export const defineComponent = <T>(value: T): T => value;
  export const definePresentation = <T>(value: T): T => value;
  export const editableText = (value: {required: true}) => ({kind: "string" as const, ...value, editor: {kind: "text" as const}});
  export const prop = (name: string) => ({kind: "prop-ref" as const, name});
  export const setState = (stateId: string) => ({kind: "setState" as const, stateId});
`;
const hash = `sha256:${"0".repeat(64)}`;
const reactHash = `sha256:${"1".repeat(64)}`;

const analyze = (
  sourceText: string,
  presentation?: string,
  rawCss?: string,
  extraFiles: ReadonlyArray<{ fileName: string; sourceText: string }> = [],
  packaged = false,
) => {
  const input = {
    entryFile: presentation ? "presentation.ts" : "Hero.component.tsx",
    files: [
      ...(packaged ? [] : [{ fileName: "Hero.component.tsx", sourceText }]),
      { fileName: "globals.d.ts", sourceText: "declare class Promise<T> {}" },
      ...(presentation ? [{ fileName: "presentation.ts", sourceText: presentation }] : []),
      ...extraFiles,
    ],
    packages: [
      {
        contentIntegrity: hash,
        dependencies: [],
        exports: [
          { runtimeImport: "index.ts", runtimeRequire: null, subpath: ".", types: "index.ts" },
        ],
        files: [
          { data: sdk, encoding: "utf8", hash, mediaType: "text/typescript", path: "index.ts" },
        ],
        key: hash,
        locator: "@unframe/unframe-authoring@1",
        name: "@unframe/unframe-authoring",
        version: "1",
      },
      {
        contentIntegrity: reactHash,
        dependencies: [],
        exports: [
          {
            runtimeImport: "jsx-runtime.ts",
            runtimeRequire: null,
            subpath: "./jsx-runtime",
            types: "jsx-runtime.ts",
          },
        ],
        files: [
          {
            data: "export namespace JSX { export type Element = object; export interface IntrinsicElements { h1: {children?: unknown}; } } export const jsx = (..._args: unknown[]): object => ({}); export const jsxs = jsx;",
            encoding: "utf8",
            hash: reactHash,
            mediaType: "text/typescript",
            path: "jsx-runtime.ts",
          },
        ],
        key: reactHash,
        locator: "react@1",
        name: "react",
        version: "1",
      },
      ...(packaged
        ? [
            {
              contentIntegrity: `sha256:${"2".repeat(64)}`,
              dependencies: [
                { packageKey: hash, specifier: "@unframe/unframe-authoring", usage: "runtime" },
              ],
              exports: [
                {
                  runtimeImport: "Hero.component.tsx",
                  runtimeRequire: null,
                  subpath: ".",
                  types: "index.d.ts",
                },
              ],
              files: [
                {
                  data: sourceText,
                  encoding: "utf8",
                  hash: `sha256:${"2".repeat(64)}`,
                  mediaType: "text/tsx",
                  path: "Hero.component.tsx",
                },
                {
                  data: 'export { Hero } from "./Hero.component";',
                  encoding: "utf8",
                  hash: `sha256:${"2".repeat(64)}`,
                  mediaType: "text/typescript",
                  path: "index.d.ts",
                },
              ],
              key: `sha256:${"2".repeat(64)}`,
              locator: "ui-kit@1",
              name: "ui-kit",
              version: "1",
            },
          ]
        : []),
    ],
    projectRoot: "/virtual",
    rootDependencies: [
      { packageKey: hash, specifier: "@unframe/unframe-authoring", usage: "runtime" },
      { packageKey: reactHash, specifier: "react", usage: "runtime" },
      ...(packaged
        ? [{ packageKey: `sha256:${"2".repeat(64)}`, specifier: "ui-kit", usage: "runtime" }]
        : []),
    ],
    ...(rawCss === undefined
      ? {}
      : {
          rawFiles: [
            {
              data: rawCss,
              encoding: "utf8",
              hash: `sha256:${bytesToHex(sha256(new TextEncoder().encode(rawCss)))}`,
              mediaType: "text/css",
              path: "components.css",
            },
          ],
        }),
  };
  const parsed = parseAuthoringProject(input);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  const analyzed = analyzeAuthoringProject(parsed.value);
  if (!analyzed.ok) {
    throw new Error(JSON.stringify(analyzed.diagnostics));
  }
  return { ...analyzed, input };
};

const component = `
  import { defineComponent, editableText, prop } from "@unframe/unframe-authoring";
  const label = "Welcome ";
  const decorate = (value: string) => value;
  export const Hero = defineComponent({
    id: "hero", version: 1,
    props: { title: editableText({required: true}) },
    surface: {logicalSize: [960, 540]},
    semantics: {rootNodeIds: ["title"], nodes: {
      title: {role: "heading", level: 1, parentId: null, order: 0, text: prop("title")}
    }},
    render: ({texts}: {texts: {title: string}}) => decorate(label + texts.title),
  });
`;

it("extracts finite State declarations without running their SDK builders", () => {
  const reveal = component
    .replace("defineComponent, editableText, prop", "defineComponent, editableText, prop, setState")
    .replace('id: "hero"', 'id: "reveal"')
    .replace(
      "    render: ",
      `    interactions: { reveal: {kind: "click", event: "quiz.reveal", hitPriority: 0} },
    initialState: "hidden",
    states: { hidden: {semanticOverrides: [], enabledInteractionIds: ["reveal"]}, revealed: {semanticOverrides: [], enabledInteractionIds: []} },
    actions: { reveal: {inputs: {}, preconditions: [], effects: [setState("revealed")]} },
    outputs: { revealRequested: {payload: {}, producer: {kind: "surfaceInteraction", interactionId: "reveal"}} },
    render: `,
    );
  const result = extractReactComponents(analyze(reveal));
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  expect(result.components[0]?.manifest.actions.reveal?.effects).toEqual([
    { kind: "setSurfaceState", stateId: "revealed", surfaceId: "surface" },
  ]);
  expect(result.components[0]?.renderer.entrySource).not.toContain("setState");
});

it("extracts public metadata and render dependencies without including contract initializers", () => {
  const result = extractReactComponents(analyze(component));
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.components[0]?.metadata).toMatchObject({
    id: "hero",
    props: { title: { editor: { kind: "text" }, kind: "string", required: true } },
    semantics: { nodes: { title: { text: { kind: "prop-ref", name: "title" } } } },
  });
  expect(result.components[0]?.renderer.entrySource).toContain('const label = "Welcome ";');
  expect(result.components[0]?.renderer.entrySource).toContain("const decorate =");
  expect(result.components[0]?.renderer.entrySource).not.toContain("defineComponent");
  expect(result.components[0]?.renderer.entrySource).not.toContain("editableText");
});

it("rejects non-static public contract expressions", () => {
  const result = extractReactComponents(
    analyze(component.replace('id: "hero"', 'id: decorate("hero")')),
  );
  expect(result).toMatchObject({ ok: false });
});

it("rejects top-level effects even when render does not reference them", () => {
  const result = extractReactComponents(
    analyze(
      component.replace(
        'const label = "Welcome ";',
        "const label = makeValue();\n  declare function makeValue(): string;",
      ),
    ),
  );
  expect(result).toMatchObject({ ok: false });
});

it("lowers a component import in a presentation to its static descriptor", () => {
  const presentation = `
    import {definePresentation} from "@unframe/unframe-authoring";
    import {Hero} from "./Hero.component";
    export default definePresentation({id: "deck", scene: [{id: "opening", component: Hero, props: {title: "Hi"}}]});
  `;
  const result = collectAuthoringDeclarations(analyze(component, presentation));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.declarations.find((item) => item.role === "presentation")?.value).toMatchObject({
    scene: [{ component: { id: "hero", version: 1 } }],
  });
  expect(result.reactComponents).toHaveLength(1);
});

it("extracts a locked package Component through its explicit export", () => {
  const presentation = `
    import {definePresentation} from "@unframe/unframe-authoring";
    import {Hero} from "ui-kit";
    export default definePresentation({id: "deck", scene: [{id: "opening", component: Hero, props: {title: "Hi"}}]});
  `;
  const result = collectAuthoringDeclarations(
    analyze(component, presentation, undefined, [], true),
  );
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  expect(result.ok).toBe(true);
  expect(result.reactComponents[0]?.fileName).toBe("ui-kit@1/Hero.component.tsx");
  expect(result.declarations[0]?.value).toMatchObject({
    scene: [{ component: { id: "hero", version: 1 } }],
  });
  const analyzed = analyze(component, presentation, undefined, [], true);
  const extracted = extractReactComponents(analyzed);
  if (!extracted.ok) {
    throw new Error(JSON.stringify(extracted.diagnostics));
  }
  const react = extracted.components[0]!;
  const frozen = computeFrozenComponentInputs(analyzed.input, {
    components: [
      {
        manifest: { fileName: react.fileName, value: react.manifest },
        metadata: react.metadata,
        renderer: react.renderer,
        rendererEntry: react.manifest.renderers["baked-web"]?.entry,
      },
    ],
    themes: [],
  } as unknown as PairedAuthoringDeclarationCatalog);
  expect(frozen.valid).toBe(true);
  if (!frozen.valid) {
    throw new Error(JSON.stringify(frozen.diagnostics));
  }
  expect(frozen.value.componentLocks[0]?.origin).toEqual({
    kind: "package",
    packageKey: `sha256:${"2".repeat(64)}`,
    subpath: ".",
  });
  const withoutExport = {
    ...analyzed.input,
    packages: analyzed.input.packages.map((pkg) =>
      pkg.name === "ui-kit" ? { ...pkg, exports: [] } : pkg,
    ),
  };
  expect(
    computeFrozenComponentInputs(withoutExport, {
      components: [
        {
          manifest: { fileName: react.fileName, value: react.manifest },
          metadata: react.metadata,
          renderer: react.renderer,
          rendererEntry: react.manifest.renderers["baked-web"]?.entry,
        },
      ],
      themes: [],
    } as unknown as PairedAuthoringDeclarationCatalog),
  ).toMatchObject({
    diagnostics: [{ code: "compiler-frozen-input-invalid" }],
    valid: false,
  });
  const ambiguous = {
    ...analyzed.input,
    files: [
      ...analyzed.input.files,
      { fileName: "ui-kit@1/Hero.component.tsx", sourceText: "export const unrelated = 1;" },
    ],
  };
  expect(
    computeFrozenComponentInputs(ambiguous, {
      components: [
        {
          manifest: { fileName: react.fileName, value: react.manifest },
          metadata: react.metadata,
          renderer: react.renderer,
          rendererEntry: react.manifest.renderers["baked-web"]?.entry,
        },
      ],
      themes: [],
    } as unknown as PairedAuthoringDeclarationCatalog),
  ).toMatchObject({
    diagnostics: [{ code: "compiler-frozen-input-invalid" }],
    valid: false,
  });
}, 20_000);

it("typechecks a locked package Component in the React environment", () => {
  const presentation = `
    import {definePresentation} from "@unframe/unframe-authoring";
    import {Hero} from "ui-kit";
    export default definePresentation({id: "deck", scene: [{id: "opening", component: Hero, props: {title: "Hi"}}]});
  `;
  expect(() =>
    analyze(
      component.replace("decorate(label + texts.title)", "decorate(42)"),
      presentation,
      undefined,
      [],
      true,
    ),
  ).toThrow(/compiler-source-type-error/);
}, 20_000);

it("resolves a package Component through a local named barrel", () => {
  const presentation = `
    import {definePresentation} from "@unframe/unframe-authoring";
    import {Hero} from "./barrel";
    export default definePresentation({id: "deck", scene: [{id: "opening", component: Hero, props: {title: "Hi"}}]});
  `;
  const result = collectAuthoringDeclarations(
    analyze(
      component,
      presentation,
      undefined,
      [{ fileName: "barrel.ts", sourceText: 'import {Hero} from "ui-kit"; export {Hero};' }],
      true,
    ),
  );
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  expect(result.reactComponents).toHaveLength(1);
  expect(result.declarations[0]?.value).toMatchObject({
    scene: [{ component: { id: "hero", version: 1 } }],
  });
});

it("keeps a referenced render helper out of static DSL validation", () => {
  const source = component.replace(
    "const decorate = (value: string) => value;",
    'import {decorate} from "./helper";',
  );
  const presentation = `
    import {definePresentation} from "@unframe/unframe-authoring";
    import {Hero} from "./Hero.component";
    export default definePresentation({id: "deck", scene: [{id: "opening", component: Hero, props: {title: "Hi"}}]});
  `;
  const result = collectAuthoringDeclarations(
    analyze(source, presentation, undefined, [
      { fileName: "helper.ts", sourceText: "export const decorate = (value: string) => value;" },
    ]),
  );
  expect(result.ok).toBe(true);
});

it("still rejects an unrelated project module with a top-level call", () => {
  const presentation = `
    import {definePresentation} from "@unframe/unframe-authoring";
    import {Hero} from "./Hero.component";
    export default definePresentation({id: "deck", scene: [{id: "opening", component: Hero, props: {title: "Hi"}}]});
  `;
  const result = collectAuthoringDeclarations(
    analyze(component, presentation, undefined, [
      { fileName: "unrelated.ts", sourceText: "const value = (() => 1)(); export {value};" },
    ]),
  );
  expect(result).toMatchObject({ ok: false });
});

it("keeps a locked CSS side-effect import in the isolated render entry", () => {
  const result = extractReactComponents(
    analyze(`import "./components.css";\n${component}`, undefined, ".hero { color: white; }"),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.components[0]?.renderer.entrySource).toContain('import "./components.css";');
  expect(result.components[0]?.renderer.localDependencies).toEqual(["components.css"]);
});

it("rejects a side-effect import of the public contract runtime", () => {
  const result = extractReactComponents(
    analyze(`import "@unframe/unframe-authoring";\n${component}`),
  );
  expect(result).toMatchObject({
    diagnostics: [{ code: "compiler-react-render-contract-reference" }],
    ok: false,
  });
});

it("copies imported shared data as a literal and omits its source module", () => {
  const source = component.replace('const label = "Welcome ";', 'import {label} from "./shared";');
  const result = extractReactComponents(
    analyze(source, undefined, undefined, [
      { fileName: "shared.ts", sourceText: 'export const label = "Welcome ";' },
    ]),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.components[0]?.renderer.entrySource).toContain('const label = "Welcome ";');
  expect(result.components[0]?.renderer.entrySource).not.toContain('from "./shared"');
  expect(result.components[0]?.renderer.localDependencies).toEqual([]);
});

it("rejects a render helper that imports the contract runtime transitively", () => {
  const source = component.replace(
    "const decorate = (value: string) => value;",
    'import {decorate} from "./helper";',
  );
  const result = extractReactComponents(
    analyze(source, undefined, undefined, [
      {
        fileName: "helper.ts",
        sourceText:
          'import {defineComponent} from "@unframe/unframe-authoring"; export const decorate = (value: string) => value;',
      },
    ]),
  );
  expect(result).toMatchObject({
    diagnostics: [{ code: "compiler-react-render-contract-reference" }],
    ok: false,
  });
});

it("rejects dynamic imports in render dependencies", () => {
  const source = component.replace(
    "const decorate = (value: string) => value;",
    'const decorate = (value: string) => { void import("./helper"); return value; };',
  );
  const result = extractReactComponents(
    analyze(source, undefined, undefined, [
      { fileName: "helper.ts", sourceText: "export const helper = 1;" },
    ]),
  );
  expect(result).toMatchObject({
    diagnostics: [{ code: "compiler-react-render-dynamic-import-invalid" }],
    ok: false,
  });
});

it("typechecks React intrinsic JSX with its own JSX runtime", () => {
  const source = component.replace("decorate(label + texts.title)", "<h1>{texts.title}</h1>");
  const result = extractReactComponents(analyze(source));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.components[0]?.renderer.entrySource).toContain("<h1>{texts.title}</h1>");
  expect(result.components[0]?.renderer.packageImports).toContain("react/jsx-runtime");
});

it("provides the pinned TypeScript standard library to React render checking", () => {
  const source = component.replace(
    "const decorate = (value: string) => value;",
    'const decorate = (value: string) => { if (!value) throw new Error("empty"); return [value].map((item) => item).join(""); };',
  );
  const result = extractReactComponents(analyze(source));
  expect(result.ok).toBe(true);
});
