import { describe, expect, it } from "vitest";
import { hashCanonicalJsonPayload } from "@unframe/unframe-core";

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
  files: ReadonlyArray<{ readonly fileName: string; readonly sourceText: string }>,
  entryFile = "entry.ts",
) => {
  const parsed = parseAuthoringProject({
    entryFile,
    files,
    packages: [
      {
        contentIntegrity: hashCanonicalJsonPayload(builders),
        dependencies: [],
        exports: [
          { runtimeImport: "index.ts", runtimeRequire: null, subpath: ".", types: "index.ts" },
        ],
        files: [
          {
            data: builders,
            encoding: "utf8",
            hash: hashCanonicalJsonPayload(builders),
            mediaType: "text/typescript",
            path: "index.ts",
          },
        ],
        key: hashCanonicalJsonPayload(["@unframe/unframe-authoring", "1"]),
        locator: "@unframe/unframe-authoring@1",
        name: "@unframe/unframe-authoring",
        version: "1",
      },
    ],
    projectRoot: "/virtual/presentation",
    rootDependencies: [
      {
        packageKey: hashCanonicalJsonPayload(["@unframe/unframe-authoring", "1"]),
        specifier: "@unframe/unframe-authoring",
        usage: "runtime",
      },
    ],
  });
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  const result = analyzeAuthoringProject(parsed.value);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result;
};

const source = (builder: string, value = "{}") =>
  `import { ${builder} } from "@unframe/unframe-authoring"; export default ${builder}(${value});`;

describe("collectAuthoringDeclarations", () => {
  it("rejects a declaration entry file without treating it as a skipped ambient file", () => {
    const result = collectAuthoringDeclarations(
      analyze(
        [
          {
            fileName: "entry.d.ts",
            sourceText: "declare const value: {}; export default value;",
          },
        ],
        "entry.d.ts",
      ),
    );
    expect(result).toEqual({
      diagnostics: [
        {
          code: "compiler-declaration-entry-file-unsupported",
          column: 1,
          end: 0,
          fileName: "entry.d.ts",
          line: 1,
          message: "The declaration entry file must not use the .d.ts suffix.",
          start: 0,
        },
      ],
      ok: false,
    });
  });

  it("canonically aggregates entry ambient and independent project failures", () => {
    const result = collectAuthoringDeclarations(
      analyze(
        [
          {
            fileName: "entry.d.ts",
            sourceText: "declare const value: {}; export default value;",
          },
          { fileName: "a.ts", sourceText: "export {};" },
          {
            fileName: "z.unframe.ts",
            sourceText:
              'import { defineTheme } from "@unframe/unframe-authoring"; export default defineTheme();',
          },
        ],
        "entry.d.ts",
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map(({ code, fileName }) => ({ code, fileName }))).toEqual([
      {
        code: "compiler-declaration-entry-file-unsupported",
        fileName: "entry.d.ts",
      },
      {
        code: "compiler-static-builder-arguments-invalid",
        fileName: "z.unframe.ts",
      },
    ]);
  });

  it("collects all four roles deterministically without executing builders", () => {
    const files = [
      {
        fileName: "entry.ts",
        sourceText: source("definePresentation", '{ id: "presentation" }'),
      },
      {
        fileName: "theme.unframe.ts",
        sourceText: source("defineTheme", '{ id: "theme" }'),
      },
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
      declarations: [
        {
          fileName: "button.manifest.ts",
          role: "component-manifest",
          rootBuilder: "defineComponentManifest",
          value: { id: "manifest" },
        },
        {
          fileName: "button.structure.tsx",
          role: "component-structure",
          rootBuilder: "defineComponentStructure",
          value: { id: "structure" },
        },
        {
          fileName: "entry.ts",
          role: "presentation",
          rootBuilder: "definePresentation",
          value: { id: "presentation" },
        },
        {
          fileName: "theme.unframe.ts",
          role: "theme",
          rootBuilder: "defineTheme",
          value: { id: "theme" },
        },
      ],
      ok: true,
    });
  });

  it("skips ambient and safe helper modules while collecting declaration suffixes only", () => {
    const result = collectAuthoringDeclarations(
      analyze([
        { fileName: "entry.ts", sourceText: source("definePresentation") },
        {
          fileName: "ambient.d.ts",
          sourceText: "declare const ignored: string;",
        },
        { fileName: "helper.ts", sourceText: "export {};" },
      ]),
    );
    expect(result).toMatchObject({
      declarations: [{ fileName: "entry.ts" }],
      ok: true,
    });
  });

  it("reports a role mismatch at the root call origin", () => {
    const sourceText = source("defineTheme");
    const result = collectAuthoringDeclarations(analyze([{ fileName: "entry.ts", sourceText }]));
    const start = sourceText.lastIndexOf("defineTheme({})");
    expect(result).toEqual({
      diagnostics: [
        {
          code: "compiler-declaration-root-mismatch",
          column: start + 1,
          end: start + "defineTheme({})".length,
          fileName: "entry.ts",
          line: 1,
          message: "Declaration file root builder does not match its file role.",
          start,
        },
      ],
      ok: false,
    });
  });

  it("canonically aggregates independent declaration failures", () => {
    const result = collectAuthoringDeclarations(
      analyze([
        { fileName: "entry.ts", sourceText: source("defineTheme") },
        {
          fileName: "z.unframe.ts",
          sourceText:
            'import { defineTheme } from "@unframe/unframe-authoring"; export default defineTheme();',
        },
        { fileName: "a.ts", sourceText: "export {};" },
      ]),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map(({ code, fileName }) => ({ code, fileName }))).toEqual([
      {
        code: "compiler-static-builder-arguments-invalid",
        fileName: "z.unframe.ts",
      },
    ]);
  });
});
