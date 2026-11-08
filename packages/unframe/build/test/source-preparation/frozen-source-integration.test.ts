/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { assert, expect, it } from "vite-plus/test";
import { reactResourceId, resolvePresentation } from "@unframe-dev/compiler";
import { modelGlb } from "../../../compiler/test/fixtures/model.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  assembleAuthoringProject,
  computeFrozenComponentInputs,
} from "../../src/source-preparation/index.js";
import { checkAuthoringProject } from "@unframe-dev/source";
import { prepareOpaquePrograms } from "../../src/source-preparation/opaque-programs.js";

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
      { specifier: "@unframe-dev/authoring", usage: "runtime", packageKey: hash },
      { specifier: "react", usage: "runtime", packageKey: reactHash },
      ...(packaged
        ? [{ specifier: "ui-kit", usage: "runtime", packageKey: `sha256:${"2".repeat(64)}` }]
        : []),
    ],
    packages: [
      {
        key: hash,
        locator: "@unframe-dev/authoring@1",
        name: "@unframe-dev/authoring",
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
                { specifier: "@unframe-dev/authoring", usage: "runtime", packageKey: hash },
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
  import { defineComponent, editableText, prop } from "@unframe-dev/authoring";
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

const opaqueProject = () => {
  const presentation = `
    import {definePresentation} from "@unframe-dev/authoring";
    import {Hero} from "./Hero.component";
    import {Aside} from "./Aside.component";
    export default definePresentation({
      id: "deck", metadata: {title: "Deck"},
      stage: {coordinateSystem: {unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z"}, size: [4, 3, 4]},
      scene: [
        {id: "opening", component: Hero, props: {title: "Opening"}, owner: {kind: "presentation"}, audience: {kind: "all"}, parent: {kind: "stage"}, physicalSizeMeters: [1, 1], fit: "contain", transform: {position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1]}},
        {id: "closing", component: Hero, props: {title: "Closing"}, owner: {kind: "presentation"}, audience: {kind: "all"}, parent: {kind: "stage"}, physicalSizeMeters: [1, 1], fit: "contain", transform: {position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1]}},
        {id: "aside", component: Aside, props: {title: "Aside"}, owner: {kind: "presentation"}, audience: {kind: "all"}, parent: {kind: "stage"}, physicalSizeMeters: [1, 1], fit: "contain", transform: {position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1]}}
      ],
      assets: [], flow: {initialGroupId: "group", groups: {group: {id: "group", initialStepId: "step", steps: {step: {id: "step", cues: []}}}}, variables: {}}, operations: []
    });
  `;
  const input = analyze(component, presentation, undefined, [
    {
      fileName: "Aside.component.tsx",
      sourceText: component
        .replace('id: "hero"', 'id: "aside"')
        .replace("const Hero", "const Aside")
        .replace("Welcome ", "Aside "),
    },
  ]);
  const domHash = `sha256:${"3".repeat(64)}`;
  const source = {
    ...input,
    rootDependencies: [
      ...input.rootDependencies,
      { specifier: "react-dom", usage: "runtime", packageKey: domHash },
    ],
    packages: [
      ...input.packages.map((pkg) =>
        pkg.name === "react"
          ? {
              ...pkg,
              files: [
                {
                  path: "index.ts",
                  mediaType: "text/typescript",
                  hash: reactHash,
                  encoding: "utf8",
                  data: "export const createElement = () => null;",
                },
                ...pkg.files,
              ],
              exports: [
                {
                  subpath: ".",
                  runtimeImport: "index.ts",
                  runtimeRequire: null,
                  types: "index.ts",
                },
                ...pkg.exports,
              ],
            }
          : pkg,
      ),
      {
        key: domHash,
        locator: "react-dom@1",
        name: "react-dom",
        version: "1",
        contentIntegrity: domHash,
        files: [
          {
            path: "client.ts",
            mediaType: "text/typescript",
            hash: domHash,
            encoding: "utf8",
            data: "export const createRoot = () => ({});",
          },
          {
            path: "index.ts",
            mediaType: "text/typescript",
            hash: domHash,
            encoding: "utf8",
            data: "export const flushSync = () => {};",
          },
        ],
        exports: [
          { subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" },
          {
            subpath: "./client",
            runtimeImport: "client.ts",
            runtimeRequire: null,
            types: "client.ts",
          },
        ],
        dependencies: [],
      },
    ],
  };
  const catalog = checkAuthoringProject(source);
  assert(catalog.valid, JSON.stringify(catalog.diagnostics));
  const frozen = computeFrozenComponentInputs(source, catalog.value);
  assert(frozen.valid, JSON.stringify(frozen.diagnostics));
  return {
    source,
    carrier: { themeHashes: [], componentLocks: frozen.value.componentLocks, assets: {} },
  };
};

it("bundles each shared React component once while preserving each instance's render inputs", async () => {
  const { source, carrier } = opaqueProject();
  let bundles = 0;
  const programs = await prepareOpaquePrograms(
    source,
    carrier,
    {},
    {
      bundle: async ({ rendererInputHash }) => {
        bundles++;
        return {
          ok: true,
          javascript: rendererInputHash,
          sourceMap: "map",
          stylesheets: [],
          assets: [],
        };
      },
      mediaTypeFor: () => "application/octet-stream",
    },
  );
  expect(bundles).toBe(2);
  expect(programs).toHaveLength(3);
  expect(programs.map((program) => program.props.title).sort()).toEqual([
    "Aside",
    "Closing",
    "Opening",
  ]);
  expect(new Set(programs.map((program) => program.entryId)).size).toBe(3);
  expect(new Set(programs.map((program) => program.moduleHash)).size).toBe(2);
  expect(programs.map((program) => program.javascript)).toEqual(
    programs.map((program) => program.moduleHash),
  );
  expect(programs.map((program) => program.stateKeysById)).toEqual(
    expect.arrayContaining([
      { [reactResourceId("state", "opening", "default")]: "default" },
      { [reactResourceId("state", "closing", "default")]: "default" },
      { [reactResourceId("state", "aside", "default")]: "default" },
    ]),
  );
}, 20000);

it("rejects stale component locks before bundling an opaque renderer", async () => {
  const { source, carrier } = opaqueProject();
  await expect(
    prepareOpaquePrograms(
      source,
      { ...carrier, componentLocks: [] },
      {},
      {
        bundle: async () => {
          throw new Error("Unexpected bundle execution");
        },
        mediaTypeFor: () => "application/octet-stream",
      },
    ),
  ).rejects.toMatchObject({
    diagnostics: [{ code: "compiler-frozen-component-lock-mismatch" }],
  });
}, 20000);

it("freezes a package component resolved by the Source public API", () => {
  const presentation = `
    import {definePresentation} from "@unframe-dev/authoring";
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

it("extracts and compiles a shared Timeline for a React surface and direct Model", () => {
  const presentation = `
    import { definePresentation } from "@unframe-dev/authoring";
    import { Hero } from "./Hero.component";
    export default definePresentation({
      id: "deck", metadata: { title: "Deck" },
      stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [4, 3, 4] },
      scene: [
        { id: "logo", model: { kind: "asset-ref", assetId: "logo-model" }, owner: { kind: "presentation" }, audience: { kind: "all" }, parent: { kind: "stage" }, opacity: 0, transform: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] } },
        { id: "text", component: Hero, props: { title: "Hello" }, owner: { kind: "presentation" }, audience: { kind: "all" }, parent: { kind: "stage" }, opacity: 0, physicalSizeMeters: [1,1], fit: "contain", transform: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] } },
      ],
      assets: [{ kind: "asset-ref", assetId: "logo-model" }],
      flow: {
        initialGroupId: "group", variables: {},
        timelines: [{ id: "opening", durationMilliseconds: 900, tracks: [
          { target: { kind: "instance", instanceId: "logo", property: "opacity" }, keyframes: [{ timeMilliseconds: 0, value: 0, easingToNext: "linear" }, { timeMilliseconds: 900, value: 1 }] },
          { target: { kind: "instance", instanceId: "text", property: "opacity" }, keyframes: [{ timeMilliseconds: 0, value: 0, easingToNext: "linear" }, { timeMilliseconds: 900, value: 1 }] },
        ] }],
        groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [
          { id: "start", trigger: { kind: "timer", afterMilliseconds: 1 }, actions: [{ kind: "timeline.play", timelineId: "opening", completion: "nonBlocking" }] },
          { id: "done", trigger: { kind: "timelineCompleted", timelineId: "opening" }, actions: [] },
        ] } } } },
      }, operations: [],
    });
  `;
  const input = analyze(component, presentation);
  const catalog = checkAuthoringProject(input);
  assert(catalog.valid, JSON.stringify(catalog.diagnostics));
  expect(catalog.value.components).toHaveLength(1);
  expect(catalog.value.presentation.value.scene).toMatchObject([
    { id: "logo", model: { kind: "asset-ref", assetId: "logo-model" } },
    { id: "text", component: { id: "hero", version: 1 } },
  ]);
  expect(catalog.value.presentation.value.flow.timelines).toMatchObject([
    {
      id: "opening",
      tracks: [{ target: { instanceId: "logo" } }, { target: { instanceId: "text" } }],
    },
  ]);
  const frozen = computeFrozenComponentInputs(input, catalog.value);
  assert(frozen.valid, JSON.stringify(frozen.diagnostics));
  const bytes = modelGlb();
  const checksum = `sha256:${bytesToHex(sha256(bytes))}`;
  const assembled = assembleAuthoringProject(
    input,
    {
      themeHashes: [],
      componentLocks: frozen.value.componentLocks,
      assets: {
        "logo-model": {
          id: "logo-model",
          mediaType: "model/gltf-binary",
          encodedSizeBytes: bytes.length,
          checksum,
        },
      },
    },
    { "logo-model": bytes },
  );
  assert(assembled.valid, JSON.stringify(assembled.diagnostics));
  const result = resolvePresentation(assembled.value.project);
  assert(result.valid, JSON.stringify(result.diagnostics));
  const logo = Object.values(result.value.scene.nodes).find((node) => node.name === "logo");
  const text = Object.values(result.value.scene.nodes).find((node) => node.name === "text");
  assert(logo?.kind === "model");
  assert(text?.kind === "surface");
  const [timeline] = Object.values(result.value.flow.timelines);
  assert(timeline);
  expect(timeline.tracks.map((track) => track.target.nodeId).sort()).toEqual(
    [logo.id, text.id].sort(),
  );
  const cues = result.value.flow.groups.group!.steps.step!.cues;
  expect(cues[0]?.trigger).toEqual({ kind: "timer", afterMilliseconds: 1 });
  expect(cues[0]?.actions).toMatchObject([{ kind: "timeline.play", timelineId: timeline.id }]);
  expect(cues[1]?.trigger).toEqual({ kind: "timelineCompleted", timelineId: timeline.id });
}, 20000);
