import { describe, expect, it } from "vitest";

import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";

const project = () => ({
  projectRoot: "/virtual/presentation",
  entryFile: "presentation.unframe.tsx",
  files: [
    {
      fileName: "presentation.unframe.tsx",
      sourceText: 'import type { Theme } from "./theme";\nexport default <main />;',
    },
    { fileName: "theme.d.ts", sourceText: "export interface Theme { readonly name: string; }" },
    { fileName: "components/frame.ts", sourceText: "export const frame = {};" },
  ],
});

describe("parseAuthoringProject", () => {
  it("parses a root-relative virtual TS/TSX/declaration project without executing it", () => {
    const result = parseAuthoringProject(project());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.projectRoot).toBe("/virtual/presentation");
    expect(result.value.entryFile).toBe("presentation.unframe.tsx");
    expect(Object.keys(result.value.files)).toEqual([
      "components/frame.ts",
      "presentation.unframe.tsx",
      "theme.d.ts",
    ]);
    expect(result.value.files["presentation.unframe.tsx"]?.fileName).toBe(
      "/virtual/presentation/presentation.unframe.tsx",
    );
  });

  it("reports syntax failures with root-relative UTF-16 ranges in canonical order", () => {
    const input = project();
    input.files = [
      { fileName: "z.ts", sourceText: "const z = ;" },
      { fileName: "a.ts", sourceText: 'const a = "😀" + ;' },
      ...input.files,
    ];

    expect(parseAuthoringProject(input)).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "compiler-source-syntax-error",
          fileName: "a.ts",
          message: "Expression expected.",
          start: 17,
          end: 18,
          line: 1,
          column: 18,
          typescriptCode: 1109,
        },
        {
          code: "compiler-source-syntax-error",
          fileName: "z.ts",
          message: "Expression expected.",
          start: 10,
          end: 11,
          line: 1,
          column: 11,
          typescriptCode: 1109,
        },
      ],
    });
  });

  it("fails closed for invalid roots, paths, duplicate files, missing entries, and unsupported files", () => {
    const cases = [
      [{ ...project(), projectRoot: "virtual/presentation" }, "compiler-project-root-invalid"],
      [{ ...project(), entryFile: "../presentation.unframe.tsx" }, "compiler-project-path-invalid"],
      [
        { ...project(), files: [...project().files, project().files[0]!] },
        "compiler-project-file-duplicate",
      ],
      [{ ...project(), entryFile: "missing.tsx" }, "compiler-project-entry-not-found"],
      [
        {
          ...project(),
          files: [{ fileName: "presentation.js", sourceText: "export default {};" }],
        },
        "compiler-source-kind-unsupported",
      ],
    ] as const;

    for (const [input, code] of cases) {
      const result = parseAuthoringProject(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics.map((item) => item.code)).toContain(code);
    }
  });

  it("rejects accessor and proxy-backed input without running authoring code", () => {
    let accessorReads = 0;
    const accessorInput = project() as Record<string, unknown>;
    Object.defineProperty(accessorInput, "files", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("must not run");
      },
    });
    const proxyInput = new Proxy(project(), {
      ownKeys() {
        throw new Error("must not run");
      },
    });

    for (const input of [accessorInput, proxyInput]) {
      const result = parseAuthoringProject(input);
      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            code: "compiler-invalid-input",
            fileName: "",
            message: "Project input cannot be inspected safely.",
            start: 0,
            end: 0,
            line: 1,
            column: 1,
          },
        ],
      });
    }
    expect(accessorReads).toBe(0);
  });

  it("rejects own prototype-shaped unknown fields in the project and file envelope", () => {
    const rootUnknown = project() as Record<string, unknown>;
    Object.defineProperty(rootUnknown, "__proto__", { value: {}, enumerable: true });
    const fileUnknown = project();
    Object.defineProperty(fileUnknown.files[0]!, "constructor", { value: {}, enumerable: true });

    for (const input of [rootUnknown, fileUnknown]) {
      const result = parseAuthoringProject(input);
      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            code: "compiler-invalid-input",
            fileName: "",
            message: "Project input has an invalid virtual filesystem shape.",
            start: 0,
            end: 0,
            line: 1,
            column: 1,
          },
        ],
      });
    }
  });
});
