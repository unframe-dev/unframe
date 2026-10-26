import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeWireMessage, encodeWireMessage } from "../src/presentation/wire";

const context = {
  inputEpoch: "7",
  groupId: "intro",
  groupEntryEpoch: "2",
  stepId: "start",
  stepEntryEpoch: "3",
};
const gesture = {
  clientEventId: "4:550e8400-e29b-41d4-a716-446655440000",
  inputContext: context,
  commandEpoch: "4",
  presentationOriginVersion: "0",
  gesture: 1,
};

test("capacity recovery records attempted sizes instead of the rolled-back snapshot sizes", () => {
  const type = "unframe.realtime.RuntimeCapacityFault";
  const required = {
    stepStartStateBytes: "70000",
    stepStartHistoryBytes: "70004",
    canonicalSnapshotBytes: "140100",
  };
  assert.deepEqual(decodeWireMessage(type, encodeWireMessage(type, required)), required);
  for (const field of Object.keys(required)) {
    assert.throws(() => encodeWireMessage(type, { ...required, [field]: "0" }));
  }
  assert.doesNotThrow(() => encodeWireMessage("unframe.realtime.Paused", { reason: 9 }));
});

test("Presenter Step selection catalog exposes reached IDs at a Reliable cut without saved state", () => {
  const catalog = {
    reachedSteps: [{ groupId: "intro", stepId: "start" }],
    reliableSequence: "12",
  };
  const type = "unframe.realtime.ControlServerItem";
  assert.deepEqual(
    decodeWireMessage(type, encodeWireMessage(type, { presenterStepSelectionCatalog: catalog })),
    { presenterStepSelectionCatalog: catalog },
  );
  assert.throws(
    () =>
      encodeWireMessage(type, {
        presenterStepSelectionCatalog: { ...catalog, stepStartHistory: [] },
      }),
    /not a wire field/,
  );
  for (const reachedSteps of [
    [{ groupId: "", stepId: "start" }],
    [catalog.reachedSteps[0], catalog.reachedSteps[0]],
    [
      { groupId: "z", stepId: "s" },
      { groupId: "a", stepId: "s" },
    ],
  ])
    assert.throws(() =>
      encodeWireMessage(type, {
        presenterStepSelectionCatalog: { ...catalog, reachedSteps },
      }),
    );
});

test("recognized gestures retain their captured input context without client authority fields", () => {
  const name = "unframe.realtime.GestureInputCommand";
  assert.deepEqual(decodeWireMessage(name, encodeWireMessage(name, gesture)), gesture);
  for (const field of ["actor", "cueId", "nextState"])
    assert.throws(() => encodeWireMessage(name, { ...gesture, [field]: "invented" }));
});

test("normal commands require captured context and command epochs; global controls do not require a Step", () => {
  for (const [name, value] of [
    ["GestureInputCommand", gesture],
    ["ZoneInputCommand", { ...gesture, gesture: undefined, zoneId: "stage", edge: 1 }],
    [
      "LogicalInputCommand",
      {
        clientEventId: gesture.clientEventId,
        inputContext: context,
        commandEpoch: "4",
        logicalEventName: "next",
      },
    ],
    [
      "SurfaceInteractionCommand",
      {
        clientEventId: gesture.clientEventId,
        inputContext: context,
        commandEpoch: "4",
        surfaceId: "screen",
        interactionId: "next",
      },
    ],
  ] as const) {
    const command = Object.fromEntries(
      Object.entries(value).filter(([, field]) => field !== undefined),
    );
    const type = `unframe.realtime.${name}`;
    assert.doesNotThrow(() => encodeWireMessage(type, command));
    const { inputContext: _, ...missing } = command;
    assert.throws(() => encodeWireMessage(type, missing), /context/i);
    assert.throws(
      () =>
        encodeWireMessage(type, { ...command, inputContext: { ...context, stepEntryEpoch: "0" } }),
      /context/i,
    );
  }
  const control = { clientEventId: gesture.clientEventId, commandEpoch: "4", kind: 1 };
  assert.doesNotThrow(() => encodeWireMessage("unframe.realtime.RuntimeControlCommand", control));
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.RuntimeControlCommand", {
        ...control,
        inputContext: context,
      }),
    /not a wire field/,
  );
  assert.throws(
    () => encodeWireMessage("unframe.realtime.RuntimeControlCommand", { ...control, kind: 4 }),
    /Step selection/,
  );
  assert.doesNotThrow(() =>
    encodeWireMessage("unframe.realtime.RuntimeControlCommand", {
      ...control,
      kind: 4,
      stepSelection: { groupId: "intro", stepId: "start" },
    }),
  );
});

test("command IDs cannot be reused in a later command epoch after history compaction", () => {
  const type = "unframe.realtime.GestureInputCommand";
  for (const clientEventId of [
    "button-old",
    "04:550e8400-e29b-41d4-a716-446655440000",
    "4:550E8400-E29B-41D4-A716-446655440000",
  ])
    assert.throws(() => encodeWireMessage(type, { ...gesture, clientEventId }), /Command ID/);
  assert.throws(() => encodeWireMessage(type, { ...gesture, commandEpoch: "5" }), /Command ID/);
  assert.doesNotThrow(() =>
    encodeWireMessage(type, {
      ...gesture,
      commandEpoch: "5",
      clientEventId: "5:550e8400-e29b-41d4-a716-446655440000",
    }),
  );
});

test("presenter synchronization acknowledgements carry context, epoch and reliable cut", () => {
  const name = "unframe.realtime.InputSynchronizationAck";
  const ack = {
    synchronizationRevision: "19",
    inputContext: context,
    commandEpoch: "5",
    appliedReliableSequence: "120",
    pendingCommandsDiscarded: true,
  };
  assert.deepEqual(decodeWireMessage(name, encodeWireMessage(name, ack)), ack);
  for (const patch of [
    { pendingCommandsDiscarded: false },
    { synchronizationRevision: "0" },
    { commandEpoch: "0" },
    { inputContext: {} },
  ])
    assert.throws(() => encodeWireMessage(name, { ...ack, ...patch }));
  const sync = {
    phase: 1,
    reason: 7,
    synchronizationRevision: "19",
    inputContext: context,
    commandEpoch: "4",
    nextCommandEpoch: "5",
    reliableSequence: "120",
    recognitionCatalog: { gestures: [1], zones: [] },
  };
  const type = "unframe.realtime.PresenterInputSynchronization";
  assert.deepEqual(decodeWireMessage(type, encodeWireMessage(type, sync)), sync);
  assert.throws(() => encodeWireMessage(type, { ...sync, nextCommandEpoch: "6" }), /exactly once/);
  assert.throws(() => encodeWireMessage(type, { ...sync, phase: 2 }), /Ready/);
  const { recognitionCatalog: _, ...missingCatalog } = sync;
  assert.throws(() => encodeWireMessage(type, missingCatalog), /recognition catalog/i);
});

test("Step restore is one projected replacement and cannot carry server-only history", () => {
  const type = "unframe.realtime.RuntimeViewReplaced";
  const runtimeView = {
    projectionProfileId: "profile",
    assignmentEpoch: "1",
    baseReliableSequence: "12",
    frozenAnchors: [{ nodeId: "follow", position: { x: 1 } }],
  };
  const decoded = decodeWireMessage(type, encodeWireMessage(type, { runtimeView }));
  assert.equal((decoded["runtimeView"] as Record<string, unknown>)["baseReliableSequence"], "12");
  for (const privateField of ["stepStartHistory", "inputEpoch", "commands"])
    assert.throws(
      () => encodeWireMessage(type, { runtimeView: { ...runtimeView, [privateField]: [] } }),
      /not a wire field/,
    );
  assert.throws(() => encodeWireMessage(type, {}), /projected view/);
});

test("every v3 version boundary rejects its former major and requires synchronization capabilities", () => {
  for (const name of ["ControlHandshake", "StateHandshake"])
    assert.throws(() =>
      encodeWireMessage(`unframe.realtime.${name}`, {
        protocolVersion: "v2",
        progressionContractVersion: 1,
      }),
    );
  for (const name of [
    "CanonicalRuntimeSnapshot",
    "ConnectionSnapshotEnvelope",
    "DurableCheckpointEnvelope",
  ])
    assert.throws(() => encodeWireMessage(`unframe.realtime.${name}`, { schemaVersion: 2 }));
  assert.throws(() =>
    encodeWireMessage("unframe.presentation.ProjectedRuntimeCatalog", {
      catalogContractVersion: 2,
    }),
  );
  assert.throws(() =>
    encodeWireMessage("unframe.delivery.DeliveryManifest", {
      schemaVersion: 2,
      deliveryContractVersion: 2,
    }),
  );
  assert.throws(() =>
    encodeWireMessage("unframe.realtime.ControlHandshake", {
      protocolVersion: "v3",
      progressionContractVersion: 2,
      supportedCapabilities: [1],
    }),
  );
});

test("recovery metadata cannot omit or mix its command and synchronization epochs", () => {
  const name = "unframe.realtime.RuntimeRecoveryMetadata";
  assert.throws(() => encodeWireMessage(name, {}));
  const sync = {
    phase: 2,
    reason: 1,
    synchronizationRevision: "19",
    inputContext: context,
    commandEpoch: "4",
    reliableSequence: "120",
    recognitionCatalog: { gestures: [], zones: [] },
  };
  const recovery = {
    startedAt: "2026-10-22T00:00:00.000Z",
    participants: [{ participantId: "presenter", role: 1 }],
    commands: [],
    commandEpoch: "4",
    inputSynchronization: sync,
  };
  assert.doesNotThrow(() => encodeWireMessage(name, recovery));
  assert.throws(() => encodeWireMessage(name, { ...recovery, commandEpoch: "5" }));
});

test("canonical input epochs and Step history identity have the same required ranges as Zod", () => {
  for (const inputEpoch of [undefined, "0"])
    assert.throws(
      () =>
        encodeWireMessage("unframe.realtime.CanonicalRuntimeSnapshot", {
          schemaVersion: 3,
          ...(inputEpoch === undefined ? {} : { inputEpoch }),
        }),
      /input epoch/i,
    );
  const name = "unframe.realtime.StepStartState";
  assert.throws(() => encodeWireMessage(name, {}), /Step start/i);
  const state = { groupId: "intro", stepId: "start", groupEntryEpoch: "1", stepEntryEpoch: "1" };
  assert.doesNotThrow(() => encodeWireMessage(name, state));
  for (const patch of [
    { groupId: "" },
    { stepId: "" },
    { groupEntryEpoch: "0" },
    { stepEntryEpoch: "0" },
  ])
    assert.throws(() => encodeWireMessage(name, { ...state, ...patch }), /Step start/i);
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.ProjectedAnchorBindingPatch", {
        nodeId: "follow",
        frozen: { nodeId: "other", position: {} },
      }),
    /must match/,
  );
});
