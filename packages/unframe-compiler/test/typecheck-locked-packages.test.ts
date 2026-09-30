import { describe, expect, it } from "vitest";

import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { typecheckAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";
import { analyzeAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";
import { collectPackageValueProvenance } from "../src/resolution/symbol-provenance.js";
import { hashCanonicalJsonPayload } from "@unframe/unframe-core";

type PackageInput = {
  dependencies?: Array<{ packageName: string; packageVersion: string; packageIntegrity: string }>;
  exports: Array<{ subpath: string; targetFile: string }>;
  files: Array<{ fileName: string; sourceText: string }>;
  packageIntegrity?: string;
  packageName: string;
  packageVersion?: string;
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

const virtualInput = (
  sourceText: string,
  packages: ReadonlyArray<ReturnType<typeof lockedPackage>>,
) => {
  const keyFor = (item: ReturnType<typeof lockedPackage>) =>
    hashCanonicalJsonPayload([item.packageName, item.packageVersion, item.packageIntegrity]);
  const snapshots = packages
    .map((item) => ({
      contentIntegrity: hashCanonicalJsonPayload(item),
      dependencies: item.dependencies.map((dependency) => ({
        packageKey: keyFor(dependency as ReturnType<typeof lockedPackage>),
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
        .sort((a, b) => a.path.localeCompare(b.path)),
      key: keyFor(item),
      locator: `${item.packageName}@${item.packageVersion}`,
      name: item.packageName,
      version: item.packageVersion,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    entryFile: "presentation.unframe.ts",
    files: [{ fileName: "presentation.unframe.ts", sourceText }],
    packages: snapshots,
    projectRoot: "/virtual/presentation",
    rootDependencies: packages
      .map((item) => ({ packageKey: keyFor(item), specifier: item.packageName, usage: "runtime" }))
      .sort((a, b) => a.specifier.localeCompare(b.specifier)),
  };
};
const project = (sourceText: string, packages: ReadonlyArray<ReturnType<typeof lockedPackage>>) => {
  const parsed = parseAuthoringProject(virtualInput(sourceText, packages));
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  return parsed.value;
};

describe("typecheckAuthoringProject locked packages", () => {
  it("derives direct locked package named value provenance through TypeChecker aliases", () => {
    const parsed = project('import { definePresentation as define } from "pkg"; define();', [
      lockedPackage({
        exports: [{ subpath: ".", targetFile: "index.ts" }],
        files: [
          {
            fileName: "index.ts",
            sourceText: "export const definePresentation = () => undefined;",
          },
        ],
        packageName: "pkg",
      }),
    ]);
    const analyzed = analyzeAuthoringProject(parsed);
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) {
      return;
    }
    expect(collectPackageValueProvenance(analyzed)).toMatchObject([
      {
        declarationFile: "index.ts",
        exportName: "definePresentation",
        packageName: "pkg",
        targetFile: "index.ts",
      },
    ]);
  });

  it("keeps a project source root when its logical path collides with a package namespace path", () => {
    const packageName = "pkg";
    const packageVersion = "1";
    const packageIntegrity = "integrity";
    const parsed = parseAuthoringProject({
      ...virtualInput("export const projectValue: string = 1;", [
        lockedPackage({
          exports: [{ subpath: ".", targetFile: "index.ts" }],
          files: [{ fileName: "index.ts", sourceText: "export const packageValue = 1;" }],
          packageIntegrity,
          packageName,
          packageVersion,
        }),
      ]),
      entryFile: "index.ts",
      files: [{ fileName: "index.ts", sourceText: "export const projectValue: string = 1;" }],
      projectRoot: "/.unframe/packages/p0070006B0067/p0031/p0069006E0074006500670072006900740079",
    });
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.diagnostics));
    }

    const result = typecheckAuthoringProject(parsed.value);

    expect(result).toMatchObject({
      diagnostics: [{ code: "compiler-source-type-error", fileName: "index.ts" }],
      ok: false,
    });
  });

  it("resolves a declared project package root and package-local relative module", () => {
    const result = typecheckAuthoringProject(
      project('import { value } from "pkg"; export const total: number = value;', [
        lockedPackage({
          exports: [{ subpath: ".", targetFile: "index.ts" }],
          files: [
            { fileName: "index.ts", sourceText: 'export { value } from "./inner.ts";' },
            { fileName: "inner.ts", sourceText: "export const value: number = 1;" },
          ],
          packageName: "pkg",
        }),
      ]),
    );

    expect(result).toEqual({ diagnostics: [], ok: true });
  });

  it("resolves ESM declaration files referenced through .mjs specifiers", () => {
    const result = typecheckAuthoringProject(
      project('import { value } from "pkg"; export const total: number = value;', [
        lockedPackage({
          exports: [{ subpath: ".", targetFile: "index.d.mts" }],
          files: [
            { fileName: "index.d.mts", sourceText: 'export { value } from "./value.mjs";' },
            { fileName: "value.d.mts", sourceText: "export declare const value: number;" },
          ],
          packageName: "pkg",
        }),
      ]),
    );

    expect(result).toEqual({ diagnostics: [], ok: true });
  });

  it("resolves a declaration file importing its package root index", () => {
    const result = typecheckAuthoringProject(
      project('import { value } from "pkg"; export const total: number = value;', [
        lockedPackage({
          exports: [{ subpath: ".", targetFile: "index.d.ts" }],
          files: [
            {
              fileName: "index.d.ts",
              sourceText: 'export declare const value: number; import "./jsx-runtime";',
            },
            { fileName: "jsx-runtime.d.ts", sourceText: 'export { value } from ".";' },
          ],
          packageName: "pkg",
        }),
      ]),
    );
    expect(result).toEqual({ diagnostics: [], ok: true });
  });

  it("ignores unreachable optional declaration imports in locked packages", () => {
    const result = typecheckAuthoringProject(
      project('import { value } from "pkg"; export const total: number = value;', [
        lockedPackage({
          exports: [{ subpath: ".", targetFile: "index.d.ts" }],
          files: [
            { fileName: "index.d.ts", sourceText: "export declare const value: number;" },
            { fileName: "optional.d.ts", sourceText: 'import "not-installed";' },
          ],
          packageName: "pkg",
        }),
      ]),
    );
    expect(result).toEqual({ diagnostics: [], ok: true });
  });

  it("resolves a package direct dependency through an explicit deep export", () => {
    const dependency = lockedPackage({
      exports: [{ subpath: "./deep", targetFile: "deep.ts" }],
      files: [{ fileName: "deep.ts", sourceText: "export const deep: number = 1;" }],
      packageName: "dependency",
    });
    const owner = lockedPackage({
      dependencies: [
        {
          packageIntegrity: dependency.packageIntegrity,
          packageName: "dependency",
          packageVersion: dependency.packageVersion,
        },
      ],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: 'export { deep } from "dependency/deep";' }],
      packageName: "owner",
    });

    expect(
      typecheckAuthoringProject(
        project('import { deep } from "owner"; export { deep };', [owner, dependency]),
      ),
    ).toEqual({ diagnostics: [], ok: true });
  });

  it("rejects undeclared and unexported bare imports with stable owner-aware diagnostics", () => {
    const pkg = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: 'import "undeclared"; export {};' }],
      packageName: "pkg",
    });
    const undeclared = typecheckAuthoringProject(project('import "undeclared";', []));
    const unexported = typecheckAuthoringProject(project('import "pkg/private";', [pkg]));
    const packageUndeclared = typecheckAuthoringProject(project('import "pkg";', [pkg]));

    for (const result of [undeclared, packageUndeclared]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.map((item) => item.code)).toContain(
          "compiler-module-package-unsupported",
        );
      }
    }
    expect(unexported.ok).toBe(false);
    if (!unexported.ok) {
      expect(unexported.diagnostics.map((item) => item.code)).toContain(
        "compiler-module-deep-import-forbidden",
      );
    }
  });

  it("validates literal import-type specifiers against direct dependencies and exact exports", () => {
    const pkg = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.d.ts" }],
      files: [{ fileName: "index.d.ts", sourceText: "export interface Public {}" }],
      packageName: "pkg",
    });
    const privateImport = typecheckAuthoringProject(
      project('type Private = import("pkg/private").Private;', [pkg]),
    );
    const unknownImport = typecheckAuthoringProject(
      project('type Unknown = import("unknown").Unknown;', []),
    );

    expect(privateImport).toMatchObject({
      diagnostics: [{ code: "compiler-module-deep-import-forbidden" }],
      ok: false,
    });
    expect(unknownImport).toMatchObject({
      diagnostics: [{ code: "compiler-module-package-unsupported" }],
      ok: false,
    });
  });

  it("resolves a type edge ahead of a runtime edge for the same specifier", () => {
    const runtime = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: "export const marker = 1;" }],
      packageName: "runtime-pkg",
    });
    const types = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.d.ts" }],
      files: [{ fileName: "index.d.ts", sourceText: "export declare const marker: string;" }],
      packageName: "types-pkg",
    });
    const value = virtualInput(
      'import { marker } from "runtime-pkg"; export const text: string = marker;',
      [runtime, types],
    );
    value.rootDependencies = [
      {
        packageKey: value.packages.find((pkg) => pkg.name === "runtime-pkg")!.key,
        specifier: "runtime-pkg",
        usage: "runtime",
      },
      {
        packageKey: value.packages.find((pkg) => pkg.name === "types-pkg")!.key,
        specifier: "runtime-pkg",
        usage: "types",
      },
    ];
    const parsed = parseAuthoringProject(value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(typecheckAuthoringProject(parsed.value)).toEqual({ diagnostics: [], ok: true });
  });

  it("does not require optional dependencies of otherwise unreachable locked packages", () => {
    const unreachable = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: 'import "unknown"; export {};' }],
      packageName: "unreachable",
    });

    const result = typecheckAuthoringProject(project("export {};", [unreachable]));

    expect(result).toEqual({ diagnostics: [], ok: true });
  });

  it("keeps package root escape, unresolved relative, and semantic diagnostics in raw package display names", () => {
    const escaping = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: 'import "../../outside";' }],
      packageName: "escaping",
    });
    const unresolved = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: 'import "./missing";' }],
      packageName: "unresolved",
    });
    const semantic = lockedPackage({
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      files: [{ fileName: "index.ts", sourceText: "export const title: string = 1;" }],
      packageName: "semantic",
    });
    const escaped = typecheckAuthoringProject(project('import "escaping";', [escaping]));
    const missing = typecheckAuthoringProject(project('import "unresolved";', [unresolved]));
    const typed = typecheckAuthoringProject(project('import "semantic";', [semantic]));

    expect(escaped).toMatchObject({
      diagnostics: [{ code: "compiler-module-root-escape", fileName: "escaping@1/index.ts" }],
      ok: false,
    });
    expect(typed).toMatchObject({
      diagnostics: [{ code: "compiler-source-type-error", fileName: "semantic@1/index.ts" }],
      ok: false,
    });
    expect(missing).toMatchObject({
      diagnostics: [{ code: "compiler-module-unresolved", fileName: "unresolved@1/index.ts" }],
      ok: false,
    });
  });

  it("does not leak ambient declarations from packages that are not reachable from project roots", () => {
    const ambient = lockedPackage({
      exports: [{ subpath: ".", targetFile: "global.d.ts" }],
      files: [{ fileName: "global.d.ts", sourceText: "declare const leaked: string;" }],
      packageName: "ambient",
    });

    const result = typecheckAuthoringProject(project("export const value = leaked;", [ambient]));

    expect(result).toMatchObject({
      diagnostics: [{ code: "compiler-source-type-error", fileName: "presentation.unframe.ts" }],
      ok: false,
    });
  });
});
