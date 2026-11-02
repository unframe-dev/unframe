/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { computeFrozenComponentInputs } from "../../src/source-preparation/index.js";
import { checkAuthoringProject } from "@unframe/source";

const libraryDirectory = dirname(createRequire(import.meta.url).resolve("typescript"));
const typeLibraries = readdirSync(libraryDirectory)
  .filter((name) => /^lib\..*\.d\.ts$/.test(name))
  .map((fileName) => ({
    fileName,
    sourceText: readFileSync(join(libraryDirectory, fileName), "utf8"),
  }));

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
  extraFiles: readonly { fileName: string; sourceText: string }[] = [],
  packaged = false,
) => {
  const input = {
    projectRoot: "/virtual",
    typeLibraries,
    entryFile: presentation ? "presentation.ts" : "Hero.component.tsx",
    files: [
      ...(packaged ? [] : [{ fileName: "Hero.component.tsx", sourceText }]),
      { fileName: "globals.d.ts", sourceText: "declare class Promise<T> {}" },
      ...(presentation ? [{ fileName: "presentation.ts", sourceText: presentation }] : []),
      ...extraFiles,
    ],
    rootDependencies: [
      { specifier: "@unframe/authoring", usage: "runtime", packageKey: hash },
      { specifier: "react", usage: "runtime", packageKey: reactHash },
      ...(packaged
        ? [{ specifier: "ui-kit", usage: "runtime", packageKey: `sha256:${"2".repeat(64)}` }]
        : []),
    ],
    packages: [
      {
        key: hash,
        locator: "@unframe/authoring@1",
        name: "@unframe/authoring",
        version: "1",
        contentIntegrity: hash,
        files: [
          { path: "index.ts", mediaType: "text/typescript", hash, encoding: "utf8", data: sdk },
        ],
        exports: [
          {
            subpath: ".",
            runtimeImport: "index.ts",
            runtimeRequire: null,
            types: "index.ts",
          },
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
      ...(packaged
        ? [
            {
              key: `sha256:${"2".repeat(64)}`,
              locator: "ui-kit@1",
              name: "ui-kit",
              version: "1",
              contentIntegrity: `sha256:${"2".repeat(64)}`,
              files: [
                {
                  path: "Hero.component.tsx",
                  mediaType: "text/tsx",
                  hash: `sha256:${"2".repeat(64)}`,
                  encoding: "utf8",
                  data: sourceText,
                },
                {
                  path: "index.d.ts",
                  mediaType: "text/typescript",
                  hash: `sha256:${"2".repeat(64)}`,
                  encoding: "utf8",
                  data: 'export { Hero } from "./Hero.component";',
                },
              ],
              exports: [
                {
                  subpath: ".",
                  runtimeImport: "Hero.component.tsx",
                  runtimeRequire: null,
                  types: "index.d.ts",
                },
              ],
              dependencies: [
                { specifier: "@unframe/authoring", usage: "runtime", packageKey: hash },
              ],
            },
          ]
        : []),
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
  };
  return input;
};

const component = `
  import { defineComponent, editableText, prop } from "@unframe/authoring";
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

it("freezes a package component resolved by the Source public API", () => {
  const presentation = `
    import {definePresentation} from "@unframe/authoring";
    import {Hero} from "ui-kit";
    export default definePresentation({id: "deck", metadata: { title: "Deck" }, stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] }, scene: [{id: "opening", component: Hero, owner: { kind: "presentation" }, audience: { kind: "all" }, parent: { kind: "stage" }, physicalSizeMeters: [1, 1], fit: "contain", transform: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] }, props: {title: "Hi"}}], assets: [], flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } } }, variables: {} }, operations: []});
  `;
  const input = analyze(component, presentation, undefined, [], true);
  const checked = checkAuthoringProject(input);
  if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
  const catalog = checked.value;
  const frozen = computeFrozenComponentInputs(input, catalog);
  expect(frozen.valid).toBe(true);
  if (!frozen.valid) throw new Error(JSON.stringify(frozen.diagnostics));
  expect(frozen.value.componentLocks[0]?.origin).toEqual({
    kind: "package",
    packageKey: `sha256:${"2".repeat(64)}`,
    subpath: ".",
  });
  const withoutExport = {
    ...input,
    packages: input.packages.map((pkg) => (pkg.name === "ui-kit" ? { ...pkg, exports: [] } : pkg)),
  };
  expect(computeFrozenComponentInputs(withoutExport, catalog)).toMatchObject({
    valid: false,
    diagnostics: [{ code: "compiler-frozen-input-invalid" }],
  });
  const ambiguous = {
    ...input,
    files: [
      ...input.files,
      { fileName: "ui-kit@1/Hero.component.tsx", sourceText: "export const unrelated = 1;" },
    ],
  };
  expect(computeFrozenComponentInputs(ambiguous, catalog)).toMatchObject({
    valid: false,
    diagnostics: [{ code: "compiler-frozen-input-invalid" }],
  });
}, 20000);
