import assert from "node:assert/strict";
import test from "node:test";

test("Presentation exposes only the v2 contract", async () => {
  const current = await import("@unframe/contracts/presentation/v2");
  assert.equal(typeof current.presentationDefinitionV2Schema.safeParse, "function");
  const legacyPath = "@unframe/contracts/presentation";
  await assert.rejects(import(legacyPath), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
});
