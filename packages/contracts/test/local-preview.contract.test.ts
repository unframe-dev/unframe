import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeWireMessage,
  encodeWireMessage,
  getPresentationWireType,
} from "../src/presentation/wire";

test("Preview playback carries ordered state and the shared runtime clock without a session envelope", () => {
  const name = "unframe.preview.LocalPreviewPlaybackState";
  const input = {
    requestId: "b".repeat(32),
    sequence: "9007199254740993",
    nodeStates: [],
    surfaceStates: [],
    activeRuns: [],
    mediaStates: [],
    modelClipStates: [],
    clock: { runtimeTimeMs: "500", paused: {} },
    currentGroupId: "main",
  };
  assert.deepEqual(decodeWireMessage(name, encodeWireMessage(name, input)), input);
  assert.throws(
    () => encodeWireMessage(name, { ...input, sessionId: "invented" }),
    /not a wire field/,
  );
});

test("Preview reuses the catalog and state messages without a publication or session envelope", () => {
  const type = getPresentationWireType("unframe.preview.LocalPreviewEnvelope");
  assert.deepEqual(
    type.fieldsArray.map((field) => field.name),
    [
      "schemaVersion",
      "requestId",
      "sourceRevision",
      "buildManifest",
      "assetSet",
      "projection",
      "initialState",
      "assets",
    ],
  );
  const input = {
    schemaVersion: 1,
    requestId: "a".repeat(32),
    buildManifest: "{}",
    assetSet: "{}",
    projection: {
      runtimeCatalog: {
        catalogContractVersion: 2,
        motionGuides: [],
        nodes: [],
        surfaces: [],
        variables: [],
        timelines: [],
        modelClips: [],
      },
      visibleNodeIds: [],
      visibleSurfaceIds: [],
      visibleVariableIds: [],
      renderSurfaces: [],
      semanticSurfaces: [],
      localOverlays: [],
      requiredRuntimeCapabilities: [],
    },
    initialState: { nodeStates: [], surfaceStates: [], mediaStates: [], modelClipStates: [] },
    assets: [],
  };
  const decoded = decodeWireMessage(
    "unframe.preview.LocalPreviewEnvelope",
    encodeWireMessage("unframe.preview.LocalPreviewEnvelope", input),
  );
  assert.deepEqual(decoded, input);
  assert.throws(
    () =>
      encodeWireMessage("unframe.preview.LocalPreviewEnvelope", {
        ...input,
        sessionId: "invented",
      }),
    /not a wire field/,
  );
});
