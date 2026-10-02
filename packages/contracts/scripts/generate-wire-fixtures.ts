import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { encodeWireMessage } from "../src/presentation/v2/wire";
import { formatGenerated } from "./format-generated";

const fixtures = [
  {
    typeName: "unframe.realtime.v2.NodeStatePatch",
    value: { transform: { position: { x: 1 } } },
  },
  {
    typeName: "unframe.realtime.v2.NodeStatePatch",
    value: { transform: { rotation: { w: 1 } } },
  },
  {
    typeName: "unframe.realtime.v2.NodeStatePatch",
    value: { transform: { scale: { x: 1 } } },
  },
  {
    typeName: "unframe.realtime.v2.MediaStoppedSeeked",
    value: { surfaceId: "video", heldPositionMs: 1.25 },
  },
  {
    typeName: "unframe.realtime.v2.ProjectedReliableEvent",
    value: { mediaStoppedSeeked: { surfaceId: "video", heldPositionMs: 1.25 } },
  },
  {
    typeName: "unframe.delivery.v2.DeliveryManifest",
    value: {
      schemaVersion: 2,
      deliveryContractVersion: 2,
      sessionId: "session-1",
      publication: {
        presentationId: "presentation-1",
        publicationEpoch: "9007199254740993",
        publicationManifestHash: "sha256:publication",
      },
      projectionProfile: {
        projectionProfileId: "profile-1",
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
    typeName: "unframe.realtime.v2.ControlClientItem",
    value: {
      handshake: {
        protocolVersion: "v2",
        progressionContractVersion: 2,
        supportedCapabilities: [1, 5],
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

const output = resolve(import.meta.dirname, "../presentation/v2/fixtures/wire/conformance.json");
const rows = fixtures.map(({ typeName, value }) => ({
  typeName,
  value,
  hex: Buffer.from(encodeWireMessage(typeName, value)).toString("hex"),
}));
const content = formatGenerated(output, `${JSON.stringify(rows, null, 2)}\n`);
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== content) {
    process.stderr.write("Presentation v2 wire conformance fixture is stale\n");
    process.exitCode = 1;
  }
} else {
  await writeFile(output, content);
}
