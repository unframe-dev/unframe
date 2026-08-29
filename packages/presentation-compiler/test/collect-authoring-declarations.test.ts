import { describe, expect, it } from "vitest";

import { collectAuthoringDeclarations } from "../src/project/collect-authoring-declarations.js";
import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

const builders = [
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
]
  .map((name) => `export const ${name} = (...args: unknown[]) => { throw 0; };`)
  .join("\n");

const analyze = (
  files: readonly { readonly fileName: string; readonly sourceText: string }[],
  entryFile = "entry.ts",
) => {
  const parsed = parseAuthoringProject({
    projectRoot: "/virtual/presentation",
    entryFile,
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
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const result = analyzeAuthoringProject(parsed.value);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
};

const source = (builder: string, value = "{}") =>
  `import { ${builder} } from "@unframe/presentation"; export default ${builder}(${value});`;

describe("collectAuthoringDeclarations", () => {
  it("rejects a declaration entry file without treating it as a skipped ambient file", () => {
    const result = collectAuthoringDeclarations(
      analyze(
        [{ fileName: "entry.d.ts", sourceText: "declare const value: {}; export default value;" }],
        "entry.d.ts",
      ),
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-declaration-entry-file-unsupported",
          fileName: "entry.d.ts",
          message: "The declaration entry file must not use the .d.ts suffix.",
          start: 0,
          end: 0,
          line: 1,
          column: 1,
        },
      ],
    });
  });

  it("canonically aggregates entry ambient and independent project failures", () => {
    const result = collectAuthoringDeclarations(
      analyze(
        [
          { fileName: "entry.d.ts", sourceText: "declare const value: {}; export default value;" },
          { fileName: "a.ts", sourceText: "export {};" },
          {
            fileName: "z.unframe.ts",
            sourceText:
              'import { defineTheme } from "@unframe/presentation"; export default defineTheme();',
          },
        ],
        "entry.d.ts",
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.diagnostics.map(({ fileName, code }) => ({ fileName, code }))).toEqual([
      { fileName: "a.ts", code: "compiler-declaration-file-role-unsupported" },
      { fileName: "entry.d.ts", code: "compiler-declaration-entry-file-unsupported" },
      { fileName: "z.unframe.ts", code: "compiler-static-builder-arguments-invalid" },
    ]);
  });

  it("collects all four roles deterministically without executing builders", () => {
    const files = [
      { fileName: "entry.ts", sourceText: source("definePresentation", '{ id: "presentation" }') },
      { fileName: "theme.unframe.ts", sourceText: source("defineTheme", '{ id: "theme" }') },
      {
        fileName: "button.manifest.ts",
        sourceText: source("defineComponentManifest", '{ id: "manifest" }'),
      },
      {
        fileName: "button.structure.tsx",
        sourceText: source("defineComponentStructure", '{ id: "structure" }'),
      },
    ];
    const first = collectAuthoringDeclarations(analyze(files));
    const second = collectAuthoringDeclarations(analyze([...files].reverse()));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      declarations: [
        {
          role: "component-manifest",
          fileName: "button.manifest.ts",
          rootBuilder: "defineComponentManifest",
          value: { id: "manifest" },
        },
        {
          role: "component-structure",
          fileName: "button.structure.tsx",
          rootBuilder: "defineComponentStructure",
          value: { id: "structure" },
        },
        {
          role: "presentation",
          fileName: "entry.ts",
          rootBuilder: "definePresentation",
          value: { id: "presentation" },
        },
        {
          role: "theme",
          fileName: "theme.unframe.ts",
          rootBuilder: "defineTheme",
          value: { id: "theme" },
        },
      ],
    });
  });

  it("skips ambient declarations and package-owned files while rejecting unsupported project suffixes", () => {
    const result = collectAuthoringDeclarations(
      analyze([
        { fileName: "entry.ts", sourceText: source("definePresentation") },
        { fileName: "ambient.d.ts", sourceText: "declare const ignored: string;" },
        { fileName: "helper.ts", sourceText: "export {};" },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-declaration-file-role-unsupported",
          fileName: "helper.ts",
          message: "Project declaration files must use a recognized declaration suffix.",
          start: 0,
          end: 0,
          line: 1,
          column: 1,
        },
      ],
    });
  });

  it("reports a role mismatch at the root call origin", () => {
    const sourceText = source("defineTheme");
    const result = collectAuthoringDeclarations(analyze([{ fileName: "entry.ts", sourceText }]));
    const start = sourceText.lastIndexOf("defineTheme({})");
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-declaration-root-mismatch",
          fileName: "entry.ts",
          message: "Declaration file root builder does not match its file role.",
          start,
          end: start + "defineTheme({})".length,
          line: 1,
          column: start + 1,
        },
      ],
    });
  });

  it("canonically aggregates independent declaration failures", () => {
    const result = collectAuthoringDeclarations(
      analyze([
        { fileName: "entry.ts", sourceText: source("defineTheme") },
        {
          fileName: "z.unframe.ts",
          sourceText:
            'import { defineTheme } from "@unframe/presentation"; export default defineTheme();',
        },
        { fileName: "a.ts", sourceText: "export {};" },
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.diagnostics.map(({ fileName, code }) => ({ fileName, code }))).toEqual([
      { fileName: "a.ts", code: "compiler-declaration-file-role-unsupported" },
      { fileName: "entry.ts", code: "compiler-declaration-root-mismatch" },
      { fileName: "z.unframe.ts", code: "compiler-static-builder-arguments-invalid" },
    ]);
  });
});
