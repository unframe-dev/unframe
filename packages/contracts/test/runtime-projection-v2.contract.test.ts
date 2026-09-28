import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  m3dCueParticipantRuntimeViewV2Schema,
  m3dCueRuntimeSnapshotV2Schema,
  runtimeVisibilitySelectionV2Schema,
} from "../src/presentation/v2/index";

const root = resolve(import.meta.dirname, "../presentation/v2");
const readJson = async (path: string) => JSON.parse(await readFile(resolve(root, path), "utf8"));

for (const [name, schema] of [
  ["m3d-cue-runtime-snapshot", m3dCueRuntimeSnapshotV2Schema],
  ["runtime-visibility-selection", runtimeVisibilitySelectionV2Schema],
  ["m3d-cue-participant-runtime-view", m3dCueParticipantRuntimeViewV2Schema],
] as const) {
  test(`${name} portable fixture agrees across Zod and JSON Schema`, async () => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      await readJson(`${name}.schema.json`),
    );
    const valid = await readJson(`fixtures/${name}.json`);
    assert.equal(schema.safeParse(valid).success, true);
    assert.equal(validate(valid), true);
    for (const invalid of [
      { ...valid, sessionId: "session" },
      { ...valid, projectionProfileId: "" },
    ]) {
      assert.equal(schema.safeParse(invalid).success, false);
      assert.equal(validate(invalid), false);
    }
  });
}
