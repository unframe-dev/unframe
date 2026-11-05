import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import * as z from "zod";

import {
  effectConfigurationSchema,
  canonicalRuntimeSnapshotSchema,
  m3dCueParticipantRuntimeViewSchema,
  m3dCueRuntimeSnapshotSchema,
  participantRuntimeViewSchema,
  runtimeVisibilitySelectionSchema,
} from "../src/presentation/index";

const root = resolve(import.meta.dirname, "../presentation");
const readJson = async (path: string) => JSON.parse(await readFile(resolve(root, path), "utf8"));

for (const [name, schema] of [
  ["m3d-cue-runtime-snapshot", m3dCueRuntimeSnapshotSchema],
  ["runtime-visibility-selection", runtimeVisibilitySelectionSchema],
  ["m3d-cue-participant-runtime-view", m3dCueParticipantRuntimeViewSchema],
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

const portableSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
    override: ({ jsonSchema: node }) => {
      if (!Array.isArray(node.prefixItems)) return;
      node.items = false;
      node.minItems = node.prefixItems.length;
      node.maxItems = node.prefixItems.length;
    },
  });

const snapshotSchemas = [m3dCueRuntimeSnapshotSchema, canonicalRuntimeSnapshotSchema] as const;

const currentSnapshot = () => readJson("fixtures/m3d-cue-runtime-snapshot.json");

test("snapshot requires input epoch and rejects legacy cooldown and deduplication state", async () => {
  const snapshot = await currentSnapshot();
  for (const schema of snapshotSchemas) {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(portableSchema(schema));
    assert.equal(schema.safeParse(snapshot).success, true);
    assert.equal(validate(snapshot), true);
    for (const invalid of [
      { ...snapshot, schemaVersion: 2 },
      { ...snapshot, inputEpoch: 0 },
      { ...snapshot, inputEpoch: Number.MAX_SAFE_INTEGER + 1 },
      { ...snapshot, inputEpoch: 1.5 },
      { ...snapshot, inputEpoch: undefined },
      { ...snapshot, frozenAnchors: undefined },
      { ...snapshot, stepStartHistory: undefined },
      { ...snapshot, recentEventIds: [] },
      { ...snapshot, outcomes: [] },
      {
        ...snapshot,
        stepExecution: { ...snapshot.stepExecution, cooldownUntilRuntimeTimeMilliseconds: {} },
      },
    ]) {
      assert.equal(schema.safeParse(invalid).success, false);
      assert.equal(validate(invalid), false);
    }
  }
});

test("frozen anchors preserve only available display components in snapshots and participant views", async () => {
  const snapshot = await currentSnapshot();
  const view = await readJson("fixtures/m3d-cue-participant-runtime-view.json");
  for (const [schema, value] of [
    [m3dCueRuntimeSnapshotSchema, snapshot],
    [canonicalRuntimeSnapshotSchema, snapshot],
    [m3dCueParticipantRuntimeViewSchema, view],
    [participantRuntimeViewSchema, view],
  ] as const) {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(portableSchema(schema));
    for (const anchor of [
      { nodeId: "hand", position: [1, 2, 3] },
      { nodeId: "hand", rotation: [0, 0, 0, 1] },
      { nodeId: "hand", position: [1, 2, 3], rotation: [0, 0, 0, 1] },
    ]) {
      const valid = { ...value, frozenAnchors: [anchor] };
      assert.equal(schema.safeParse(valid).success, true);
      assert.equal(validate(valid), true);
    }
    for (const anchor of [
      { nodeId: "hand" },
      { nodeId: "hand", position: [1, 2] },
      { nodeId: "hand", rotation: [0, 0, 1] },
      { nodeId: "hand", position: [1, 2, 3], sampleSequence: 1 },
      { nodeId: "hand", position: [1, 2, 3], capturedAtRuntimeTimeMilliseconds: 1 },
    ]) {
      const invalid = { ...value, frozenAnchors: [anchor] };
      assert.equal(schema.safeParse(invalid).success, false);
      assert.equal(validate(invalid), false);
    }
  }
});

test("step start history stores nonrecursive resources with their original run epochs", async () => {
  const snapshot = await currentSnapshot();
  const history = {
    groupId: "previous-group",
    stepId: "previous-step",
    groupEntryEpoch: 2,
    stepEntryEpoch: 3,
    capturedAtRuntimeTimeMilliseconds: 20,
    surfaceStates: {},
    nodeStates: {},
    mediaStates: {},
    modelClipStates: {},
    variables: { counter: 4 },
    effectRuns: [],
    activeRuns: [
      {
        kind: "timeline",
        runId: { assignmentEpoch: 1, runSequence: 1 },
        owner: { kind: "group", groupId: "previous-group", groupEntryEpoch: 2 },
        cause: {
          cueId: "cue",
          causeEventId: "event",
          groupId: "previous-group",
          groupEntryEpoch: 2,
          stepId: "previous-step",
          stepEntryEpoch: 3,
        },
        startedAtRuntimeTimeMilliseconds: 10,
        timelineId: "timeline",
        completion: "nonBlocking",
      },
    ],
  };
  for (const schema of snapshotSchemas) {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(portableSchema(schema));
    const valid = { ...snapshot, stepStartHistory: [history] };
    assert.deepEqual(schema.parse(valid).stepStartHistory, [history]);
    assert.equal(validate(valid), true);
    for (const entry of [
      { ...history, stepStartHistory: [] },
      { ...history, inputEpoch: 1 },
      { ...history, groupEntryEpoch: 0 },
      { ...history, runtimeResources: {} },
    ]) {
      const invalid = { ...snapshot, stepStartHistory: [entry] };
      assert.equal(schema.safeParse(invalid).success, false);
      assert.equal(validate(invalid), false);
    }
  }
  const fullHistory = {
    ...history,
    mediaStates: { video: { kind: "stopped", heldPositionMilliseconds: 100 } },
    modelClipStates: { model: { kind: "defaultPose" } },
  };
  const fullSnapshot = {
    ...snapshot,
    stepStartHistory: [fullHistory],
  };
  for (const schema of snapshotSchemas) {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(portableSchema(schema));
    assert.equal(schema.safeParse(fullSnapshot).success, true);
    assert.equal(validate(fullSnapshot), true);
  }
});

test("participant views exclude input synchronization history and outcomes", async () => {
  const view = {
    ...(await readJson("fixtures/m3d-cue-participant-runtime-view.json")),
    frozenAnchors: [],
  };
  for (const schema of [m3dCueParticipantRuntimeViewSchema, participantRuntimeViewSchema]) {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(portableSchema(schema));
    for (const extra of [
      { stepStartHistory: [] },
      { inputEpoch: 1 },
      { outcomes: [] },
      { recentEventIds: [] },
    ]) {
      const invalid = { ...view, ...extra };
      assert.equal(schema.safeParse(invalid).success, false);
      assert.equal(validate(invalid), false);
    }
  }
});

test("effect snapshot preserves identity, deterministic settings and retained Wave state", async () => {
  const snapshot = await readJson("fixtures/m3d-cue-runtime-snapshot.json");
  const run = {
    runId: { assignmentEpoch: 1, runSequence: 1 },
    owner: { kind: "presentation" },
    cause: {
      cueId: "wave",
      causeEventId: "input",
      groupId: "intro",
      groupEntryEpoch: 1,
      stepId: "start",
      stepEntryEpoch: 1,
    },
    startedAtRuntimeTimeMilliseconds: 120,
    effectId: "wave",
    nodeId: "model",
    seed: 42,
    status: "retained",
    effect: {
      kind: "wave",
      size: 2,
      speed: 1,
      durationMilliseconds: 500,
      waveCycles: 3,
      color: { red: 1, green: 0.5, blue: 0, alpha: 1 },
    },
  };
  const value = { ...snapshot, effectRuns: [run] };
  const parsed = canonicalRuntimeSnapshotSchema.parse(value);
  assert.deepEqual(parsed.effectRuns, [run]);
  assert.equal(
    canonicalRuntimeSnapshotSchema.safeParse({ ...value, effectRuns: Array(33).fill(run) }).success,
    false,
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    await readJson("canonical-runtime-snapshot.schema.json"),
  );
  assert.equal(validate(value), true);
  assert.equal(
    canonicalRuntimeSnapshotSchema.safeParse({
      ...value,
      effectRuns: [{ ...run, effect: { ...run.effect, kind: "handGlow" } }],
    }).success,
    false,
  );
  assert.equal(
    canonicalRuntimeSnapshotSchema.safeParse({ ...value, effectRuns: [{ ...run, seed: -1 }] })
      .success,
    false,
  );
});

test("effect size and speed remain positive finite float32 values across portable contracts", () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    portableSchema(effectConfigurationSchema),
  );
  const effect = {
    kind: "dissolve",
    size: 1,
    speed: 1,
    durationMilliseconds: 100,
    color: { red: 1, green: 1, blue: 1, alpha: 1 },
  };
  for (const field of ["size", "speed"]) {
    for (const value of [0, 2 ** -150, 1e300]) {
      const input = { ...effect, [field]: value };
      assert.equal(effectConfigurationSchema.safeParse(input).success, false, `${field}=${value}`);
      assert.equal(validate(input), false, `${field}=${value}`);
    }
    for (const value of [2 ** -149, 1, 3.4028234663852886e38]) {
      const input = { ...effect, [field]: value };
      assert.equal(effectConfigurationSchema.safeParse(input).success, true, `${field}=${value}`);
      assert.equal(validate(input), true, `${field}=${value}`);
    }
  }
});
