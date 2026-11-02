import { expect, it } from "vitest";
import { createReactScenePatch, createSourceSnapshot } from "../src/index.js";

it("rejects a target whose supplied hash does not match its source", () => {
  const snapshot = createSourceSnapshot({
    projectRoot: "/virtual",
    entryFile: "presentation.tsx",
    files: [{ fileName: "presentation.tsx", sourceText: "changed" }],
    rootDependencies: [],
    packages: [],
  });
  expect(snapshot.ok).toBe(true);
  if (!snapshot.ok) return;
  const result = createReactScenePatch({
    snapshot: snapshot.value,
    fileName: "presentation.tsx",
    targetHash: `sha256:${"0".repeat(64)}`,
    command: { kind: "setProp", instanceId: "one", propId: "title", value: "new" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics[0]?.code).toBe("source-target-hash-mismatch");
});
