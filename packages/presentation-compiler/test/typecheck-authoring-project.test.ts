import { describe, expect, it } from "vitest";

import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";
import { typecheckAuthoringProject } from "../src/resolution/typecheck-authoring-project.js";

const project = (files: readonly { fileName: string; sourceText: string }[]) => {
  const parsed = parseAuthoringProject({
    projectRoot: "/virtual/presentation",
    entryFile: "presentation.unframe.ts",
    files,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
};

describe("typecheckAuthoringProject", () => {
  it("resolves relative extensionless, .js, and index imports from virtual files only", () => {
    const result = typecheckAuthoringProject(
      project([
        {
          fileName: "presentation.unframe.ts",
          sourceText:
            'import { extensionless } from "./extensionless";\nimport { js } from "./js-target.js";\nimport { indexed } from "./directory";\nexport const value = extensionless + js + indexed;',
        },
        { fileName: "extensionless.ts", sourceText: "export const extensionless: number = 1;" },
        { fileName: "js-target.ts", sourceText: "export const js: number = 2;" },
        { fileName: "directory/index.d.ts", sourceText: "export declare const indexed: number;" },
      ]),
    );

    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it("reports semantic types with root-relative UTF-16 locations", () => {
    const result = typecheckAuthoringProject(
      project([
        {
          fileName: "presentation.unframe.ts",
          sourceText: 'export const title: string = "😀" as unknown as number;',
        },
      ]),
    );

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-source-type-error",
          fileName: "presentation.unframe.ts",
          message: "Type 'number' is not assignable to type 'string'.",
          start: 13,
          end: 18,
          line: 1,
          column: 14,
          typescriptCode: 2322,
        },
      ],
    });
  });

  it("uses explicit virtual declaration files instead of a host standard library", () => {
    const result = typecheckAuthoringProject(
      project([
        {
          fileName: "presentation.unframe.ts",
          sourceText: "export const title: string = virtualStandardLibraryValue;",
        },
        {
          fileName: "lib.d.ts",
          sourceText: "declare const virtualStandardLibraryValue: string;",
        },
      ]),
    );

    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it("applies strict ES2022 semantic checking", () => {
    const result = typecheckAuthoringProject(
      project([
        {
          fileName: "presentation.unframe.ts",
          sourceText:
            "export const callback = (value) => value;\nexport const title: string = undefined;",
        },
      ]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map((item) => item.typescriptCode)).toEqual(
        expect.arrayContaining([7006, 2322]),
      );
  });

  it("collects export-from and static dynamic-import module specifiers through public AST APIs", () => {
    const result = typecheckAuthoringProject(
      project([
        {
          fileName: "presentation.unframe.ts",
          sourceText: 'export { value } from "./exported";\nvoid import("./missing");',
        },
        { fileName: "exported.ts", sourceText: "export const value = 1;" },
      ]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map((item) => item.code)).toEqual(["compiler-module-unresolved"]);
  });

  it("resolves TSX and declaration imports with their matching TypeScript extensions", () => {
    const result = typecheckAuthoringProject(
      project([
        {
          fileName: "presentation.unframe.ts",
          sourceText:
            'import { tsxValue } from "./component";\nimport { declarationValue } from "./declaration";\nexport const total: number = tsxValue + declarationValue;',
        },
        { fileName: "component.tsx", sourceText: "export const tsxValue: number = 1;" },
        {
          fileName: "declaration.d.ts",
          sourceText: "export declare const declarationValue: number;",
        },
      ]),
    );

    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it("fails closed for project-root escapes, unresolved relative imports, and bare packages", () => {
    const cases = [
      ['import "../../outside";', "compiler-module-root-escape"],
      ['import "/outside";', "compiler-module-root-escape"],
      ['import "./missing";', "compiler-module-unresolved"],
      ['import ".private-package";', "compiler-module-package-unsupported"],
      ['import "@unframe/presentation";', "compiler-module-package-unsupported"],
    ] as const;

    for (const [sourceText, code] of cases) {
      const result = typecheckAuthoringProject(
        project([{ fileName: "presentation.unframe.ts", sourceText }]),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics.map((item) => item.code)).toContain(code);
    }
  });

  it("does not resolve an explicit source extension through an index fallback", () => {
    const result = typecheckAuthoringProject(
      project([
        { fileName: "presentation.unframe.ts", sourceText: 'import "./module.ts";' },
        { fileName: "module.ts/index.ts", sourceText: "export {};" },
      ]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.map((item) => item.code)).toEqual(["compiler-module-unresolved"]);
  });
});
