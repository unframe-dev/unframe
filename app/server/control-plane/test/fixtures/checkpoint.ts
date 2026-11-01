import { encodeWireMessage } from "@unframe/contracts/presentation";

export async function checkpointEnvelope(sessionId = "session", reliableSequence = "5") {
  const progression = {
    currentGroupId: "group",
    currentStepId: "step",
    groupEntryEpoch: "1",
    stepEntryEpoch: "1",
    stable: {},
  };
  const canonical = encodeWireMessage("unframe.realtime.CanonicalRuntimeSnapshot", {
    schemaVersion: 1,
    reliableSequence,
    inputEpoch: "1",
    progression,
    clock: { running: {} },
    stepExecution: { stepEntryEpoch: "1" },
    presentationOrigin: { version: "0", pose: { position: {}, rotation: { w: 1 } } },
  });
  const recovery = encodeWireMessage("unframe.realtime.RuntimeRecoveryMetadata", {
    startedAt: "2026-10-22T00:00:00Z",
    participants: [{ participantId: "presenter", role: 1 }],
    commandEpoch: "1",
    inputSynchronization: {
      phase: 2,
      reason: 8,
      synchronizationRevision: "1",
      reliableSequence,
      commandEpoch: "1",
      inputContext: {
        groupId: "group",
        stepId: "step",
        groupEntryEpoch: "1",
        stepEntryEpoch: "1",
        inputEpoch: "1",
      },
      recognitionCatalog: { gestures: [], zones: [] },
    },
  });
  const hash = async (value: Uint8Array) =>
    `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return {
    schemaVersion: 1,
    checkpointSequence: "1",
    sessionId,
    runtimeId: "runtime",
    runtimeKind: "RUNTIME_KIND_CLOUD",
    assignmentEpoch: "1",
    reliableSequence,
    publication: {
      presentationId: "presentation",
      publicationEpoch: "1",
      publicationManifestHash: `sha256:${"a".repeat(64)}`,
    },
    definitionHash: `sha256:${"b".repeat(64)}`,
    renderBundleHash: `sha256:${"c".repeat(64)}`,
    canonicalSnapshotPayload: btoa(String.fromCharCode(...canonical)),
    canonicalSnapshotHash: await hash(canonical),
    recoveryPayload: btoa(String.fromCharCode(...recovery)),
    recoveryHash: await hash(recovery),
  };
}
