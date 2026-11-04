import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeWireMessage, encodeWireMessage } from "../src/presentation/wire";

const type = "unframe.delivery.TextureResidencyPlan";
const plan = {
  budgetTierId: "test",
  textures: [
    {
      assetId: "png",
      checksum: `sha256:${"a".repeat(64)}`,
      pixelSize: { width: "2", height: "2" },
      decodedGpuBytes: "16",
      peakLoadCpuBytes: "112",
    },
  ],
  totalDecodedGpuBytes: "16",
  maximumPeakLoadCpuBytes: "112",
  initialGroupId: "intro",
  groupWindows: [
    { groupId: "intro", assetIds: ["png"] },
    { groupId: "outro", assetIds: [] },
  ],
  maximumResidentGpuBytes: "16",
  maximumResidentTextureBindings: "1",
};

test("a residency plan carries the catalog and bounded group windows", () => {
  assert.deepEqual(decodeWireMessage(type, encodeWireMessage(type, plan)), plan);
});

test("a residency plan rejects unknown window assets and a missing initial group", () => {
  assert.throws(
    () =>
      encodeWireMessage(type, {
        ...plan,
        groupWindows: [{ groupId: "intro", assetIds: ["missing"] }],
      }),
    /residency/i,
  );
  assert.throws(
    () => encodeWireMessage(type, { ...plan, initialGroupId: "missing" }),
    /residency/i,
  );
});

test("a residency plan rejects understated window maxima", () => {
  assert.throws(
    () => encodeWireMessage(type, { ...plan, maximumResidentGpuBytes: "15" }),
    /residency/i,
  );
  assert.throws(
    () => encodeWireMessage(type, { ...plan, maximumResidentTextureBindings: "0" }),
    /residency/i,
  );
});
