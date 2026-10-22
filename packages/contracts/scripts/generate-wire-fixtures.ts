import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { encodeWireMessage, getPresentationWireType } from "../src/presentation/wire";
import type { WireMessageType } from "../src/presentation/wire-metadata";
import { formatGenerated } from "./format-generated";

const fixtures = [
  {
    typeName: "unframe.realtime.NodeStatePatch",
    value: { transform: { position: { x: 1 } } },
  },
  {
    typeName: "unframe.realtime.NodeStatePatch",
    value: { transform: { rotation: { w: 1 } } },
  },
  {
    typeName: "unframe.realtime.NodeStatePatch",
    value: { transform: { scale: { x: 1 } } },
  },
  {
    typeName: "unframe.realtime.MediaStoppedSeeked",
    value: { surfaceId: "video", heldPositionMs: 1.25 },
  },
  {
    typeName: "unframe.realtime.ProjectedReliableEvent",
    value: { mediaStoppedSeeked: { surfaceId: "video", heldPositionMs: 1.25 } },
  },
  {
    typeName: "unframe.delivery.DeliveryManifest",
    value: {
      schemaVersion: 3,
      deliveryContractVersion: 3,
      sessionId: "session-1",
      publication: {
        presentationId: "presentation-1",
        publicationEpoch: "9007199254740993",
        publicationManifestHash: "sha256:publication",
      },
      projectionProfile: {
        projectionProfileId: "profile-1",
        key: { projectionContractVersion: 2 },
      },
      projectionInstance: {
        projectionProfileId: "profile-1",
        participantId: "participant-1",
        assignmentEpoch: "9007199254740995",
      },
      assetAccess: [
        {
          assetId: "asset-1",
          checksum: "sha256:asset",
          mediaType: "image/png",
          encodedSizeBytes: "12345",
          url: "https://example.invalid/asset",
          expiresAtUnixMs: "9007199254740997",
        },
      ],
    },
  },
  {
    typeName: "unframe.realtime.ControlClientItem",
    value: {
      handshake: {
        protocolVersion: "v3",
        progressionContractVersion: 2,
        supportedCapabilities: [1, 5, 8, 9, 10],
        resume: {
          priorConnectionId: "connection-1",
          appliedReliableSequence: "9007199254740999",
          fence: {
            sessionId: "session-1",
            publication: {
              presentationId: "presentation-1",
              publicationEpoch: "9007199254740993",
              publicationManifestHash: "sha256:publication",
            },
            assignmentEpoch: "9007199254740995",
            projectionProfileId: "profile-1",
            presentationOriginVersion: "9007199254741001",
          },
        },
      },
    },
  },
] as const;

const inputContext = {
  inputEpoch: "7",
  groupId: "intro",
  groupEntryEpoch: "2",
  stepId: "start",
  stepEntryEpoch: "3",
};
const command = {
  clientEventId: "4:550e8400-e29b-41d4-a716-446655440000",
  inputContext,
  commandEpoch: "4",
  presentationOriginVersion: "0",
};
const authorityFixtures = [
  {
    typeName: "unframe.realtime.GestureInputCommand",
    value: {
      ...command,
      clientEventId: "18446744073709551615:550e8400-e29b-41d4-a716-446655440000",
      commandEpoch: "18446744073709551615",
      gesture: 8,
    },
  },
  {
    typeName: "unframe.realtime.ZoneInputCommand",
    value: { ...command, zoneId: "stage", edge: 1 },
  },
  {
    typeName: "unframe.realtime.PresenterInputSynchronization",
    value: {
      phase: 1,
      reason: 7,
      synchronizationRevision: "9007199254740993",
      inputContext,
      commandEpoch: "4",
      nextCommandEpoch: "5",
      reliableSequence: "9007199254740995",
      recognitionCatalog: {
        gestures: [1, 8],
        zones: [{ zoneId: "stage", center: { x: 1, y: 2, z: 3 } }],
      },
    },
  },
  {
    typeName: "unframe.realtime.InputSynchronizationAck",
    value: {
      synchronizationRevision: "9007199254740993",
      inputContext,
      commandEpoch: "5",
      appliedReliableSequence: "9007199254740995",
      pendingCommandsDiscarded: true,
    },
  },
  {
    typeName: "unframe.realtime.ProjectedAnchorBindingPatch",
    value: { nodeId: "follow", frozen: { nodeId: "follow", position: { x: 1, y: 2, z: 3 } } },
  },
  {
    typeName: "unframe.realtime.RuntimeViewReplaced",
    value: {
      runtimeView: {
        projectionProfileId: "profile",
        assignmentEpoch: "1",
        baseReliableSequence: "12",
        progression: {
          currentGroupId: "intro",
          groupEntryEpoch: "2",
          currentStepId: "start",
          stepEntryEpoch: "3",
          stepEnteredAtRuntimeTimeMs: "100",
          stable: {},
        },
        clock: { runtimeTimeMs: "100", paused: { reason: 8 } },
        presentationOrigin: { version: "0", pose: { position: {}, rotation: { w: 1 } } },
        nodeStates: [
          {
            nodeId: "follow",
            active: true,
            visible: true,
            opacity: 1,
            transform: { position: {}, rotation: { w: 1 }, scale: { x: 1, y: 1, z: 1 } },
          },
        ],
        frozenAnchors: [{ nodeId: "follow", position: { x: 1, y: 2, z: 3 } }],
      },
    },
  },
];

function canonicalWireValue(
  type: WireMessageType,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of type.fieldsArray) {
    const item = value[field.name];
    if (item === undefined) continue;
    const nested = field.resolvedType;
    const convert = (entry: unknown): unknown =>
      nested && "fieldsArray" in nested
        ? canonicalWireValue(nested, entry as Record<string, unknown>)
        : entry;
    if (field.repeated) result[field.name] = (item as unknown[]).map(convert);
    else if (
      !field.partOf &&
      (item === false ||
        item === "" ||
        item === 0 ||
        (["uint64", "int64", "fixed64", "sfixed64", "sint64"].includes(field.type) && item === "0"))
    )
      continue;
    else result[field.name] = convert(item);
  }
  return result;
}

for (const [name, entries] of [
  ["conformance", fixtures],
  ["presenter-authority", authorityFixtures],
] as const) {
  const output = resolve(import.meta.dirname, `../presentation/fixtures/wire/${name}.json`);
  const rows = entries.map(({ typeName, value }) => {
    const canonical = canonicalWireValue(getPresentationWireType(typeName), value);
    return {
      typeName,
      value: canonical,
      hex: Buffer.from(encodeWireMessage(typeName, canonical)).toString("hex"),
    };
  });
  const content = formatGenerated(output, `${JSON.stringify(rows, null, 2)}\n`);
  if (process.argv.includes("--check")) {
    if ((await readFile(output, "utf8")) !== content) {
      process.stderr.write(`Presentation ${name} wire fixture is stale\n`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(output, content);
  }
}
