import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import * as contract from "@unframe/contracts/presentation";

test("the public presentation export exposes the current contract without a versioned path", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../package.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(manifest.exports).sort(), ["./control-plane", "./presentation"]);
  const retiredPath = "@unframe/contracts/presentation/v2";
  await assert.rejects(import(retiredPath), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  assert.equal(
    Object.keys(contract).some((name) => name.includes("V2")),
    false,
  );
  const sample = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "../presentation/fixtures/presentation-definition.json"),
      "utf8",
    ),
  );
  assert.equal(contract.presentationDefinitionSchema.safeParse(sample).success, true);
  assert.equal(
    contract.presentationDefinitionSchema.safeParse({ ...sample, schemaVersion: 1 }).success,
    false,
  );
});
