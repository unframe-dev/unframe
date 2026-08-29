import { describe, expect, it } from "vitest";

import {
  checkAuthoringProject,
  type PairedAuthoringDeclarationCatalog,
  type PairedComponentDeclaration,
} from "../src/index.js";

const builders = [
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
]
  .map((name) => `export const ${name} = (...args: unknown[]) => { throw 0; };`)
  .join("\n");

const presentationSource = `
import { definePresentation } from "@unframe/presentation";
export default definePresentation({
  id: "presentation",
  metadata: { title: "Presentation" },
  stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] },
  scene: { spatial: [], components: [] },
  assets: [],
  flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } } }, variables: {} },
  operations: [],
});`;

const project = (files = [{ fileName: "entry.ts", sourceText: presentationSource }]) => ({
  projectRoot: "/virtual/presentation",
  entryFile: "entry.ts",
  files,
  packageDependencies: [
    { packageName: "@unframe/presentation", packageVersion: "1", packageIntegrity: "integrity" },
  ],
  packages: [
    {
      packageName: "@unframe/presentation",
      packageVersion: "1",
      packageIntegrity: "integrity",
      files: [{ fileName: "index.ts", sourceText: builders }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      dependencies: [],
    },
  ],
});

describe("checkAuthoringProject", () => {
  it("connects the virtual source frontend without executing builder implementations", () => {
    const result = checkAuthoringProject(project());
    expect(result).toMatchObject({
      valid: true,
      value: { presentation: { fileName: "entry.ts", value: { id: "presentation" } } },
    });
    if (!result.valid) return;
    const catalog: PairedAuthoringDeclarationCatalog = result.value;
    const component: PairedComponentDeclaration | undefined = catalog.components[0];
    expect(component).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value);
  });

  it("preserves parse diagnostics including source ranges and TypeScript codes", () => {
    const result = checkAuthoringProject(
      project([{ fileName: "entry.ts", sourceText: "const value = ;" }]),
    );
    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: "compiler-source-syntax-error",
          fileName: "entry.ts",
          message: "Expression expected.",
          start: 14,
          end: 15,
          line: 1,
          column: 15,
          typescriptCode: 1109,
        },
      ],
    });
  });

  it("fails closed for hostile project input", () => {
    const hostile = new Proxy(project(), {
      ownKeys() {
        throw new Error("must not run");
      },
    });
    expect(() => checkAuthoringProject(hostile)).not.toThrow();
    expect(checkAuthoringProject(hostile)).toMatchObject({ valid: false });
  });

  it("is deterministic when virtual project file order is reversed", () => {
    const files = [
      {
        fileName: "theme.unframe.ts",
        sourceText:
          'import { defineTheme } from "@unframe/presentation"; export default defineTheme({ id: "theme", tokens: {}, namedStyles: {} });',
      },
      { fileName: "entry.ts", sourceText: presentationSource },
    ];
    expect(checkAuthoringProject(project(files))).toEqual(
      checkAuthoringProject(project([...files].reverse())),
    );
  });
});
