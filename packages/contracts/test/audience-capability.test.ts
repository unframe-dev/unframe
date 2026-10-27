import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import canonicalize from "canonicalize";
import { createAudienceWebCapabilityProfile } from "../src/presentation/index";

test("Audience profile identity covers its complete capability and resource policy", () => {
  const { capabilityProfileId, ...definition } = createAudienceWebCapabilityProfile();
  const serialized = canonicalize(definition);
  assert.ok(serialized);
  const digest = createHash("sha256").update(serialized).digest("hex");
  assert.equal(capabilityProfileId, `audience-web_${digest}`);
});

test("Audience advertises its implemented renderers and bounded browser policy", () => {
  const profile = createAudienceWebCapabilityProfile();
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
});

test("callers cannot change the shared profile through a returned capability", () => {
  const profile = createAudienceWebCapabilityProfile();
  profile.model.features.length = 0;
  profile.limits.texture.maxTextureBindings = 1;
  const next = createAudienceWebCapabilityProfile();
  assert.ok(next.model.features.includes("skin"));
  assert.equal(next.limits.texture.maxTextureBindings, 8);
  assert.equal(next.capabilityProfileId, profile.capabilityProfileId);
});
