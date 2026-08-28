import { describe, expect, it } from "vitest";

import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { typecheckAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

type PackageInput = {
  packageName: string;
  packageVersion?: string;
  packageIntegrity?: string;
  files: { fileName: string; sourceText: string }[];
  exports: { subpath: string; targetFile: string }[];
  dependencies?: { packageName: string; packageVersion: string; packageIntegrity: string }[];
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

const project = (sourceText: string, packages: readonly ReturnType<typeof lockedPackage>[]) => {
  const parsed = parseAuthoringProject({
    projectRoot: "/virtual/presentation",
    entryFile: "presentation.unframe.ts",
    files: [{ fileName: "presentation.unframe.ts", sourceText }],
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

describe("typecheckAuthoringProject locked packages", () => {
  it("keeps a project source root when its logical path collides with a package namespace path", () => {
    const packageName = "pkg";
    const packageVersion = "1";
    const packageIntegrity = "integrity";
    const parsed = parseAuthoringProject({
      projectRoot: "/.unframe/packages/p0070006B0067/p0031/p0069006E0074006500670072006900740079",
      entryFile: "index.ts",
      files: [{ fileName: "index.ts", sourceText: "export const projectValue: string = 1;" }],
      packageDependencies: [{ packageName, packageVersion, packageIntegrity }],
      packages: [
        lockedPackage({
          packageName,
          packageVersion,
          packageIntegrity,
          files: [{ fileName: "index.ts", sourceText: "export const packageValue = 1;" }],
          exports: [{ subpath: ".", targetFile: "index.ts" }],
        }),
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));

    const result = typecheckAuthoringProject(parsed.value);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "compiler-source-type-error", fileName: "index.ts" }],
    });
  });

  it("resolves a declared project package root and package-local relative module", () => {
    const result = typecheckAuthoringProject(
      project('import { value } from "pkg"; export const total: number = value;', [
        lockedPackage({
          packageName: "pkg",
          files: [
            { fileName: "index.ts", sourceText: 'export { value } from "./inner";' },
            { fileName: "inner.ts", sourceText: "export const value: number = 1;" },
          ],
          exports: [{ subpath: ".", targetFile: "index.ts" }],
        }),
      ]),
    );

    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it("resolves a package direct dependency through an explicit deep export", () => {
    const dependency = lockedPackage({
      packageName: "dependency",
      files: [{ fileName: "deep.ts", sourceText: "export const deep: number = 1;" }],
      exports: [{ subpath: "./deep", targetFile: "deep.ts" }],
    });
    const owner = lockedPackage({
      packageName: "owner",
      files: [{ fileName: "index.ts", sourceText: 'export { deep } from "dependency/deep";' }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      dependencies: [
        {
          packageName: "dependency",
          packageVersion: dependency.packageVersion,
          packageIntegrity: dependency.packageIntegrity,
        },
      ],
    });

    expect(
      typecheckAuthoringProject(
        project('import { deep } from "owner"; export { deep };', [owner, dependency]),
      ),
    ).toEqual({ ok: true, diagnostics: [] });
  });

  it("rejects undeclared and unexported bare imports with stable owner-aware diagnostics", () => {
    const pkg = lockedPackage({
      packageName: "pkg",
      files: [{ fileName: "index.ts", sourceText: 'import "undeclared"; export {};' }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });
    const undeclared = typecheckAuthoringProject(project('import "undeclared";', []));
    const unexported = typecheckAuthoringProject(project('import "pkg/private";', [pkg]));
    const packageUndeclared = typecheckAuthoringProject(project('import "pkg";', [pkg]));

    for (const result of [undeclared, packageUndeclared]) {
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.diagnostics.map((item) => item.code)).toContain(
          "compiler-module-package-unsupported",
        );
    }
    expect(unexported.ok).toBe(false);
    if (!unexported.ok)
      expect(unexported.diagnostics.map((item) => item.code)).toContain(
        "compiler-module-deep-import-forbidden",
      );
  });

  it("validates literal import-type specifiers against direct dependencies and exact exports", () => {
    const pkg = lockedPackage({
      packageName: "pkg",
      files: [{ fileName: "index.d.ts", sourceText: "export interface Public {}" }],
      exports: [{ subpath: ".", targetFile: "index.d.ts" }],
    });
    const privateImport = typecheckAuthoringProject(
      project('type Private = import("pkg/private").Private;', [pkg]),
    );
    const unknownImport = typecheckAuthoringProject(
      project('type Unknown = import("unknown").Unknown;', []),
    );

    expect(privateImport).toMatchObject({
      ok: false,
      diagnostics: [{ code: "compiler-module-deep-import-forbidden" }],
    });
    expect(unknownImport).toMatchObject({
      ok: false,
      diagnostics: [{ code: "compiler-module-package-unsupported" }],
    });
  });

  it("preflights module specifiers in otherwise unreachable locked packages", () => {
    const unreachable = lockedPackage({
      packageName: "unreachable",
      files: [{ fileName: "index.ts", sourceText: 'import "unknown"; export {};' }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });

    const result = typecheckAuthoringProject(project("export {};", [unreachable]));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        { code: "compiler-module-package-unsupported", fileName: "unreachable@1/index.ts" },
      ],
    });
  });

  it("keeps package root escape, unresolved relative, and semantic diagnostics in raw package display names", () => {
    const escaping = lockedPackage({
      packageName: "escaping",
      files: [{ fileName: "index.ts", sourceText: 'import "../../outside";' }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });
    const unresolved = lockedPackage({
      packageName: "unresolved",
      files: [{ fileName: "index.ts", sourceText: 'import "./missing";' }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });
    const semantic = lockedPackage({
      packageName: "semantic",
      files: [{ fileName: "index.ts", sourceText: "export const title: string = 1;" }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
    });
    const escaped = typecheckAuthoringProject(project('import "escaping";', [escaping]));
    const missing = typecheckAuthoringProject(project('import "unresolved";', [unresolved]));
    const typed = typecheckAuthoringProject(project('import "semantic";', [semantic]));

    expect(escaped).toMatchObject({
      ok: false,
      diagnostics: [{ code: "compiler-module-root-escape", fileName: "escaping@1/index.ts" }],
    });
    expect(typed).toMatchObject({
      ok: false,
      diagnostics: [{ code: "compiler-source-type-error", fileName: "semantic@1/index.ts" }],
    });
    expect(missing).toMatchObject({
      ok: false,
      diagnostics: [{ code: "compiler-module-unresolved", fileName: "unresolved@1/index.ts" }],
    });
  });

  it("does not leak ambient declarations from packages that are not reachable from project roots", () => {
    const ambient = lockedPackage({
      packageName: "ambient",
      files: [{ fileName: "global.d.ts", sourceText: "declare const leaked: string;" }],
      exports: [{ subpath: ".", targetFile: "global.d.ts" }],
    });

    const result = typecheckAuthoringProject(project("export const value = leaked;", [ambient]));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "compiler-source-type-error", fileName: "presentation.unframe.ts" }],
    });
  });
});
