import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import definition from "../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import renderBundle from "../../../../../../packages/contracts/presentation/fixtures/render-bundle.json";
import assetSet from "../../../../../../packages/contracts/presentation/fixtures/asset-set-manifest.json";
import buildManifest from "../../../../../../packages/contracts/presentation/fixtures/build-manifest.json";
import { PublicationAssetAccess } from "../../../src/modules/publications/asset-access";
import { DeliveryService } from "../../../src/modules/publications/delivery";
import { validateConfig } from "../../../src/config";
import { decodeWireMessage, type DeliveryManifestWire } from "@unframe/contracts/presentation";
import { normalizedCapability } from "../../../src/modules/publications/capability";
import {
  buildProjectionProfile,
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
  validatePresentationArtifacts,
  type BuildIntegrityInput,
} from "@unframe/unframe-core";
import { renderBundleSchema } from "@unframe/contracts/presentation";
import { PublicationError, PublicationService } from "../../../src/modules/publications/service";
import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";

const owner = { userId: "publication-owner", globalRole: "user" as const };
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
    ).bind(owner.userId, "publication-owner@example.test"),
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES ('demo', ?, 1, '{}', '2026', '2026')",
    ).bind(owner.userId),
    env.DB.prepare(
      "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES ('demo', ?, 'owner')",
    ).bind(owner.userId),
  ]);
};

describe("publication service", () => {
  beforeAll(seed);
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM presentation_sessions WHERE presentation_id = 'demo'"),
      env.DB.prepare("DELETE FROM presentation_publications WHERE presentation_id = 'demo'"),
      env.DB.prepare("DELETE FROM presentation_builds WHERE presentation_id = 'demo'"),
      env.DB.prepare("UPDATE presentations SET revision = 1 WHERE id = 'demo'"),
    ]);
  });
  it("accepts a canonical build through the bounded HTTP route", async () => {
    const response = await createApp({ identityProvider: async () => owner }).fetch(
      new Request("https://example.test/presentations/demo/builds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(upload(artifacts)),
      }),
      runtimeEnvironment(),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ buildId: "build-1" });
  });
  it.each([
    [undefined, 401],
    [{ userId: "stranger", globalRole: "user" as const }, 403],
  ] as const)(
    "rejects a build writer with status %s/%s before reading the body",
    async (identity, status) => {
      let read = false;
      const request = new Request("https://example.test/presentations/demo/builds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              read = true;
              controller.enqueue(new TextEncoder().encode(JSON.stringify(upload(artifacts))));
              controller.close();
            },
          },
          { highWaterMark: 0 },
        ),
      });
      const response = await createApp({ identityProvider: async () => identity }).fetch(
        request,
        runtimeEnvironment(),
      );
      expect(response.status).toBe(status);
      expect(read).toBe(false);
    },
  );
  it("accepts a semantically valid build and rejects tampering and unauthorized writers", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    await expect(service.createBuild(owner, "demo", upload(artifacts))).resolves.toEqual({
      buildId: "build-1",
      assetIds: Object.keys(assetSet.assets).sort(),
    });
    await expect(
      service.createBuild({ userId: "stranger", globalRole: "user" }, "demo", upload(artifacts)),
    ).rejects.toMatchObject({ code: "forbidden" } satisfies Partial<PublicationError>);
    await expect(
      service.createBuild(
        owner,
        "demo",
        upload({
          ...artifacts,
          definition: { ...definition, metadata: { title: "Tampered" } },
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_build" } satisfies Partial<PublicationError>);
    const mismatched = structuredClone(artifacts);
    mismatched.renderBundle.surfaces.baked.semanticsByState.default.nodes.label.text = "Changed";
    mismatched.buildManifest.renderBundleHash = hashCanonicalJsonPayload(mismatched.renderBundle);
    await expect(service.createBuild(owner, "demo", upload(mismatched))).rejects.toMatchObject({
      code: "invalid_build",
    } satisfies Partial<PublicationError>);
    await expect(
      service.createBuild(owner, "demo", {
        ...upload(artifacts),
        definitionJson: '{"schemaVersion":2,"schemaVersion":2}',
      }),
    ).rejects.toMatchObject({ code: "invalid_build" } satisfies Partial<PublicationError>);
  });

  it("reuses exactly the same canonical immutable build and rejects same-ID changes", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    await service.createBuild(owner, "demo", upload(artifacts));
    await env.DB.prepare(
      "UPDATE presentations SET revision = revision + 1 WHERE id = 'demo'",
    ).run();
    await expect(service.createBuild(owner, "demo", upload(artifacts))).resolves.toMatchObject({
      buildId: "build-1",
    });
    const changed = structuredClone(artifacts);
    changed.buildManifest.sourceDraftRevision = 1;
    await expect(service.createBuild(owner, "demo", upload(changed))).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      service.createBuild({ userId: "stranger", globalRole: "user" }, "demo", upload(artifacts)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects asset bytes that do not match the build descriptor", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    await service.createBuild(owner, "demo", upload(artifacts));
    await expect(
      service.uploadAsset(
        owner,
        "demo",
        "build-1",
        "image",
        new Uint8Array(64).buffer,
        "image/png",
      ),
    ).rejects.toMatchObject({ code: "invalid_asset" } satisfies Partial<PublicationError>);
    await expect(service.publish(owner, "demo", "build-1", null)).rejects.toMatchObject({
      code: "invalid_asset",
    } satisfies Partial<PublicationError>);
  });

  it("authenticates asset uploads before reading and enforces the actual descriptor size", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    await service.createBuild(owner, "demo", upload(artifacts));
    let read = false;
    const request = () =>
      new Request("https://example.test/presentations/demo/builds/build-1/assets/image", {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": "1" },
        body: new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              read = true;
              controller.enqueue(new Uint8Array(65));
              controller.close();
            },
          },
          { highWaterMark: 0 },
        ),
      });
    const unauthorized = await createApp().fetch(request(), runtimeEnvironment());
    expect(unauthorized.status).toBe(401);
    expect(read).toBe(false);
    const authorized = await createApp({ identityProvider: async () => owner }).fetch(
      request(),
      runtimeEnvironment(),
    );
    expect(authorized.status).toBe(422);
    expect(read).toBe(true);
    expect(await env.ASSETS.get("publication-builds/demo/build-1/image")).toBeNull();
  });

  it("publishes a fixed Dist after draft edits and atomically compares the full publication fence", async () => {
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
    await env.DB.prepare(
      "UPDATE presentations SET revision = revision + 1 WHERE id = 'demo'",
    ).run();
    const first = await service.publish(owner, "demo", copy.buildManifest.buildId, null);
    expect(first.publicationEpoch).toBe(1);
    const fence = {
      presentationId: first.presentationId,
      publicationEpoch: first.publicationEpoch,
      publicationManifestHash: first.publicationManifestHash,
    };
    await expect(
      service.publish(owner, "demo", copy.buildManifest.buildId, null),
    ).rejects.toMatchObject({ code: "conflict" });
    for (const mismatch of [
      { ...fence, presentationId: "other" },
      { ...fence, publicationEpoch: 2 },
      { ...fence, publicationManifestHash: `sha256:${"0".repeat(64)}` },
    ])
      await expect(
        service.publish(owner, "demo", copy.buildManifest.buildId, mismatch),
      ).rejects.toMatchObject({ code: "conflict" });
    const results = await Promise.allSettled([
      service.publish(owner, "demo", copy.buildManifest.buildId, fence),
      service.publish(owner, "demo", copy.buildManifest.buildId, fence),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "conflict" } });
    await expect(service.latest(owner, "demo")).resolves.toMatchObject({ publicationEpoch: 2 });
  });

  it("publishes verified R2 bytes atomically and refuses updates during active use", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    const { copy, bytes } = await publishable();
    const integrity = verifyBuildIntegrity(copy);
    expect(integrity.valid, JSON.stringify(integrity.diagnostics)).toBe(true);
    const validation = validatePresentationArtifacts(copy.definition, copy.renderBundle, {
      fullDelivery: true,
    });
    expect(validation.valid, JSON.stringify(validation.diagnostics)).toBe(true);
    await service.createBuild(owner, "demo", upload(copy));
    const app = createApp({ identityProvider: async () => owner });
    for (const [id, descriptor] of Object.entries(copy.assetSet.assets)) {
      if (id === "image") {
        const response = await app.fetch(
          new Request(
            `https://example.test/presentations/demo/builds/${copy.buildManifest.buildId}/assets/${id}`,
            { method: "PUT", headers: { "content-type": descriptor.mediaType }, body: bytes[id]! },
          ),
          runtimeEnvironment(),
        );
        expect(response.status).toBe(204);
      } else {
        await service.uploadAsset(
          owner,
          "demo",
          copy.buildManifest.buildId,
          id,
          bytes[id]!,
          descriptor.mediaType,
        );
      }
    }
    await env.DB.prepare(
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, created_at) VALUES ('publication-session', 'demo', ?, 'publication-session-hash', 'Waiting', '2026')",
    )
      .bind(owner.userId)
      .run();
    await expect(
      service.publish(owner, "demo", copy.buildManifest.buildId, null),
    ).rejects.toMatchObject({ code: "conflict" } satisfies Partial<PublicationError>);
    await env.DB.prepare(
      "UPDATE presentation_sessions SET state = 'Ended' WHERE id = 'publication-session'",
    ).run();
    const manifest = await service.publish(owner, "demo", copy.buildManifest.buildId, null);
    expect(manifest).toMatchObject({
      presentationId: "demo",
      publicationEpoch: 1,
      buildId: "build-publishable",
    });

    const environment = {
      ...runtimeEnvironment(),
      PUBLICATION_ASSET_ORIGIN: "https://assets.example.test",
    };
    const signer = new PublicationAssetAccess(environment.SERVICE_IDENTITY_SECRET);
    const servedAssetId = Object.keys(copy.assetSet.assets)[0]!;
    const servedDescriptor = copy.assetSet.assets[servedAssetId]!;
    const assetTarget = {
      presentationId: "demo",
      buildId: copy.buildManifest.buildId,
      assetId: servedAssetId,
    };
    const signedUrl = await signer.issue(
      environment.PUBLICATION_ASSET_ORIGIN,
      assetTarget,
      Date.now() + 300_000,
    );
    expect((await createApp().fetch(new Request(signedUrl), runtimeEnvironment())).status).toBe(
      403,
    );
    const missingAssetUrl = await signer.issue(
      environment.PUBLICATION_ASSET_ORIGIN,
      { ...assetTarget, assetId: "missing" },
      Date.now() + 300_000,
    );
    expect((await createApp().fetch(new Request(missingAssetUrl), environment)).status).toBe(404);
    const served = await createApp().fetch(new Request(signedUrl), environment);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe(servedDescriptor.mediaType);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(
      new Uint8Array(bytes[servedAssetId]!),
    );
    for (const modified of [
      signedUrl.replace(`/${servedAssetId}?`, "/other?"),
      signedUrl.replace(/signature=[a-f0-9]+/, `signature=${"0".repeat(64)}`),
    ]) {
      expect((await createApp().fetch(new Request(modified), environment)).status).toBe(403);
    }
    expect(
      (await createApp().fetch(new Request(signedUrl.split("?")[0]!), environment)).status,
    ).toBe(400);
    const expiredUrl = await new PublicationAssetAccess(
      environment.SERVICE_IDENTITY_SECRET,
      () => Date.now() - 400_000,
    ).issue(environment.PUBLICATION_ASSET_ORIGIN, assetTarget, Date.now() - 100_000);
    expect((await createApp().fetch(new Request(expiredUrl), environment)).status).toBe(403);
    const key = `publication-builds/demo/${copy.buildManifest.buildId}/${servedAssetId}`;
    await env.ASSETS.put(key, bytes[servedAssetId]!, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    expect((await createApp().fetch(new Request(signedUrl), environment)).status).toBe(409);
    await env.ASSETS.put(key, new Uint8Array(1), {
      httpMetadata: { contentType: servedDescriptor.mediaType },
    });
    expect((await createApp().fetch(new Request(signedUrl), environment)).status).toBe(409);
    const corruptBytes = new Uint8Array(bytes[servedAssetId]!.slice(0));
    corruptBytes[0] = corruptBytes[0]! ^ 255;
    await env.ASSETS.put(key, corruptBytes, {
      httpMetadata: { contentType: servedDescriptor.mediaType },
    });
    expect((await createApp().fetch(new Request(signedUrl), environment)).status).toBe(409);
    await service.uploadAsset(
      owner,
      "demo",
      copy.buildManifest.buildId,
      servedAssetId,
      bytes[servedAssetId]!,
      servedDescriptor.mediaType,
    );
    await expect(service.latest(owner, "demo")).resolves.toEqual(manifest);
    const fetched = await app.fetch(
      new Request("https://example.test/presentations/demo/publication"),
      runtimeEnvironment(),
    );
    expect(fetched.status).toBe(200);
    await expect(fetched.json()).resolves.toEqual(manifest);
    const anonymous = await createApp().fetch(
      new Request("https://example.test/presentations/demo/publication"),
      runtimeEnvironment(),
    );
    expect(anonymous.status).toBe(401);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO presentation_sessions
         (id, presentation_id, presenter_id, join_code_hash, state, created_at, publication_epoch)
         VALUES ('publication-runtime-session', 'demo', ?, 'publication-runtime-hash', 'Presenting', '2026', 1)`,
      ).bind(owner.userId),
      env.DB.prepare(
        `INSERT INTO runtime_assignments
         (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at)
         VALUES ('publication-runtime-session', 'runtime-demo', 'Cloud', 'https://runtime.example.test', 1, 1, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`,
      ),
    ]);
    const runtimePath =
      "https://example.test/internal/runtime/bootstrap?sessionId=publication-runtime-session&runtimeId=runtime-demo&assignmentEpoch=1";
    const noServiceToken = await app.fetch(new Request(runtimePath), runtimeEnvironment());
    expect(noServiceToken.status).toBe(401);
    const bootstrap = await app.fetch(
      new Request(runtimePath, {
        headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` },
      }),
      runtimeEnvironment(),
    );
    expect(bootstrap.status).toBe(200);
    await expect(bootstrap.json()).resolves.toMatchObject({
      publication: { publicationManifestHash: manifest.publicationManifestHash },
      assignment: { assignmentEpoch: 1, runtimeId: "runtime-demo" },
      definition: { presentationId: "demo" },
      renderBundle: copy.renderBundle,
      checkpoint: null,
    });
    await env.DB.prepare(
      "INSERT INTO session_participants (session_id, user_id, role, joined_at) VALUES ('publication-runtime-session', ?, 'presenter', '2026')",
    )
      .bind(owner.userId)
      .run();
    const missingCapability = await app.fetch(
      new Request("https://example.test/sessions/publication-runtime-session/bootstrap", {
        method: "POST",
      }),
      runtimeEnvironment(),
    );
    expect(missingCapability.status).toBe(409);
    const projection = await app.fetch(
      new Request(
        "https://example.test/internal/runtime/projection?sessionId=publication-runtime-session&participantId=publication-owner",
        { headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` } },
      ),
      runtimeEnvironment(),
    );
    expect(projection.status).toBe(404);
    const capability = normalizedCapability("quest-baked-web-v1");
    const { profile } = buildProjectionProfile(
      { ...(await service.publishedArtifacts("demo", manifest.publicationEpoch)), capability },
      "presenter",
    );
    await env.DB.prepare(
      `INSERT INTO session_participant_capabilities
       (session_id, user_id, capability_profile_id, capability_json, projection_profile_id, selected_at)
       VALUES ('publication-runtime-session', ?, ?, ?, ?, '2026')`,
    )
      .bind(
        owner.userId,
        capability.capabilityProfileId,
        JSON.stringify(capability),
        profile.projectionProfileId,
      )
      .run();
    const projectionRequest = () =>
      new Request(
        "https://example.test/internal/runtime/projection?sessionId=publication-runtime-session&participantId=publication-owner",
        { headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` } },
      );
    const currentProjection = await app.fetch(projectionRequest(), runtimeEnvironment());
    expect(currentProjection.status).toBe(200);
    await expect(currentProjection.json()).resolves.toMatchObject({ role: "presenter", profile });
    const externalDelivery = decodeWireMessage(
      "unframe.delivery.DeliveryManifest",
      await new DeliveryService(validateConfig(runtimeEnvironment())).manifest(
        owner,
        "publication-runtime-session",
        "quest-baked-web-v1",
      ),
    ) as DeliveryManifestWire;
    expect(externalDelivery.assetAccess![0]!.url).toContain("r2.cloudflarestorage.com");
    const encodedDelivery = await new DeliveryService(validateConfig(environment)).manifest(
      owner,
      "publication-runtime-session",
      "quest-baked-web-v1",
    );
    const delivery = decodeWireMessage(
      "unframe.delivery.DeliveryManifest",
      encodedDelivery,
    ) as DeliveryManifestWire;
    expect(delivery.assetAccess!.length).toBeGreaterThan(0);
    for (const deliveryAsset of delivery.assetAccess!) {
      expect(deliveryAsset.url!).toMatch(/^https:\/\/assets\.example\.test\/publication-assets\//);
      const fetchedAsset = await createApp().fetch(new Request(deliveryAsset.url!), environment);
      expect(fetchedAsset.status).toBe(200);
      expect(new Uint8Array(await fetchedAsset.arrayBuffer())).toEqual(
        new Uint8Array(bytes[deliveryAsset.assetId!]!),
      );
    }
    const publishedArtifacts = PublicationService.prototype.publishedArtifacts;
    const artifactRead = vi
      .spyOn(PublicationService.prototype, "publishedArtifacts")
      .mockImplementationOnce(async function (this: PublicationService, ...args) {
        const result = await publishedArtifacts.apply(this, args);
        await env.DB.prepare(
          "UPDATE session_participants SET role = 'viewer' WHERE session_id = 'publication-runtime-session' AND user_id = ?",
        )
          .bind(owner.userId)
          .run();
        return result;
      });
    try {
      const staleProjection = await app.fetch(projectionRequest(), runtimeEnvironment());
      expect(staleProjection.status).toBe(409);
    } finally {
      artifactRead.mockRestore();
    }
    await expect(
      service.publish(owner, "demo", copy.buildManifest.buildId, null),
    ).rejects.toMatchObject({ code: "conflict" } satisfies Partial<PublicationError>);
  });
});
