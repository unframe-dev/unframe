import { expect, it } from "vitest";
import { createAuthorProjectSnapshot } from "../src/index.js";

it("exposes style preparation failures in the project snapshot", async () => {
  const result = await createAuthorProjectSnapshot({
    revision: "r",
    sourceText: "source",
    files: [{ fileName: "presentation.tsx", sourceText: "source" }],
    localFiles: [],
    componentLocks: [],
    carrier: {} as never,
    prepared: { ok: false, code: "style-failed", message: "failed", diagnostics: [] },
    resolveAssets: async () => {
      throw new Error("unexpected asset read");
    },
  });
  expect(result.snapshot).toMatchObject({
    revision: "r",
    irHash: null,
    definition: null,
    instances: [],
    diagnostics: [{ code: "style-failed", message: "failed", severity: "error" }],
  });
});
