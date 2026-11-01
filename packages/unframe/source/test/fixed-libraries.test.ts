import { expect, it } from "vitest";
import { checkAuthoringProject } from "../src/index.js";

it("rejects a React source snapshot without its TypeScript libraries", () => {
  const result = checkAuthoringProject({
    projectRoot: "/virtual",
    entryFile: "entry.component.tsx",
    files: [{ fileName: "entry.component.tsx", sourceText: "export const value = 1;" }],
    rootDependencies: [],
    packages: [],
  });
  expect(result.valid).toBe(false);
  if (!result.valid)
    expect(result.diagnostics.map((item) => item.code)).toContain("source-type-library-missing");
});

it("identifies library contents independent of their order", async () => {
  const { hashSourceTypeLibraries } = await import("../src/index.js");
  const a = { fileName: "lib.es2022.d.ts", sourceText: "declare const x: string;" };
  const b = { fileName: "lib.dom.d.ts", sourceText: "declare const y: number;" };
  expect(hashSourceTypeLibraries([a, b])).toBe(hashSourceTypeLibraries([b, a]));
  expect(hashSourceTypeLibraries([a, b])).not.toBe(
    hashSourceTypeLibraries([{ ...a, sourceText: "changed" }, b]),
  );
});

it("analyzes React source using only the supplied library snapshot", async () => {
  const ts = await import("typescript");
  const { vi } = await import("vitest");
  const { parseAuthoringProject, analyzeAuthoringProject } = await import("../src/index.js");
  const readFile = vi.spyOn(ts.sys, "readFile").mockImplementation(() => {
    throw new Error("unexpected filesystem read");
  });
  try {
    const parsed = parseAuthoringProject({
      projectRoot: "/virtual",
      entryFile: "entry.component.tsx",
      files: [{ fileName: "entry.component.tsx", sourceText: "export const value = 1;" }],
      rootDependencies: [],
      packages: [],
      typeLibraries: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"].map(
        (fileName) => ({ fileName, sourceText: "" }),
      ),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(analyzeAuthoringProject(parsed.value).ok).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
  } finally {
    readFile.mockRestore();
  }
});
