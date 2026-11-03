import assert from "node:assert/strict";
import { test } from "node:test";
import {
  patchRequestSchema,
  projectSnapshotSchema,
  buildJobSchema,
  previewPlaybackCommandSchema,
  editorSocketRequestSchema,
} from "../src/author-http";

test("Author HTTP validates stale-edit preconditions and rejects unsupported commands", () => {
  assert.equal(
    patchRequestSchema.safeParse({
      commandId: "a".repeat(32),
      expectedIrHash: "ir",
      command: { kind: "setProp", instanceId: "i", propId: "title", value: "Hi" },
    }).success,
    true,
  );
  assert.equal(
    patchRequestSchema.safeParse({
      commandId: "a".repeat(32),
      command: { kind: "setProp", instanceId: "i", propId: "title", value: "Hi" },
    }).success,
    false,
  );
  assert.equal(
    patchRequestSchema.safeParse({
      commandId: "a".repeat(32),
      expectedIrHash: "ir",
      command: { kind: "unknown" },
    }).success,
    false,
  );
});
test("Author HTTP validates project and build response bodies", () => {
  assert.equal(
    projectSnapshotSchema.safeParse({
      revision: "r",
      sourceHash: "s",
      irHash: null,
      definition: null,
      instances: [],
      diagnostics: [],
    }).success,
    true,
  );
  assert.equal(
    buildJobSchema.safeParse({
      buildId: "b",
      channel: "dev",
      revision: "r",
      generationId: null,
      status: "succeeded",
      diagnostics: [],
      artifacts: [],
    }).success,
    true,
  );
  assert.equal(buildJobSchema.safeParse({ buildId: "b", status: "unknown" }).success, false);
});

test("Author HTTP dev Preview selects a completed Build rather than internal storage handles", async () => {
  const { previewRequestSchema } = await import("../src/author-http");
  assert.equal(
    previewRequestSchema.safeParse({
      requestId: "a".repeat(32),
      channel: "dev",
      buildId: "b".repeat(32),
    }).success,
    true,
  );
  assert.equal(
    previewRequestSchema.safeParse({
      requestId: "a".repeat(32),
      channel: "dev",
      generationId: "b".repeat(32),
      sourceRevision: "r",
    }).success,
    false,
  );
});

test("Project change observations reject credentials, unknown fields and malformed cursors", async () => {
  const { projectChangesQuerySchema, projectChangeSchema } = await import("../src/author-http");
  const cursor = "a".repeat(32) + ":42";
  assert.equal(projectChangesQuerySchema.safeParse({ cursor }).success, true);
  assert.equal(projectChangesQuerySchema.safeParse({ token: "secret" }).success, false);
  assert.equal(projectChangesQuerySchema.safeParse({ cursor: "42" }).success, false);
  assert.equal(projectChangeSchema.safeParse({ cursor, changed: true }).success, true);
  assert.equal(
    projectChangeSchema.safeParse({ cursor, changed: true, revision: "extra" }).success,
    false,
  );
});

test("Editor sessions accept only a complete ephemeral credential", async () => {
  const { editorSessionSchema } = await import("../src/author-http");
  assert.equal(editorSessionSchema.safeParse({ token: "a".repeat(64) }).success, true);
  assert.equal(editorSessionSchema.safeParse({ token: "A".repeat(64) }).success, true);
  for (const value of [
    {},
    { token: "a".repeat(63) },
    { token: "a".repeat(65) },
    { token: "a".repeat(64) + "\n" },
    { token: "z".repeat(64) },
    { token: "a".repeat(64), project: "extra" },
  ])
    assert.equal(editorSessionSchema.safeParse(value).success, false);
});

test("Preview accepts a finite Presenter position without accepting synthetic Zone edges", async () => {
  const { previewPlaybackCommandSchema } = await import("../src/author-http");
  const move = { requestId: "a".repeat(32), command: "movePresenter", position: [0, 1, -2] };
  assert.equal(previewPlaybackCommandSchema.safeParse(move).success, true);
  for (const position of [
    [0, 1],
    [0, 1, 2, 3],
    [NaN, 0, 0],
    [Infinity, 0, 0],
  ])
    assert.equal(previewPlaybackCommandSchema.safeParse({ ...move, position }).success, false);
  assert.equal(
    previewPlaybackCommandSchema.safeParse({ ...move, zoneId: "stage", edge: "enter" }).success,
    false,
  );
});

test("Spatial Preview frames validate request identity, positions, and Zone state", async () => {
  const { previewSpatialFrameSchema, previewPresenterPositionSchema } =
    await import("../src/author-http");
  const frame = {
    requestId: "a".repeat(32),
    sequence: "3",
    presenterPosition: [0, 0, 0],
    zones: [{ zoneId: "stage", center: [2, 0, -3], active: true, inside: false }],
  };
  assert.deepEqual(previewSpatialFrameSchema.parse(frame), frame);
  assert.equal(previewSpatialFrameSchema.safeParse({ ...frame, sequence: "0" }).success, false);
  assert.equal(previewSpatialFrameSchema.safeParse({ ...frame, requestId: "old" }).success, false);
  assert.equal(
    previewSpatialFrameSchema.safeParse({
      ...frame,
      zones: [{ ...frame.zones[0], inside: "true" }],
    }).success,
    false,
  );
  assert.equal(
    previewSpatialFrameSchema.safeParse({ ...frame, presenterPosition: [0, Infinity, 0] }).success,
    false,
  );
  assert.equal(
    previewSpatialFrameSchema.safeParse({ ...frame, presenterPosition: [1e100, 0, 0] }).success,
    false,
  );
  assert.equal(
    previewPresenterPositionSchema.safeParse({ requestId: frame.requestId, position: [1, 0, -2] })
      .success,
    true,
  );
  assert.equal(
    previewPresenterPositionSchema.safeParse({
      requestId: frame.requestId,
      position: [1, 0, -2],
      zoneId: "stage",
    }).success,
    false,
  );
});

test("Spatial positions reject coordinates that overflow Unity float storage", async () => {
  const {
    previewPlaybackCommandSchema,
    previewSpatialFrameSchema,
    previewPresenterPositionSchema,
  } = await import("../src/author-http");
  const requestId = "a".repeat(32);
  assert.equal(
    previewPlaybackCommandSchema.safeParse({
      requestId,
      command: "movePresenter",
      position: [1e100, 0, 0],
    }).success,
    false,
  );
  assert.equal(
    previewPresenterPositionSchema.safeParse({ requestId, position: [0, -1e100, 0] }).success,
    false,
  );
  assert.equal(
    previewSpatialFrameSchema.safeParse({
      requestId,
      sequence: "1",
      presenterPosition: [0, 0, 0],
      zones: [{ zoneId: "z", center: [0, 0, 1e100], active: true, inside: false }],
    }).success,
    false,
  );
});

test("Preview rehearsal validates Gesture, event identity, Step and Presenter orientation", () => {
  const requestId = "a".repeat(32);
  for (const command of [
    { command: "gesture", gesture: "swipeLeft" },
    { command: "semanticEvent", event: "sensor", actor: { kind: "system", source: "runtime" } },
    { command: "surfaceInteraction", surfaceId: "surface", interactionId: "button" },
    { command: "selectStep", groupId: "intro", stepId: "start" },
    { command: "movePresenter", position: [0, 0, 0], rotation: [0, 1, 0, 0] },
  ])
    assert.equal(previewPlaybackCommandSchema.safeParse({ requestId, ...command }).success, true);
  assert.equal(
    previewPlaybackCommandSchema.safeParse({ requestId, command: "gesture", gesture: "unknown" })
      .success,
    false,
  );
  assert.equal(
    previewPlaybackCommandSchema.safeParse({
      requestId,
      command: "semanticEvent",
      event: "sensor",
      actor: { kind: "viewer" },
    }).success,
    false,
  );
  assert.equal(
    previewPlaybackCommandSchema.safeParse({
      requestId,
      command: "movePresenter",
      position: [0, 0, 0],
      rotation: [0, 0, 0, 0],
    }).success,
    false,
  );
});

test("Presenter orientation uses the Unity squared-norm tolerance", () => {
  const base = { requestId: "a".repeat(32), command: "movePresenter", position: [0, 0, 0] };
  assert.equal(
    previewPlaybackCommandSchema.safeParse({ ...base, rotation: [0, 0, 0, 1.00001] }).success,
    false,
  );
  assert.equal(
    previewPlaybackCommandSchema.safeParse({
      ...base,
      rotation: [0, 0, 0, Math.sqrt(1 + 0.000009)],
    }).success,
    true,
  );
  assert.equal(
    previewPlaybackCommandSchema.safeParse({
      ...base,
      rotation: [0, 0, 0, Math.sqrt(1 + 0.000011)],
    }).success,
    false,
  );
});

test("Presenter paths accept bounded ordered poses and validate every sample", () => {
  const base = { requestId: "a".repeat(32), command: "movePresenterPath" };
  const sample = { position: [0, 0, 0], rotation: [0, 1, 0, 0] };
  assert.equal(
    editorSocketRequestSchema.safeParse({
      id: 1,
      operation: {
        method: "playback",
        body: { ...base, samples: [sample] },
      },
    }).success,
    true,
  );
  for (const length of [1, 256])
    assert.equal(
      previewPlaybackCommandSchema.safeParse({
        ...base,
        samples: Array.from({ length }, () => sample),
      }).success,
      true,
    );
  for (const samples of [
    [],
    Array(2),
    Array.from({ length: 257 }, () => sample),
    [sample, { position: [Infinity, 0, 0] }],
    [sample, { position: [0, 0, 0], rotation: [0, 0, 0, 2] }],
    [{ ...sample, edge: "enter" }],
  ])
    assert.equal(previewPlaybackCommandSchema.safeParse({ ...base, samples }).success, false);
});
