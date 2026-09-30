import { describe, expect, it } from "vitest";

import { parseAuthoringProject } from "../src/project/parse-authoring-project.js";

const packageEntry = () => ({
  contentIntegrity: `sha256:${"b".repeat(64)}`,
  dependencies: [],
  exports: [{ runtimeImport: null, runtimeRequire: null, subpath: ".", types: "index.d.ts" }],
  files: [
    {
      data: "export declare const theme: string;",
      encoding: "utf8" as const,
      hash: `sha256:${"c".repeat(64)}`,
      mediaType: "text/typescript",
      path: "index.d.ts",
    },
  ],
  key: `sha256:${"a".repeat(64)}`,
  locator: "@unframe/theme@1.0.0",
  name: "@unframe/theme",
  version: "1.0.0",
});
const input = () => ({
  entryFile: "presentation.unframe.ts",
  files: [{ fileName: "presentation.unframe.ts", sourceText: "export {};" }],
  packages: [packageEntry()],
  projectRoot: "/virtual/presentation",
  rawFiles: [],
  rootDependencies: [
    { packageKey: packageEntry().key, specifier: "@unframe/theme", usage: "types" as const },
  ],
});
const codes = (value: unknown) => {
  const result = parseAuthoringProject(value);
  return result.ok ? [] : result.diagnostics.map((item) => item.code);
};

describe("parseAuthoringProject locked packages v2", () => {
  it("parses exact package keys and source provenance", () => {
    const result = parseAuthoringProject(input());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.rootDependencies).toEqual(input().rootDependencies);
    expect(result.value.packages[0]).toMatchObject({
      key: packageEntry().key,
      name: "@unframe/theme",
    });
    expect(result.value.packages[0]?.files["index.d.ts"]?.fileName).toBe(
      `unframe-package://${"a".repeat(64)}/index.d.ts`,
    );
  });

  it("rejects hostile input without invoking getters", () => {
    const accessor = input();
    Object.defineProperty(accessor.packages[0]!, "files", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expect(codes(accessor)).toContain("compiler-invalid-input");
  });

  it("rejects duplicate files, missing edges, and unlisted export targets", () => {
    const duplicate = input();
    duplicate.packages[0]!.files.push({ ...duplicate.packages[0]!.files[0]! });
    expect(codes(duplicate)).toContain("compiler-package-order-invalid");

    const missing = input();
    missing.rootDependencies[0]!.packageKey = `sha256:${"d".repeat(64)}`;
    expect(codes(missing)).toContain("compiler-package-dependency-mismatch");

    const exportTarget = input();
    exportTarget.packages[0]!.exports[0]!.types = "missing.d.ts";
    expect(codes(exportTarget)).toContain("compiler-package-export-target-missing");
  });
});
