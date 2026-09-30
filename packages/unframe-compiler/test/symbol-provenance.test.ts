import { describe, expect, it } from "vitest";
import { hashCanonicalJsonPayload } from "@unframe/unframe-core";

import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { collectPackageValueProvenance } from "../src/resolution/symbol-provenance.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

type PackageInput = {
  readonly dependencies?: ReadonlyArray<{
    readonly packageName: string;
    readonly packageVersion: string;
    readonly packageIntegrity: string;
  }>;
  readonly exports: ReadonlyArray<{ readonly subpath: string; readonly targetFile: string }>;
  readonly files: ReadonlyArray<{ readonly fileName: string; readonly sourceText: string }>;
  readonly packageIntegrity?: string;
  readonly packageName: string;
  readonly packageVersion?: string;
};

const lockedPackage = ({
  dependencies = [],
  exports,
  files,
  packageIntegrity = "integrity",
  packageName,
  packageVersion = "1",
}: PackageInput) => ({
  dependencies,
  exports,
  files,
  packageIntegrity,
  packageName,
  packageVersion,
});

const project = ({
  files = [],
  packages = [],
  sourceText,
}: {
  readonly files?: ReadonlyArray<{ readonly fileName: string; readonly sourceText: string }>;
  readonly packages?: ReadonlyArray<ReturnType<typeof lockedPackage>>;
  readonly sourceText: string;
}) => {
  const keyFor = (item: {
    packageIntegrity: string;
    packageName: string;
    packageVersion: string;
  }) => hashCanonicalJsonPayload([item.packageName, item.packageVersion, item.packageIntegrity]);
  const snapshot = packages
    .map((item) => ({
      contentIntegrity: hashCanonicalJsonPayload(item),
      dependencies: item.dependencies.map((dependency) => ({
        packageKey: keyFor(dependency),
        specifier: dependency.packageName,
        usage: "runtime",
      })),
      exports: item.exports.map((entry) => ({
        runtimeImport: entry.targetFile,
        runtimeRequire: null,
        subpath: entry.subpath,
        types: entry.targetFile,
      })),
      files: item.files
        .map((file) => ({
          data: file.sourceText,
          encoding: "utf8",
          hash: hashCanonicalJsonPayload(file.sourceText),
          mediaType: "text/typescript",
          path: file.fileName,
        }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      key: keyFor(item),
      locator: `${item.packageName}@${item.packageVersion}`,
      name: item.packageName,
      version: item.packageVersion,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const parsed = parseAuthoringProject({
    entryFile: "presentation.ts",
    files: [{ fileName: "presentation.ts", sourceText }, ...files],
    packages: snapshot,
    projectRoot: "/virtual/presentation",
    rootDependencies: packages
      .map((item) => ({ packageKey: keyFor(item), specifier: item.packageName, usage: "runtime" }))
      .sort((a, b) => (a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0)),
  });
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  return parsed.value;
};

const analyze = (input: Parameters<typeof project>[0]) => analyzeAuthoringProject(project(input));

const provenance = (input: Parameters<typeof project>[0]) => {
  const result = analyze(input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return collectPackageValueProvenance(result);
};

const pkg = (sourceText = "export const value = 1;") =>
  lockedPackage({
    exports: [{ subpath: ".", targetFile: "index.ts" }],
    files: [{ fileName: "index.ts", sourceText }],
    packageName: "pkg",
  });

describe("collectPackageValueProvenance", () => {
  it("keeps every provenance field and UTF-16 range for a named alias", () => {
    const sourceText = 'import { value as alias } from "pkg";\nexport { alias };';
    const start = sourceText.indexOf("alias");

    expect(provenance({ packages: [pkg()], sourceText })).toEqual([
      {
        column: start + 1,
        declarationFile: "index.ts",
        end: start + "alias".length,
        exportName: "value",
        fileName: "presentation.ts",
        line: 1,
        packageIntegrity: hashCanonicalJsonPayload(pkg()),
        packageName: "pkg",
        packageVersion: "1",
        start,
        subpath: ".",
        targetFile: "index.ts",
      },
    ]);
  });

  it("recognizes same-package index re-exports while retaining target and declaration files", () => {
    const sourceText = 'import { value } from "pkg"; export { value };';
    const result = provenance({
      packages: [
        lockedPackage({
          exports: [{ subpath: ".", targetFile: "index.ts" }],
          files: [
            { fileName: "index.ts", sourceText: 'export { value } from "./definitions.ts";' },
            { fileName: "definitions.ts", sourceText: "export const value = 1;" },
          ],
          packageName: "pkg",
        }),
      ],
      sourceText,
    });

    expect(result).toMatchObject([
      { declarationFile: "definitions.ts", exportName: "value", targetFile: "index.ts" },
    ]);
  });

  it("omits local values with the same name", () => {
    expect(provenance({ sourceText: "const value = 1; export { value };" })).toEqual([]);
  });

  it("omits syntactic import type even when the export is a value", () => {
    expect(
      provenance({
        packages: [pkg()],
        sourceText: 'import type { value } from "pkg"; export type { value };',
      }),
    ).toEqual([]);
  });

  it("omits normal imports of semantic type-only exports", () => {
    expect(
      provenance({
        packages: [pkg("export interface Shape {}")],
        sourceText: 'import { Shape } from "pkg"; export type { Shape };',
      }),
    ).toEqual([]);
  });

  it("omits namespace and default imports", () => {
    expect(
      provenance({
        packages: [pkg()],
        sourceText:
          'import * as namespace from "pkg"; export const viaNamespace = namespace.value;',
      }),
    ).toEqual([]);
    expect(
      provenance({
        packages: [pkg("export default 1;")],
        sourceText: 'import value from "pkg"; export { value };',
      }),
    ).toEqual([]);
  });

  it("omits values imported through a project-local wrapper re-export", () => {
    expect(
      provenance({
        files: [{ fileName: "wrapper.ts", sourceText: 'export { value } from "pkg";' }],
        packages: [pkg()],
        sourceText: 'import { value } from "./wrapper"; export { value };',
      }),
    ).toEqual([]);
  });

  it("omits a package re-export that resolves to a different package owner", () => {
    const dependency = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: "export const value = 1;" }],
      packageName: "dependency",
    });
    const owner = lockedPackage({
      dependencies: [
        { packageIntegrity: "integrity", packageName: "dependency", packageVersion: "1" },
      ],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: 'export { value } from "dependency";' }],
      packageName: "owner",
    });

    expect(
      provenance({
        packages: [owner, dependency],
        sourceText: 'import { value } from "owner"; export { value };',
      }),
    ).toEqual([]);
  });

  it("recognizes direct dependency imports inside package sources with raw package display names", () => {
    const builder = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: "export const define = () => 1;" }],
      packageIntegrity: "builder-integrity",
      packageName: "builder",
      packageVersion: "2",
    });
    const owner = lockedPackage({
      dependencies: [
        { packageIntegrity: "builder-integrity", packageName: "builder", packageVersion: "2" },
      ],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [
        {
          fileName: "index.ts",
          sourceText:
            'import { define as builderDefine } from "builder"; export const value = builderDefine();',
        },
      ],
      packageName: "owner",
    });

    expect(provenance({ packages: [owner, builder], sourceText: 'import "owner";' })).toMatchObject(
      [
        {
          exportName: "define",
          fileName: "owner@1/index.ts",
          packageIntegrity: hashCanonicalJsonPayload(builder),
          packageName: "builder",
          packageVersion: "2",
        },
      ],
    );
  });

  it("is canonical when package and file inputs are reversed", () => {
    const alpha = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: "export const alpha = 1;" }],
      packageName: "alpha",
    });
    const beta = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: "export const beta = 1;" }],
      packageName: "beta",
    });
    const sourceText = "export {};";
    const projectFiles = [
      { fileName: "alpha-use.ts", sourceText: 'import { alpha } from "alpha"; export { alpha };' },
      { fileName: "beta-use.ts", sourceText: 'import { beta } from "beta"; export { beta };' },
    ];

    const forward = provenance({ files: projectFiles, packages: [alpha, beta], sourceText });
    const reversed = provenance({
      files: [...projectFiles].reverse(),
      packages: [beta, alpha],
      sourceText,
    });

    expect(reversed).toEqual(forward);
    expect(forward.map((item) => item.exportName)).toEqual(["alpha", "beta"]);
  });

  it("reports a stable nonempty diagnostic for an unavailable parsed entry source", () => {
    const parsed = project({ sourceText: "export const value = 1;" });
    const result = analyzeAuthoringProject({ ...parsed, entryFile: "missing.ts" });

    expect(result).toEqual({
      diagnostics: [
        {
          code: "compiler-project-entry-invariant-invalid",
          column: 1,
          end: 0,
          fileName: "",
          line: 1,
          message: "Parsed project entry source is unavailable.",
          start: 0,
        },
      ],
      ok: false,
    });
  });
});
