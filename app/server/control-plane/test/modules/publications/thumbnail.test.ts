import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import definition from "../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import renderBundle from "../../../../../../packages/contracts/presentation/fixtures/render-bundle.json";
import assetSet from "../../../../../../packages/contracts/presentation/fixtures/asset-set-manifest.json";
import buildManifest from "../../../../../../packages/contracts/presentation/fixtures/build-manifest.json";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
  type BuildIntegrityInput,
} from "@unframe/core";
import { renderBundleSchema } from "@unframe/contracts/presentation";
import { PublicationService } from "../../../src/modules/publications/service";
import { firstThumbnailTexture } from "../../../src/modules/publications/thumbnail";
import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";
const owner = { userId: "thumbnail-owner", globalRole: "user" as const };
const artifacts = {
  definition,
  renderBundle,
  assetSet,
  buildManifest: { ...buildManifest, sourceDraftRevision: 0 },
};
const upload = (value: BuildIntegrityInput) => ({
  definitionJson: canonicalizeJsonPayload(value.definition),
  renderBundleJson: canonicalizeJsonPayload(value.renderBundle),
  assetSetJson: canonicalizeJsonPayload(value.assetSet),
  buildManifestJson: canonicalizeJsonPayload(value.buildManifest),
});
const publishable = async () => {
  const verified = verifyBuildIntegrity(artifacts);
  if (!verified.valid) throw new Error("Invalid build fixture");
  const copy = structuredClone(verified.value);
  const bakedNode = copy.definition.scene.nodes["node-baked"];
  const bakedSurface = copy.definition.scene.surfaces.baked;
  if (!bakedNode || !bakedSurface || bakedSurface.content.kind !== "structured")
    throw new Error("Missing baked fixture surface");
  const { root, text } = bakedSurface.content.nodes;
  if (!root || root.kind !== "frame" || !text) throw new Error("Missing baked fixture content");
  copy.definition.scene.nodes = { "node-baked": bakedNode };
  copy.definition.scene.surfaces = { baked: bakedSurface };
  bakedSurface.logicalSize = [100, 50];
  root.children = ["text"];
  bakedSurface.content.nodes = { root, text };
  const startStep = copy.definition.flow.groups.intro?.steps.start;
  if (!startStep) throw new Error("Missing fixture start step");
  startStep.cues = [];
  copy.definition.flow.variables = {};
  const bakedRenderSurface = copy.renderBundle.surfaces.baked;
  if (!bakedRenderSurface) throw new Error("Missing baked render surface");
  copy.renderBundle.surfaces = { baked: bakedRenderSurface };
  bakedRenderSurface.logicalSize = [100, 50];
  const renderSurface = bakedRenderSurface.renderSurfaces["render-baked"];
  const artifact = renderSurface?.artifacts["artifact-baked"];
  if (!renderSurface || artifact?.kind !== "baked-web" || !artifact.states.default)
    throw new Error("Missing baked render artifact");
  renderSurface.logicalBounds.height = 50;
  const texture = artifact.states.default.texture;
  texture.pixelSize = [2048, 1024];
  texture.gpuBytes = 8388608;
  copy.renderBundle.models = {};
  for (const id of ["image", "model-asset", "video-asset"]) {
    delete copy.assetSet.assets[id];
  }
  copy.renderBundle.definitionHash = hashCanonicalJsonPayload(copy.definition);
  copy.buildManifest.definitionHash = copy.renderBundle.definitionHash;
  const bytes = Object.fromEntries(
    Object.keys(copy.assetSet.assets).map((id, index) => [
      id,
      new Uint8Array(64).fill(index + 1).buffer,
    ]),
  ) as Record<string, ArrayBuffer>;
  let bundle = JSON.stringify(copy.renderBundle);
  for (const [id, descriptor] of Object.entries(copy.assetSet.assets)) {
    const next = `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes[id]!))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
    bundle = bundle.replaceAll(descriptor.checksum, next);
    descriptor.checksum = next;
  }
  copy.renderBundle = renderBundleSchema.parse(JSON.parse(bundle) as unknown);
  copy.buildManifest.buildId = "build-publishable";
  copy.buildManifest.renderBundleHash = hashCanonicalJsonPayload(copy.renderBundle);
  copy.buildManifest.assetSetHash = hashCanonicalJsonPayload(copy.assetSet);
  return { copy, bytes };
};

const seed = async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, '2026', '2026')",
    ).bind(owner.userId, "thumbnail-owner@example.test"),
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES ('demo', ?, 1, '{}', '2026', '2026')",
    ).bind(owner.userId),
    env.DB.prepare(
      "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES ('demo', ?, 'owner')",
    ).bind(owner.userId),
  ]);
};

describe("publication thumbnail", () => {
  beforeAll(seed);
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM presentation_publications WHERE presentation_id = 'demo'"),
      env.DB.prepare("DELETE FROM presentation_builds WHERE presentation_id = 'demo'"),
    ]);
  });
  const request = (identity: typeof owner | undefined = owner, buildId = "build-publishable") =>
    createApp({ identityProvider: async () => identity }).fetch(
      new Request(`https://example.test/presentations/demo/builds/${buildId}/thumbnail`),
      runtimeEnvironment(),
    );
  const store = async (published = true) => {
    const service = new PublicationService(env.DB, env.ASSETS);
    const { copy, bytes } = await publishable();
    await service.createBuild(owner, "demo", upload(copy));
    for (const [id, descriptor] of Object.entries(copy.assetSet.assets))
      await service.uploadAsset(
        owner,
        "demo",
        copy.buildManifest.buildId,
        id,
        bytes[id]!,
        descriptor.mediaType,
      );
    if (published) await service.publish(owner, "demo", copy.buildManifest.buildId, null);
    return { copy, bytes };
  };
  it("requires identity and presentation read permission", async () => {
    await store();
    const anonymous = await createApp({ identityProvider: async () => undefined }).fetch(
      new Request("https://example.test/presentations/demo/builds/build-publishable/thumbnail"),
      runtimeEnvironment(),
    );
    expect(anonymous.status).toBe(401);
    expect((await request({ ...owner, userId: "other-user" })).status).toBe(403);
    await env.DB.prepare(
      "UPDATE presentation_members SET role = 'editor' WHERE presentation_id = 'demo' AND user_id = ?",
    )
      .bind(owner.userId)
      .run();
    expect((await request()).status).toBe(200);
    await env.DB.prepare(
      "UPDATE presentation_members SET role = 'owner' WHERE presentation_id = 'demo' AND user_id = ?",
    )
      .bind(owner.userId)
      .run();
  });
  it("does not expose unpublished or missing builds", async () => {
    await store(false);
    expect((await request()).status).toBe(404);
    expect((await request(owner, "missing")).status).toBe(404);
    expect((await request(owner, "bad%2Fpath")).status).toBe(400);
  });
  it("rejects MIME, size and checksum mismatches", async () => {
    const { bytes } = await store();
    const key = "publication-builds/demo/build-publishable/texture";
    for (const [body, contentType] of [
      [bytes.texture!, "application/octet-stream"],
      [new Uint8Array(1).buffer, "image/png"],
      [new Uint8Array(64).fill(99).buffer, "image/png"],
    ] as const) {
      await env.ASSETS.put(key, body, { httpMetadata: { contentType } });
      expect((await request()).status).toBe(409);
    }
  });
  it("returns conflict for corrupt stored build integrity", async () => {
    await store();
    await env.DB.prepare(
      "UPDATE presentation_builds SET artifacts = '{}' WHERE presentation_id = 'demo'",
    ).run();
    expect((await request()).status).toBe(409);
    await env.DB.prepare(
      "UPDATE presentation_builds SET artifacts = 'not json' WHERE presentation_id = 'demo'",
    ).run();
    expect((await request()).status).toBe(409);
  });
  it("returns not found when a published build has no baked texture", async () => {
    const { copy } = await store();
    copy.renderBundle.surfaces = {};
    delete copy.assetSet.assets.texture;
    copy.buildManifest.assetSetHash = hashCanonicalJsonPayload(copy.assetSet);
    copy.buildManifest.renderBundleHash = hashCanonicalJsonPayload(copy.renderBundle);
    await env.DB.prepare(
      "UPDATE presentation_builds SET artifacts = ? WHERE presentation_id = 'demo'",
    )
      .bind(JSON.stringify(copy))
      .run();
    expect((await request()).status).toBe(404);
  });
  it("returns the published baked texture bytes with private response headers", async () => {
    const { bytes } = await store();
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe("64");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes.texture!));
  });
});

describe("thumbnail texture order", () => {
  it("uses surface IDs, layer array order, artifact IDs then state IDs", () => {
    const bundle = renderBundleSchema.parse(renderBundle);
    const surface = bundle.surfaces.baked!;
    const layer = surface.renderSurfaces["render-baked"]!;
    const artifact = layer.artifacts["artifact-baked"]!;
    if (artifact.kind !== "baked-web") throw new Error("Missing baked fixture");
    const state = artifact.states.default!;
    const textureState = (assetId: string) => ({
      ...state,
      texture: { ...state.texture, assetId },
    });
    const laterArtifact = { ...artifact, states: { a: textureState("later-artifact") } };
    const firstArtifact = {
      ...artifact,
      states: { a: textureState("later-state"), Z: textureState("chosen") },
    };
    const firstLayer = { ...layer, artifacts: { a: laterArtifact, Z: firstArtifact } };
    const laterLayer = { ...layer, artifacts: { a: laterArtifact } };
    const firstSurface = {
      ...surface,
      renderSurfaceIds: ["z", "a"],
      renderSurfaces: { a: laterLayer, z: firstLayer },
    };
    bundle.surfaces = { a: surface, Z: firstSurface };
    expect(firstThumbnailTexture(bundle)).toBe("chosen");
    firstSurface.renderSurfaceIds = ["a", "z"];
    expect(firstThumbnailTexture(bundle)).toBe("later-artifact");
  });
  it("does not substitute unrelated image assets or native artifacts", () => {
    const bundle = renderBundleSchema.parse(renderBundle);
    delete bundle.surfaces.baked;
    expect(firstThumbnailTexture(bundle)).toBeUndefined();
  });
});
