import { assert, expect, it } from "vite-plus/test";
import { createAuthorPatch, inspectAuthorSource } from "../src/index.js";

const inspectScene = (scene: string, declarations = "") => {
  const sourceText = `
import { definePresentation } from "@unframe-dev/authoring";
${declarations}
export default definePresentation({
  id: "presentation",
  metadata: { title: "Presentation" },
  stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] },
  scene: ${scene},
  assets: [],
  flow: { initialGroupId: "main", groups: { main: { id: "main", initialStepId: "start", steps: { start: { id: "start", cues: [] } } } }, variables: {} },
  operations: [],
});`;
  return inspectAuthorSource({
    source: {
      projectRoot: "/virtual",
      entryFile: "presentation.tsx",
      files: [{ fileName: "presentation.tsx", sourceText }],
      rootDependencies: [
        {
          specifier: "@unframe-dev/authoring",
          usage: "runtime",
          packageKey: `sha256:${"a".repeat(64)}`,
        },
      ],
      packages: [
        {
          key: `sha256:${"a".repeat(64)}`,
          locator: "@unframe-dev/authoring@1",
          name: "@unframe-dev/authoring",
          version: "1",
          contentIntegrity: `sha256:${"b".repeat(64)}`,
          files: [
            {
              path: "index.ts",
              mediaType: "text/typescript",
              hash: `sha256:${"c".repeat(64)}`,
              encoding: "utf8",
              data: "export const definePresentation = <T>(value: T): T => value;",
            },
          ],
          exports: [
            { subpath: ".", runtimeImport: "index.ts", runtimeRequire: null, types: "index.ts" },
          ],
          dependencies: [],
        },
      ],
    },
    sourceText,
    semanticValid: true,
  });
};

it("leaves a valid structured scene available without Inspector editing diagnostics", () => {
  const result = inspectScene("{ spatial: [], components: [] }");
  assert(result.catalog.valid, JSON.stringify(result.catalog.diagnostics));
  expect(result.instances).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

it("inspects a directly declared React scene", () => {
  const result = inspectScene("[]");
  assert(result.catalog.valid, JSON.stringify(result.catalog.diagnostics));
  expect(result.instances).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

it("leaves a valid mixed scene without direct React Inspector editing diagnostics", () => {
  const result = inspectScene(`{ spatial: [], components: [{
    id: "hero", component: { id: "hero", version: 1 }, props: {},
    owner: { kind: "presentation" }, audience: { kind: "all" }, parent: { kind: "stage" },
    physicalSizeMeters: [1, 1], fit: "contain",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  }] }`);
  assert(result.catalog.valid, JSON.stringify(result.catalog.diagnostics));
  expect(result.instances).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

it("preserves Inspector diagnostics for React scenes that cannot be patched directly", () => {
  const result = inspectScene("sharedScene", "const sharedScene: [] = [];");
  assert(result.catalog.valid, JSON.stringify(result.catalog.diagnostics));
  expect(result.instances).toEqual([]);
  expect(result.diagnostics).toEqual([
    {
      code: "compiler-edit-scene-unsupported",
      message: "Scene items must be direct object literals in the current source.",
      path: [],
    },
  ]);
});

it("rejects a stale editing revision before parsing or patching its source", () => {
  expect(() =>
    createAuthorPatch({
      source: null,
      sourceText: "",
      entryFile: "presentation.tsx",
      revision: "old",
      snapshot: {
        revision: "current",
        sourceHash: "s",
        irHash: "i",
        definition: null,
        instances: [],
        diagnostics: [],
      },
      request: {
        commandId: "a".repeat(32),
        expectedIrHash: "i",
        command: { kind: "setProp", instanceId: "hero", propId: "title", value: "new" },
      },
    }),
  ).toThrow(expect.objectContaining({ code: "author-revision-mismatch", status: 412 }));
});

it("preserves syntax diagnostics when inspecting fixed Source without filesystem access", () => {
  const text = "export default = ;";
  const result = inspectAuthorSource({
    source: {
      projectRoot: "/virtual",
      entryFile: "entry.ts",
      files: [{ fileName: "entry.ts", sourceText: text }],
      rootDependencies: [],
      packages: [],
    },
    sourceText: text,
    semanticValid: false,
  });
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "compiler-source-syntax-error", family: "syntax" }),
  );
  expect(result.instances).toEqual([]);
});
