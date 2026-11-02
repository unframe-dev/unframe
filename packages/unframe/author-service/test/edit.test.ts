import { expect, it } from "vitest";
import { createAuthorPatch, inspectAuthorSource } from "../src/index.js";

it("rejects a stale editing revision before parsing or patching its source", () => {
  expect(() =>
    createAuthorPatch({
      source: null,
      sourceText: "",
      entryFile: "presentation.tsx",
      revision: "old",
      snapshot: {
        revision: "current",
        sourceHash: "s",
        irHash: "i",
        definition: null,
        instances: [],
        diagnostics: [],
      },
      request: {
        commandId: "a".repeat(32),
        expectedIrHash: "i",
        command: { kind: "setProp", instanceId: "hero", propId: "title", value: "new" },
      },
    }),
  ).toThrow(expect.objectContaining({ code: "author-revision-mismatch", status: 412 }));
});

it("preserves syntax diagnostics when inspecting fixed Source without filesystem access", () => {
  const text = "export default = ;";
  const result = inspectAuthorSource({
    source: {
      projectRoot: "/virtual",
      entryFile: "entry.ts",
      files: [{ fileName: "entry.ts", sourceText: text }],
      rootDependencies: [],
      packages: [],
    },
    sourceText: text,
    semanticValid: false,
  });
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "compiler-source-syntax-error", family: "syntax" }),
  );
  expect(result.instances).toEqual([]);
});
