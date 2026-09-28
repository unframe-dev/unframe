import { expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { extractReactComponents } from "../src/project/extract-react-components.js";
import { collectAuthoringDeclarations } from "../src/project/collect-authoring-declarations.js";
import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

const sdk = `
  export const defineComponent = <T>(value: T): T => value;
  export const definePresentation = <T>(value: T): T => value;
  export const editableText = (value: {required: true}) => ({kind: "string" as const, ...value, editor: {kind: "text" as const}});
  export const prop = (name: string) => ({kind: "prop-ref" as const, name});
`;
const hash = `sha256:${"0".repeat(64)}`;
const reactHash = `sha256:${"1".repeat(64)}`;

const analyze = (
  sourceText: string,
  presentation?: string,
  rawCss?: string,
  extraFiles: readonly { fileName: string; sourceText: string }[] = [],
) => {
  const parsed = parseAuthoringProject({
    projectRoot: "/virtual",
    entryFile: presentation ? "presentation.ts" : "Hero.component.tsx",
    files: [
      { fileName: "Hero.component.tsx", sourceText },
      { fileName: "globals.d.ts", sourceText: "declare class Promise<T> {}" },
      ...(presentation ? [{ fileName: "presentation.ts", sourceText: presentation }] : []),
      ...extraFiles,
    ],
    rootDependencies: [
      { specifier: "@unframe/unframe-authoring", usage: "runtime", packageKey: hash },
      { specifier: "react", usage: "runtime", packageKey: reactHash },
    ],
    packages: [
      {
        key: hash,
        locator: "@unframe/unframe-authoring@1",
        name: "@unframe/unframe-authoring",
        version: "1",
        contentIntegrity: hash,
        files: [
          { path: "index.ts", mediaType: "text/typescript", hash, encoding: "utf8", data: sdk },
        ],
        exports: [
          { subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" },
        ],
        dependencies: [],
      },
      {
        key: reactHash,
        locator: "react@1",
        name: "react",
        version: "1",
        contentIntegrity: reactHash,
        files: [
          {
            path: "jsx-runtime.ts",
            mediaType: "text/typescript",
            hash: reactHash,
            encoding: "utf8",
            data: "export namespace JSX { export type Element = object; export interface IntrinsicElements { h1: {children?: unknown}; } } export const jsx = (..._args: unknown[]): object => ({}); export const jsxs = jsx;",
          },
        ],
        exports: [
          {
            subpath: "./jsx-runtime",
            runtimeImport: "jsx-runtime.ts",
            runtimeRequire: null,
            types: "jsx-runtime.ts",
          },
        ],
        dependencies: [],
      },
    ],
    ...(rawCss === undefined
      ? {}
      : {
          rawFiles: [
            {
              path: "components.css",
              mediaType: "text/css",
              encoding: "utf8",
              data: rawCss,
              hash: `sha256:${bytesToHex(sha256(new TextEncoder().encode(rawCss)))}`,
            },
          ],
        }),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const analyzed = analyzeAuthoringProject(parsed.value);
  if (!analyzed.ok) throw new Error(JSON.stringify(analyzed.diagnostics));
  return analyzed;
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

it("extracts public metadata and render dependencies without including contract initializers", () => {
  const result = extractReactComponents(analyze(component));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.components[0]?.metadata).toMatchObject({
    id: "hero",
    props: { title: { kind: "string", required: true, editor: { kind: "text" } } },
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
  if (!result.ok) return;
  expect(result.declarations.find((item) => item.role === "presentation")?.value).toMatchObject({
    scene: [{ component: { id: "hero", version: 1 } }],
  });
  expect(result.reactComponents).toHaveLength(1);
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
  if (!result.ok) return;
  expect(result.components[0]?.renderer.entrySource).toContain('import "./components.css";');
  expect(result.components[0]?.renderer.localDependencies).toEqual(["components.css"]);
});

it("rejects a side-effect import of the public contract runtime", () => {
  const result = extractReactComponents(
    analyze(`import "@unframe/unframe-authoring";\n${component}`),
  );
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [{ code: "compiler-react-render-contract-reference" }],
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
  if (!result.ok) return;
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
    ok: false,
    diagnostics: [{ code: "compiler-react-render-contract-reference" }],
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
    ok: false,
    diagnostics: [{ code: "compiler-react-render-dynamic-import-invalid" }],
  });
});

it("typechecks React intrinsic JSX with its own JSX runtime", () => {
  const source = component.replace("decorate(label + texts.title)", "<h1>{texts.title}</h1>");
  const result = extractReactComponents(analyze(source));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
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
