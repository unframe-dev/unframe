import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDeliveryFixtureArtifacts } from "./delivery-project.ts";

test("compiles deterministic partitioned interaction and Cue contracts without a browser", async () => {
  const first = await buildDeliveryFixtureArtifacts();
  const second = await buildDeliveryFixtureArtifacts();
  assert.deepEqual(first, second);
  assert.equal(first.definition.schemaVersion, 1);
  assert.equal(first.renderBundle.schemaVersion, 1);
  assert.equal(first.assetSet.schemaVersion, 1);
  assert.equal(first.buildManifest.schemaVersion, 1);
  const surface = Object.values(first.renderBundle.surfaces)[0];
  assert.ok(surface);
  assert.equal(surface.renderSurfaceIds.length, 2);
  assert.ok(
    Object.values(surface.interactionsByState).some((interactions) => interactions.length > 0),
  );
  assert.ok(
    Object.values(first.definition.flow.groups).some((group) =>
      Object.values(group.steps).some((step) => step.cues.length > 0),
    ),
  );
});
