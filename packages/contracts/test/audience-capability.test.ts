import assert from "node:assert/strict";
import test from "node:test";
import { createAudienceWebCapabilityProfile } from "../src/presentation/index";

test("Audience advertises its implemented renderers and bounded browser policy", () => {
  const profile = createAudienceWebCapabilityProfile();
  assert.equal(profile.capabilityProfileId, "audience-web-v1");
  assert.deepEqual(profile.contractVersions, {
    delivery: 3,
    runtime: 3,
    progression: 2,
    projection: 2,
  });
  assert.deepEqual(profile.renderers.video.features, ["h264", "audio"]);
  assert.equal(profile.renderers.nativeUi.supported, false);
  assert.equal(profile.localOverlaySupported, false);
  assert.equal(profile.limits.texture.maxTextureBindings, 8);
  assert.equal(profile.limits.video.maxConcurrentDecoders, 1);
  assert.ok(profile.model.features.includes("skin"));
  profile.model.features.length = 0;
  assert.ok(createAudienceWebCapabilityProfile().model.features.includes("skin"));
});
