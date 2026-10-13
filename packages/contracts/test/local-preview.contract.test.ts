import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeWireMessage,
  encodeWireMessage,
  getPresentationWireType,
} from "../src/presentation/wire";

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
    initialState: { nodeStates: [], surfaceStates: [] },
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
