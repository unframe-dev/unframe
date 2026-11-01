import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createReactScenePatch, createSourceSnapshot } from "../src/index.js";

const hashText = (text: string) => `sha256:${bytesToHex(sha256(new TextEncoder().encode(text)))}`;

it("rejects a new same-length target hash against the old snapshot", () => {
  const oldText = 'export default "old";';
  const newText = 'export default "new";';
  expect(newText.length).toBe(oldText.length);
  const snapshot = createSourceSnapshot({
    projectRoot: "/virtual",
    entryFile: "entry.ts",
    files: [{ fileName: "entry.ts", sourceText: oldText }],
    rootDependencies: [],
    packages: [],
  });
  expect(snapshot.ok).toBe(true);
  if (!snapshot.ok) return;
  const result = createReactScenePatch({
    snapshot: snapshot.value,
    fileName: "entry.ts",
    targetHash: hashText(newText),
    command: { kind: "setProp", instanceId: "one", propId: "title", value: "new" },
  });
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [{ code: "source-target-hash-mismatch" }],
  });
});

it("rejects invalid snapshot source rather than accepting caller-provided catalog", () => {
  const result = createReactScenePatch({
    snapshot: { id: "revision", source: { files: [] } },
    fileName: "entry.ts",
    targetHash: hashText(""),
    command: { kind: "setProp", instanceId: "one", propId: "title", value: "new" },
  });
  expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "source-snapshot-invalid" }] });
});

it("rejects a changed snapshot even when its target hash matches the changed content", () => {
  const original = {
    projectRoot: "/virtual",
    entryFile: "entry.ts",
    files: [{ fileName: "entry.ts", sourceText: 'export default "old";' }],
    rootDependencies: [],
    packages: [],
  };
  const snapshot = createSourceSnapshot(original);
  expect(snapshot.ok).toBe(true);
  if (!snapshot.ok) return;
  const changed = {
    ...original,
    files: [{ fileName: "entry.ts", sourceText: 'export default "new";' }],
  };
  const result = createReactScenePatch({
    snapshot: { id: snapshot.value.id, source: changed },
    fileName: "entry.ts",
    targetHash: hashText(changed.files[0]!.sourceText),
    command: { kind: "setProp", instanceId: "one", propId: "title", value: "new" },
  });
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [{ code: "source-snapshot-hash-mismatch" }],
  });
});

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

it("creates a patch bound to the analyzed source snapshot and target hash", () => {
  const presentation = `import {definePresentation} from "@unframe/authoring";
    import {Hero} from "ui-kit";
    export default definePresentation({id: "deck", metadata: { title: "Deck" }, stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] }, scene: [{id: "opening", component: Hero, owner: { kind: "presentation" }, audience: { kind: "all" }, parent: { kind: "stage" }, physicalSizeMeters: [1, 1], fit: "contain", transform: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] }, props: {title: "Hi"}}], assets: [], flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } } }, variables: {} }, operations: []});`;
  const input = analyze(component, presentation, undefined, [], true);
  const snapshot = createSourceSnapshot(input);
  expect(snapshot.ok).toBe(true);
  if (!snapshot.ok) return;
  const targetHash = hashText(presentation);
  const result = createReactScenePatch({
    snapshot: snapshot.value,
    fileName: "presentation.ts",
    targetHash,
    command: { kind: "setProp", instanceId: "opening", propId: "title", value: "New" },
  });
  expect(result).toMatchObject({
    ok: true,
    value: { snapshotId: snapshot.value.id, fileName: "presentation.ts", targetHash },
  });
  if (result.ok) expect(result.value.sourceText).toContain('title: "New"');
}, 20000);
