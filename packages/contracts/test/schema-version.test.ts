import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  assetSetManifestSchema,
  buildManifestSchema,
  capabilityProfileSchema,
  presentationDefinitionSchema,
  publishedPresentationSchema,
  renderBundleSchema,
} from "../src/presentation/index";
import { validateAuthorityWireValue } from "../src/presentation/runtime-authority";

for (const [name, schema] of [
  ["presentation-definition", presentationDefinitionSchema],
  ["render-bundle", renderBundleSchema],
  ["asset-set-manifest", assetSetManifestSchema],
  ["build-manifest", buildManifestSchema],
  ["published-presentation", publishedPresentationSchema],
  ["capability-profile", capabilityProfileSchema],
] as const) {
  test(`${name} accepts schema version 1 and rejects previous development versions`, async () => {
    const value = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, "../presentation/fixtures", `${name}.json`),
        "utf8",
      ),
    );
    const current = { ...value, schemaVersion: 1 };
    if (current.contractVersions?.definition !== undefined) {
      Object.assign(current.contractVersions, { definition: 1, renderBundle: 1, assetSet: 1 });
    }
    assert.equal(schema.safeParse(current).success, true);
    for (const schemaVersion of [0, 2, 3]) {
      assert.equal(schema.safeParse({ ...current, schemaVersion }).success, false);
    }
  });
}

for (const name of [
  "CanonicalRuntimeSnapshot",
  "ConnectionSnapshotEnvelope",
  "DurableCheckpointEnvelope",
  "CapabilityProfile",
  "DeliveryManifest",
]) {
  test(`${name} wire admission requires schema version 1`, () => {
    const value = { schemaVersion: 1, inputEpoch: "1", deliveryContractVersion: 3 };
    assert.doesNotThrow(() => validateAuthorityWireValue(name, value));
    for (const schemaVersion of [0, 2, 3]) {
      assert.throws(() => validateAuthorityWireValue(name, { ...value, schemaVersion }));
    }
  });
}
