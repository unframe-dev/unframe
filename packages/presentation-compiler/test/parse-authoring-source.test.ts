import { describe, expect, it } from "vitest";
import * as ts from "typescript";

import { parseAuthoringSource } from "../src/syntax/parse-authoring-source.js";

describe("parseAuthoringSource", () => {
  it("parses TSX with parent links without evaluating authoring code", () => {
    const result = parseAuthoringSource({
      fileName: "presentation.unframe.tsx",
      sourceText:
        'import { definePresentation } from "@unframe/presentation";\nexport default <main />;',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.value.statements).toHaveLength(2);
    expect(result.value.statements[0]?.parent).toBe(result.value);
    const exportStatement = result.value.statements[1];
    expect(exportStatement !== undefined && ts.isExportAssignment(exportStatement)).toBe(true);
    if (exportStatement !== undefined && ts.isExportAssignment(exportStatement))
      expect(ts.isJsxSelfClosingElement(exportStatement.expression)).toBe(true);
  });

  it("returns stable source ranges for TypeScript syntax errors", () => {
    const result = parseAuthoringSource({
      fileName: "presentation.unframe.ts",
      sourceText: "export const presentation = { title: ; };",
    });

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-source-syntax-error",
          fileName: "presentation.unframe.ts",
          message: "Expression expected.",
          start: 37,
          length: 1,
          line: 1,
          column: 38,
          typescriptCode: 1109,
        },
      ],
    });
  });

  it("rejects source kinds outside the TS and TSX authoring contract", () => {
    expect(
      parseAuthoringSource({
        fileName: "presentation.unframe.js",
        sourceText: "export default {};",
      }),
    ).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-source-kind-unsupported",
          fileName: "presentation.unframe.js",
          message: "Authoring source must use a .ts, .tsx, or .d.ts file name.",
          start: 0,
          length: 0,
          line: 1,
          column: 1,
        },
      ],
    });
  });

  it("rejects accessor and proxy source input without executing traps", () => {
    let reads = 0;
    const accessorInput = { fileName: "presentation.ts", sourceText: "export {};" };
    Object.defineProperty(accessorInput, "sourceText", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      },
    });
    const proxyInput = new Proxy(
      { fileName: "presentation.ts", sourceText: "export {};" },
      {
        ownKeys() {
          throw new Error("must not run");
        },
      },
    );

    for (const input of [accessorInput, proxyInput])
      expect(parseAuthoringSource(input)).toEqual({
        ok: false,
        diagnostics: [
          {
            code: "compiler-invalid-input",
            fileName: "",
            message: "Authoring source input cannot be inspected safely.",
            start: 0,
            length: 0,
            line: 1,
            column: 1,
          },
        ],
      });
    expect(reads).toBe(0);
  });

  it("rejects own prototype-shaped unknown source fields", () => {
    const input = { fileName: "presentation.ts", sourceText: "export {};" } as Record<
      string,
      unknown
    >;
    Object.defineProperty(input, "__proto__", { value: {}, enumerable: true });

    expect(parseAuthoringSource(input)).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-source-kind-unsupported",
          fileName: "",
          message: "Authoring source input must contain a file name and source text.",
          start: 0,
          length: 0,
          line: 1,
          column: 1,
        },
      ],
    });
  });
});
