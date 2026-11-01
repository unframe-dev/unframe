import assert from "node:assert/strict";
import test from "node:test";
import { compileStylesResultSchema } from "@unframe/styles-node/compiler";

test("worker results reject malformed diagnostics and dependencies", () => {
  assert.equal(
    compileStylesResultSchema.safeParse({
      ok: false,
      diagnostics: [{ phase: "transform", severity: "error", message: "failed", line: "1" }],
    }).success,
    false,
  );
  assert.equal(
    compileStylesResultSchema.safeParse({
      ok: true,
      configFile: "postcss.config.mjs",
      stylesheets: [],
      observedDependencies: [{ kind: "file", path: 1 }],
      diagnostics: [],
    }).success,
    false,
  );
  assert.equal(
    compileStylesResultSchema.safeParse({
      ok: false,
      diagnostics: [{ phase: "config", severity: "error", message: "failed" }],
    }).success,
    true,
  );
});
