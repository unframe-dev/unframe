import { describe, expect, it } from "vitest";
import * as ts from "typescript";

import { parseAuthoringSource } from "../src/syntax/parse-authoring-source.js";

describe("parseAuthoringSource", () => {
  it("parses TSX with parent links without evaluating authoring code", () => {
    const result = parseAuthoringSource({
      fileName: "presentation.unframe.tsx",
      sourceText:
        'import { definePresentation } from "@unframe/unframe-authoring";\nexport default <main />;',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.diagnostics).toEqual([]);
    expect(result.value.statements).toHaveLength(2);
    expect(result.value.statements[0]?.parent).toBe(result.value);
    const exportStatement = result.value.statements[1];
    expect(exportStatement !== undefined && ts.isExportAssignment(exportStatement)).toBe(true);
    if (exportStatement !== undefined && ts.isExportAssignment(exportStatement)) {
      expect(ts.isJsxSelfClosingElement(exportStatement.expression)).toBe(true);
    }
  });

  it("returns stable source ranges for TypeScript syntax errors", () => {
    const result = parseAuthoringSource({
      fileName: "presentation.unframe.ts",
      sourceText: "export const presentation = { title: ; };",
    });

    expect(result).toEqual({
      diagnostics: [
        {
          code: "compiler-source-syntax-error",
          column: 38,
          fileName: "presentation.unframe.ts",
          length: 1,
          line: 1,
          message: "Expression expected.",
          start: 37,
          typescriptCode: 1109,
        },
      ],
      ok: false,
    });
  });

  it("rejects source kinds outside the TS and TSX authoring contract", () => {
    expect(
      parseAuthoringSource({
        fileName: "presentation.unframe.js",
        sourceText: "export default {};",
      }),
    ).toEqual({
      diagnostics: [
        {
          code: "compiler-source-kind-unsupported",
          column: 1,
          fileName: "presentation.unframe.js",
          length: 0,
          line: 1,
          message: "Authoring source must use a TypeScript source or declaration file name.",
          start: 0,
        },
      ],
      ok: false,
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

    for (const input of [accessorInput, proxyInput]) {
      expect(parseAuthoringSource(input)).toEqual({
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
        ok: false,
      });
    }
    expect(reads).toBe(0);
  });

  it("rejects own prototype-shaped unknown source fields", () => {
    const input = { fileName: "presentation.ts", sourceText: "export {};" } as Record<
      string,
      unknown
    >;
    Object.defineProperty(input, "__proto__", { enumerable: true, value: {} });

    expect(parseAuthoringSource(input)).toEqual({
      diagnostics: [
        {
          code: "compiler-source-kind-unsupported",
          column: 1,
          fileName: "",
          length: 0,
          line: 1,
          message: "Authoring source input must contain a file name and source text.",
          start: 0,
        },
      ],
      ok: false,
    });
  });
});
