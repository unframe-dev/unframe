import { describe, expect, it } from "vitest";

import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { collectPackageValueProvenance } from "../src/resolution/symbol-provenance.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

type PackageInput = {
  readonly packageName: string;
  readonly packageVersion?: string;
  readonly packageIntegrity?: string;
  readonly files: readonly { readonly fileName: string; readonly sourceText: string }[];
  readonly exports: readonly { readonly subpath: string; readonly targetFile: string }[];
  readonly dependencies?: readonly {
    readonly packageName: string;
    readonly packageVersion: string;
    readonly packageIntegrity: string;
  }[];
};

const lockedPackage = ({
  packageName,
  packageVersion = "1",
  packageIntegrity = "integrity",
  files,
  exports,
  dependencies = [],
}: PackageInput) => ({
  packageName,
  packageVersion,
  packageIntegrity,
  files,
  exports,
  dependencies,
});

const project = ({
  sourceText,
  files = [],
  packages = [],
}: {
  readonly sourceText: string;
  readonly files?: readonly { readonly fileName: string; readonly sourceText: string }[];
  readonly packages?: readonly ReturnType<typeof lockedPackage>[];
}) => {
  const parsed = parseAuthoringProject({
    projectRoot: "/virtual/presentation",
    entryFile: "presentation.ts",
    files: [{ fileName: "presentation.ts", sourceText }, ...files],
    packageDependencies: packages.map(({ packageName, packageVersion, packageIntegrity }) => ({
      packageName,
      packageVersion,
      packageIntegrity,
    })),
    packages,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
};

const analyze = (input: Parameters<typeof project>[0]) => analyzeAuthoringProject(project(input));

const provenance = (input: Parameters<typeof project>[0]) => {
  const result = analyze(input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return collectPackageValueProvenance(result);
};

const pkg = (sourceText = "export const value = 1;") =>
  lockedPackage({
    packageName: "pkg",
    files: [{ fileName: "index.ts", sourceText }],
    exports: [{ subpath: ".", targetFile: "index.ts" }],
  });

describe("collectPackageValueProvenance", () => {
  it("keeps every provenance field and UTF-16 range for a named alias", () => {
    const sourceText = 'import { value as alias } from "pkg";\nexport { alias };';
    const start = sourceText.indexOf("alias");

    expect(provenance({ sourceText, packages: [pkg()] })).toEqual([
      {
        packageName: "pkg",
        packageVersion: "1",
        packageIntegrity: "integrity",
        subpath: ".",
        exportName: "value",
        targetFile: "index.ts",
        declarationFile: "index.ts",
        fileName: "presentation.ts",
        start,
        end: start + "alias".length,
        line: 1,
        column: start + 1,
      },
    ]);
  });

  it("recognizes same-package index re-exports while retaining target and declaration files", () => {
    const sourceText = 'import { value } from "pkg"; export { value };';
    const result = provenance({
      sourceText,
      packages: [
        lockedPackage({
          packageName: "pkg",
          files: [
            { fileName: "index.ts", sourceText: 'export { value } from "./definitions";' },
            { fileName: "definitions.ts", sourceText: "export const value = 1;" },
          ],
          exports: [{ subpath: ".", targetFile: "index.ts" }],
        }),
      ],
    });

    expect(result).toMatchObject([
      { targetFile: "index.ts", declarationFile: "definitions.ts", exportName: "value" },
    ]);
  });

  it("omits local values with the same name", () => {
    expect(provenance({ sourceText: "const value = 1; export { value };" })).toEqual([]);
  });

  it("omits syntactic import type even when the export is a value", () => {
    expect(
      provenance({
        sourceText: 'import type { value } from "pkg"; export type { value };',
        packages: [pkg()],
      }),
    ).toEqual([]);
  });

  it("omits normal imports of semantic type-only exports", () => {
    expect(
      provenance({
        sourceText: 'import { Shape } from "pkg"; export type { Shape };',
        packages: [pkg("export interface Shape {}")],
      }),
    ).toEqual([]);
  });

  it("omits namespace and default imports", () => {
    expect(
      provenance({
        sourceText:
          'import * as namespace from "pkg"; export const viaNamespace = namespace.value;',
        packages: [pkg()],
      }),
    ).toEqual([]);
    expect(
      provenance({
        sourceText: 'import value from "pkg"; export { value };',
        packages: [pkg("export default 1;")],
      }),
    ).toEqual([]);
  });

  it("omits values imported through a project-local wrapper re-export", () => {
    expect(
      provenance({
        sourceText: 'import { value } from "./wrapper"; export { value };',
        files: [{ fileName: "wrapper.ts", sourceText: 'export { value } from "pkg";' }],
        packages: [pkg()],
      }),
    ).toEqual([]);
  });

  it("omits a package re-export that resolves to a different package owner", () => {
    const dependency = lockedPackage({
      packageName: "dependency",
      files: [{ fileName: "index.ts", sourceText: "export const value = 1;" }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });
    const owner = lockedPackage({
      packageName: "owner",
      files: [{ fileName: "index.ts", sourceText: 'export { value } from "dependency";' }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      dependencies: [
        { packageName: "dependency", packageVersion: "1", packageIntegrity: "integrity" },
      ],
    });

    expect(
      provenance({
        sourceText: 'import { value } from "owner"; export { value };',
        packages: [owner, dependency],
      }),
    ).toEqual([]);
  });

  it("recognizes direct dependency imports inside package sources with raw package display names", () => {
    const builder = lockedPackage({
      packageName: "builder",
      packageVersion: "2",
      packageIntegrity: "builder-integrity",
      files: [{ fileName: "index.ts", sourceText: "export const define = () => 1;" }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });
    const owner = lockedPackage({
      packageName: "owner",
      files: [
        {
          fileName: "index.ts",
          sourceText:
            'import { define as builderDefine } from "builder"; export const value = builderDefine();',
        },
      ],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      dependencies: [
        { packageName: "builder", packageVersion: "2", packageIntegrity: "builder-integrity" },
      ],
    });

    expect(provenance({ sourceText: 'import "owner";', packages: [owner, builder] })).toMatchObject(
      [
        {
          packageName: "builder",
          packageVersion: "2",
          packageIntegrity: "builder-integrity",
          exportName: "define",
          fileName: "owner@1/index.ts",
        },
      ],
    );
  });

  it("is canonical when package and file inputs are reversed", () => {
    const alpha = lockedPackage({
      packageName: "alpha",
      files: [{ fileName: "index.ts", sourceText: "export const alpha = 1;" }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });
    const beta = lockedPackage({
      packageName: "beta",
      files: [{ fileName: "index.ts", sourceText: "export const beta = 1;" }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });
    const sourceText = "export {};";
    const projectFiles = [
      { fileName: "alpha-use.ts", sourceText: 'import { alpha } from "alpha"; export { alpha };' },
      { fileName: "beta-use.ts", sourceText: 'import { beta } from "beta"; export { beta };' },
    ];

    const forward = provenance({ sourceText, files: projectFiles, packages: [alpha, beta] });
    const reversed = provenance({
      sourceText,
      files: [...projectFiles].reverse(),
      packages: [beta, alpha],
    });

    expect(reversed).toEqual(forward);
    expect(forward.map((item) => item.exportName)).toEqual(["alpha", "beta"]);
  });

  it("reports a stable nonempty diagnostic for an unavailable parsed entry source", () => {
    const parsed = project({ sourceText: "export const value = 1;" });
    const result = analyzeAuthoringProject({ ...parsed, entryFile: "missing.ts" });

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-project-entry-invariant-invalid",
          fileName: "",
          message: "Parsed project entry source is unavailable.",
          start: 0,
          end: 0,
          line: 1,
          column: 1,
        },
      ],
    });
  });
});
