import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertRuntimeByteLength,
  runtimeAuthorityLimits,
} from "../src/presentation/runtime-authority";
import { encodeWireMessage } from "../src/presentation/wire";

const inputContext = {
  inputEpoch: "1",
  groupId: "group-1",
  groupEntryEpoch: "1",
  stepId: "step-1",
  stepEntryEpoch: "1",
};

function nodeState(index: number): Record<string, unknown> {
  return {
    nodeId: `node-${index.toString().padStart(4, "0")}-${"n".repeat(100)}`,
    active: true,
    visible: true,
    opacity: 1,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function stepStartState(nodeCount: number, historyIndex: number): Record<string, unknown> {
  return {
    groupId: `group-${historyIndex}`,
    stepId: `step-${historyIndex}`,
    groupEntryEpoch: "1",
    stepEntryEpoch: String(historyIndex + 1),
    capturedAtRuntimeTimeMs: "1",
    nodeStates: Array.from({ length: nodeCount }, (_, index) => nodeState(index)),
  };
}

function commandRecord(index: number, fingerprint = "a".repeat(64)): Record<string, unknown> {
  const uuid = index.toString(16).padStart(12, "0");
  return {
    participantId: "participant-1",
    clientEventId: `1:00000000-0000-4000-8000-${uuid}`,
    commandEpoch: "1",
    fingerprint: fingerprint.startsWith("sha256:") ? fingerprint : `sha256:${fingerprint}`,
    outcome: {
      clientEventId: `1:00000000-0000-4000-8000-${uuid}`,
      noOp: { reason: 1 },
    },
  };
}

function largeValidCommandRecord(index: number): Record<string, unknown> {
  const record = commandRecord(index, `sha256:${"a".repeat(64)}`);
  const outcome = record["outcome"] as Record<string, unknown>;
  record["participantId"] = `participant-${"p".repeat(116)}`;
  outcome["accepted"] = {
    canonicalEventId: `canonical-${"c".repeat(118)}`,
    reliableSequence: "1",
    cueCommitted: { cueId: `cue-${"q".repeat(123)}` },
  };
  delete outcome["noOp"];
  return record;
}

function recoveryMetadata(commands: Record<string, unknown>[]): Record<string, unknown> {
  const inputSynchronization = {
    phase: 2,
    reason: 8,
    synchronizationRevision: "1",
    inputContext,
    commandEpoch: "1",
    reliableSequence: "1",
    recognitionCatalog: { gestures: [], zones: [] },
  };
  return {
    startedAt: "2026-10-22T00:00:00.000Z",
    participants: [{ participantId: "participant-1", role: 1 }],
    commands,
    commandEpoch: "1",
    inputSynchronization,
  };
}

function canonicalSnapshot(nodeCount: number): Record<string, unknown> {
  return {
    schemaVersion: 3,
    reliableSequence: "1",
    lastIngressSequence: "1",
    lastAllocatedRunSequence: "0",
    clock: { runtimeTimeMs: "1", running: {} },
    progression: {
      currentGroupId: "group-current",
      groupEntryEpoch: "1",
      currentStepId: "step-current",
      stepEntryEpoch: "1",
      stepEnteredAtRuntimeTimeMs: "1",
      stable: {},
    },
    stepExecution: { stepEntryEpoch: "1" },
    presentationOrigin: {
      version: "1",
      pose: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    inputEpoch: "1",
    stepStartHistory: Array.from({ length: 9 }, (_, index) => stepStartState(255, index + 1)),
    nodeStates: Array.from({ length: nodeCount }, (_, index) => nodeState(index)),
  };
}

test("runtime authority publishes independently specified capacity contract", () => {
  assert.deepEqual(runtimeAuthorityLimits, {
    maximumControlItemBytes: 1_048_576,
    maximumStateItemBytes: 262_144,
    maximumCommandHistoryCount: 1_024,
    maximumCommandHistoryBytes: 262_144,
    commandHistorySyncCount: 1_000,
    commandHistorySyncBytes: 245_760,
    maximumCommandRecordBytes: 1_024,
    maximumCanonicalSnapshotBytes: 786_432,
    maximumStepStartHistoryBytes: 524_288,
    maximumStepStartStateBytes: 65_536,
    maximumRecoveryMetadataBytes: 262_144,
    maximumCheckpointJsonBytes: 1_572_864,
    maximumInputSynchronizationBytes: 4_096,
    zoneEdgeLengthMeters: 2,
  });
});

test("a StepStartState is capped independently and canonical history is bounded", () => {
  const state = stepStartState(285, 1);
  const stateBytes = encodeWireMessage("unframe.realtime.StepStartState", state);
  assert.ok(stateBytes.byteLength <= 65_536);

  const tooManyNodes = stepStartState(290, 1);
  assert.throws(
    () => encodeWireMessage("unframe.realtime.StepStartState", tooManyNodes),
    /serialized byte limit/,
  );

  const history = Array.from({ length: 9 }, (_, index) => stepStartState(255, index + 1));
  const snapshot = encodeWireMessage("unframe.realtime.CanonicalRuntimeSnapshot", {
    schemaVersion: 3,
    reliableSequence: "1",
    lastIngressSequence: "1",
    lastAllocatedRunSequence: "0",
    clock: { runtimeTimeMs: "1", running: {} },
    progression: {
      currentGroupId: "group-current",
      groupEntryEpoch: "1",
      currentStepId: "step-current",
      stepEntryEpoch: "1",
      stepEnteredAtRuntimeTimeMs: "1",
      stable: {},
    },
    stepExecution: { stepEntryEpoch: "1" },
    presentationOrigin: {
      version: "1",
      pose: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    },
    inputEpoch: "1",
    stepStartHistory: history,
  });
  assert.ok(snapshot.byteLength <= 786_432);
  assert.ok(snapshot.byteLength >= 515_000);

  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.CanonicalRuntimeSnapshot", {
        schemaVersion: 3,
        inputEpoch: "1",
        reliableSequence: "1",
        lastIngressSequence: "1",
        lastAllocatedRunSequence: "0",
        stepStartHistory: [...history, stepStartState(255, 10)],
      }),
    /serialized byte limit/,
  );

  assert.throws(
    () => encodeWireMessage("unframe.realtime.CanonicalRuntimeSnapshot", canonicalSnapshot(2_300)),
    /serialized byte limit/,
  );
});

test("recovery metadata enforces record count, record size, and aggregate size", () => {
  const records = Array.from({ length: 1_024 }, (_, index) => commandRecord(index));
  const recovery = encodeWireMessage(
    "unframe.realtime.RuntimeRecoveryMetadata",
    recoveryMetadata(records),
  );
  assert.ok(recovery.byteLength <= 262_144);

  assert.throws(
    () =>
      encodeWireMessage(
        "unframe.realtime.RuntimeRecoveryMetadata",
        recoveryMetadata([...records, commandRecord(1_024)]),
      ),
    /record count limit/,
  );

  const largeRecordBytes = encodeWireMessage(
    "unframe.realtime.RuntimeCommandHistory",
    largeValidCommandRecord(0),
  );
  assert.ok(largeRecordBytes.byteLength <= 1_024);
  assertRuntimeByteLength("RuntimeCommandHistory", 1_024);
  assert.throws(
    () => assertRuntimeByteLength("RuntimeCommandHistory", 1_025),
    /serialized byte limit/,
  );

  const largeRecovery = Array.from({ length: 600 }, (_, index) => largeValidCommandRecord(index));
  assert.throws(
    () =>
      encodeWireMessage(
        "unframe.realtime.RuntimeRecoveryMetadata",
        recoveryMetadata(largeRecovery),
      ),
    /serialized byte limit/,
  );
});

test("worst-case durable checkpoint JSON remains below the two-megabyte D1 row ceiling", () => {
  const canonicalBytes = encodeWireMessage(
    "unframe.realtime.CanonicalRuntimeSnapshot",
    canonicalSnapshot(1_150),
  );
  const recoveryBytes = encodeWireMessage(
    "unframe.realtime.RuntimeRecoveryMetadata",
    recoveryMetadata(Array.from({ length: 465 }, (_, index) => largeValidCommandRecord(index))),
  );
  assert.ok(canonicalBytes.byteLength <= 786_432);
  assert.ok(recoveryBytes.byteLength <= 262_144);
  assert.ok(canonicalBytes.byteLength + recoveryBytes.byteLength > 1_000_000);
  assert.ok(canonicalBytes.byteLength + recoveryBytes.byteLength <= 1_048_576);
  const checkpoint = JSON.stringify({
    schemaVersion: 3,
    checkpointSequence: "1",
    sessionId: "s".repeat(128),
    runtimeId: "r".repeat(128),
    runtimeKind: "RUNTIME_KIND_VENUE_EDGE",
    assignmentEpoch: "1",
    publication: {
      presentationId: "p".repeat(128),
      publicationEpoch: "1",
      publicationManifestHash: "a".repeat(64),
    },
    definitionHash: "b".repeat(64),
    renderBundleHash: "c".repeat(64),
    reliableSequence: "1",
    canonicalSnapshotHash: createHash("sha256").update(canonicalBytes).digest("hex"),
    canonicalSnapshotPayload: Buffer.from(canonicalBytes).toString("base64"),
    recoveryPayload: Buffer.from(recoveryBytes).toString("base64"),
    recoveryHash: createHash("sha256").update(recoveryBytes).digest("hex"),
  });
  const checkpointBytes = Buffer.byteLength(checkpoint, "utf8");
  assert.ok(checkpointBytes <= 1_572_864, `serialized checkpoint is ${checkpointBytes} bytes`);
  assert.ok(checkpointBytes < 2_000_000);
  assertRuntimeByteLength("CheckpointJson", checkpointBytes);
});

test("input synchronization respects its 4 KiB wire ceiling", () => {
  const sync = {
    phase: 1,
    reason: 1,
    synchronizationRevision: "1",
    inputContext,
    commandEpoch: "1",
    reliableSequence: "1",
    recognitionCatalog: { gestures: [], zones: [] },
  };
  assert.ok(
    encodeWireMessage("unframe.realtime.PresenterInputSynchronization", sync).byteLength <= 4_096,
  );
  assertRuntimeByteLength("PresenterInputSynchronization", 4_096);
  assert.throws(
    () => assertRuntimeByteLength("PresenterInputSynchronization", 4_097),
    /serialized byte limit/,
  );
});
