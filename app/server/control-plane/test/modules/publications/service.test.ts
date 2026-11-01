import { seedCloudHost } from "../../fixtures/runtime-host";
import { checkpointEnvelope } from "../../fixtures/checkpoint";
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi, assert } from "vitest";
import definition from "../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import renderBundle from "../../../../../../packages/contracts/presentation/fixtures/render-bundle.json";
import assetSet from "../../../../../../packages/contracts/presentation/fixtures/asset-set-manifest.json";
import buildManifest from "../../../../../../packages/contracts/presentation/fixtures/build-manifest.json";
import { PublicationAssetAccess } from "../../../src/modules/publications/asset-access";
import { DeliveryService } from "../../../src/modules/publications/delivery";
import { validateConfig } from "../../../src/config";
import {
  audienceWebCapabilityProfileId,
  decodeWireMessage,
  type DeliveryManifestWire,
} from "@unframe/contracts/presentation";
import { normalizedCapability } from "../../../src/modules/publications/capability";
import { buildProjectionProfile } from "@unframe/delivery";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
  validatePresentationArtifacts,
  type BuildIntegrityInput,
} from "@unframe/artifacts";
import { renderBundleSchema } from "@unframe/contracts/presentation";
import { PublicationError, PublicationService } from "../../../src/modules/publications/service";
import { D1SessionRepository } from "../../../src/modules/sessions/repository";
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
    await seedCloudHost("runtime-demo", "https://runtime.example.test");
    await seedCloudHost("new-runtime", "https://new.test");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM presentation_sessions WHERE presentation_id = 'demo'"),
      env.DB.prepare("DELETE FROM presentation_publications WHERE presentation_id = 'demo'"),
      env.DB.prepare("DELETE FROM presentation_builds WHERE presentation_id = 'demo'"),
      env.DB.prepare("UPDATE presentations SET revision = 1 WHERE id = 'demo'"),
    ]);
  });
  it("rejects build IDs that escape a publication storage segment", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    const { copy } = await publishable();
    copy.buildManifest.buildId = "x/../../victim/build";
    await expect(service.createBuild(owner, "demo", upload(copy))).rejects.toMatchObject({
      code: "invalid_build",
    });
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM presentation_builds WHERE presentation_id = 'demo'",
    ).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("connects an anonymous viewer through join, delivery and realtime bootstrap", async () => {
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
    await service.publish(owner, "demo", copy.buildManifest.buildId, null);
    const { sha256JoinCode } = await import("../../../src/modules/sessions/service");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, created_at, publication_epoch) VALUES ('anonymous-live', 'demo', ?, ?, 'Presenting', '2026', 1)",
      ).bind(owner.userId, await sha256JoinCode("PLAY-ABCD")),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at, host_generation) VALUES ('anonymous-live', 'runtime-demo', 'Cloud', 'https://runtime.example.test', 1, 1, '2026', '2099-01-01T00:00:00.000Z', 1)",
      ),
    ]);
    const app = createApp();
    const request = (path: string, body: unknown, token?: string) =>
      app.fetch(
        new Request(`https://example.test${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        }),
        runtimeEnvironment(),
      );
    const issued = await request("/viewer-credentials", { joinCode: "PLAY-ABCD" });
    expect(issued.status).toBe(201);
    const credential = (await issued.json()) as { token: string; participantId: string };
    expect(
      (await request("/sessions/join", { joinCode: "PLAY-ABCD" }, credential.token)).status,
    ).toBe(200);
    const preparingDelivery = await request(
      "/sessions/anonymous-live/delivery",
      { capabilityProfileId: audienceWebCapabilityProfileId },
      credential.token,
    );
    expect(preparingDelivery.status).toBe(409);
    await expect(preparingDelivery.json()).resolves.toMatchObject({
      error: { code: "runtime_unavailable" },
    });
    const preparingBootstrap = await request(
      "/sessions/anonymous-live/bootstrap",
      {},
      credential.token,
    );
    expect(preparingBootstrap.status).toBe(409);
    await expect(preparingBootstrap.json()).resolves.toMatchObject({
      error: { code: "runtime_unavailable" },
    });
    await env.DB.prepare(
      "UPDATE runtime_assignments SET execution_state = 'ready' WHERE session_id = 'anonymous-live'",
    ).run();
    const delivery = await request(
      "/sessions/anonymous-live/delivery",
      { capabilityProfileId: audienceWebCapabilityProfileId },
      credential.token,
    );
    expect(delivery.status).toBe(200);
    expect(delivery.headers.get("content-type")).toBe("application/x-protobuf");
    const manifest = decodeWireMessage(
      "unframe.delivery.DeliveryManifest",
      new Uint8Array(await delivery.arrayBuffer()),
    ) as DeliveryManifestWire;
    expect(manifest.capabilityProfile?.capabilityProfileId).toBe(audienceWebCapabilityProfileId);
    expect(manifest.projectionProfile?.key?.capabilityProfileId).toBe(
      audienceWebCapabilityProfileId,
    );
    const bootstrap = await request("/sessions/anonymous-live/bootstrap", {}, credential.token);
    expect(bootstrap.status).toBe(200);
    await expect(bootstrap.json()).resolves.toMatchObject({ runtimeId: "runtime-demo" });
    const participant = await env.DB.prepare(
      "SELECT role FROM session_participants WHERE user_id = ?",
    )
      .bind(credential.participantId)
      .first();
    expect(participant).toEqual({ role: "viewer" });
    await env.DB.prepare(
      "DELETE FROM runtime_assignments WHERE session_id = 'anonymous-live'",
    ).run();
    const recovering = await request("/sessions/anonymous-live/bootstrap", {}, credential.token);
    expect(recovering.status).toBe(409);
    await expect(recovering.json()).resolves.toMatchObject({
      error: { code: "runtime_unavailable" },
    });
    const unavailableDelivery = await request(
      "/sessions/anonymous-live/delivery",
      { capabilityProfileId: audienceWebCapabilityProfileId },
      credential.token,
    );
    expect(unavailableDelivery.status).toBe(409);
    await expect(unavailableDelivery.json()).resolves.toMatchObject({
      error: { code: "runtime_unavailable" },
    });
    await env.DB.prepare(
      "UPDATE presentation_sessions SET publication_epoch = NULL WHERE id = 'anonymous-live'",
    ).run();
    const invalidSession = await request(
      "/sessions/anonymous-live/bootstrap",
      {},
      credential.token,
    );
    expect(invalidSession.status).toBe(409);
    await expect(invalidSession.json()).resolves.toMatchObject({ error: { code: "conflict" } });
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

  it("pins the latest publication atomically when creating a session races with publication", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    const sessions = new D1SessionRepository(env.DB);
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
    const first = await service.publish(owner, "demo", copy.buildManifest.buildId, null);
    const sessionId = crypto.randomUUID();
    const [creation, publication] = await Promise.allSettled([
      sessions.create(
        {
          id: sessionId,
          presentationId: "demo",
          presenterId: owner.userId,
          joinCode: "ABCD-EFGH",
          joinCodeHash: sessionId,
          state: "Waiting",
          participantCount: 1,
          maxParticipants: 50,
          createdAt: "2026",
          endedAt: null,
        },
        { sessionId, userId: owner.userId, role: "presenter", joinedAt: "2026" },
      ),
      service.publish(owner, "demo", copy.buildManifest.buildId, {
        presentationId: "demo",
        publicationEpoch: first.publicationEpoch,
        publicationManifestHash: first.publicationManifestHash,
      }),
    ]);
    expect(creation).toMatchObject({ status: "fulfilled", value: { id: sessionId } });
    const latest = await service.latest(owner, "demo");
    await expect(sessions.findById(sessionId)).resolves.toMatchObject({
      publicationFence: {
        presentationId: "demo",
        publicationEpoch: latest.publicationEpoch,
        publicationManifestHash: latest.publicationManifestHash,
      },
    });
    expect([
      { status: "fulfilled", value: expect.objectContaining({ publicationEpoch: 2 }) },
      { status: "rejected", reason: expect.objectContaining({ code: "conflict" }) },
    ]).toContainEqual(publication);
    await expect(
      service.publish(owner, "demo", copy.buildManifest.buildId, {
        presentationId: "demo",
        publicationEpoch: latest.publicationEpoch,
        publicationManifestHash: latest.publicationManifestHash,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("claims a Venue Edge execution once per assignment epoch, including before the first checkpoint", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    const { copy, bytes } = await publishable();
    await service.createBuild(owner, "demo", upload(copy));
    for (const [id, descriptor] of Object.entries(copy.assetSet.assets)) {
      await service.uploadAsset(
        owner,
        "demo",
        copy.buildManifest.buildId,
        id,
        bytes[id]!,
        descriptor.mediaType,
      );
    }
    await service.publish(owner, "demo", copy.buildManifest.buildId, null);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO venue_edges (id,runtime_id,status,last_seen_at,created_at) VALUES ('execution-edge','edge-runtime','active','2099','2026')",
      ),
      env.DB.prepare(
        "INSERT INTO presentation_sessions (id,presentation_id,presenter_id,join_code_hash,state,created_at,publication_epoch) VALUES ('edge-execution-session','demo',?,'execution-hash','Presenting','2026',1)",
      ).bind(owner.userId),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id,runtime_id,runtime_kind,endpoint,provisioning_edge_id,epoch,revision,issued_at,lease_expires_at) VALUES ('edge-execution-session','edge-runtime','VenueEdge','https://edge.test','execution-edge',1,1,'2026','2099')",
      ),
    ]);
    const app = createApp();
    const path =
      "https://example.test/internal/runtime/bootstrap?sessionId=edge-execution-session&runtimeId=edge-runtime&assignmentEpoch=1";
    const bootstrap = (bootId?: string) =>
      app.fetch(
        new Request(`${path}${bootId ? `&executionBootId=${bootId}` : ""}`, {
          headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` },
        }),
        runtimeEnvironment(),
      );
    expect((await bootstrap()).status).toBe(409);
    const claims = await Promise.all([bootstrap("first-process"), bootstrap("concurrent-process")]);
    expect(claims.map((response) => response.status).sort()).toEqual([200, 409]);
    const winningBoot = claims[0]!.status === 200 ? "first-process" : "concurrent-process";
    const first = claims.find((response) => response.status === 200);
    assert.isDefined(first);
    await expect(first.json()).resolves.toMatchObject({ checkpoint: null });
    expect((await bootstrap(winningBoot)).status).toBe(200);
    expect((await bootstrap("restarted-process")).status).toBe(409);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE runtime_assignments SET released_at = '2026' WHERE session_id = 'edge-execution-session' AND epoch = 1",
      ),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id,runtime_id,runtime_kind,endpoint,provisioning_edge_id,epoch,revision,issued_at,lease_expires_at) SELECT session_id,runtime_id,runtime_kind,endpoint,provisioning_edge_id,2,revision,issued_at,lease_expires_at FROM runtime_assignments WHERE session_id = 'edge-execution-session' AND epoch = 1",
      ),
    ]);
    const newEpoch = await app.fetch(
      new Request(
        `${path.replace("assignmentEpoch=1", "assignmentEpoch=2")}&executionBootId=restarted-process`,
        { headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` } },
      ),
      runtimeEnvironment(),
    );
    expect(newEpoch.status).toBe(200);
    expect((await bootstrap(winningBoot)).status).toBe(409);
  });

  it("validates stored v3 checkpoints and byte limits before runtime bootstrap", async () => {
    const service = new PublicationService(env.DB, env.ASSETS);
    const { copy, bytes } = await publishable();
    await service.createBuild(owner, "demo", upload(copy));
    for (const [id, descriptor] of Object.entries(copy.assetSet.assets)) {
      await service.uploadAsset(
        owner,
        "demo",
        copy.buildManifest.buildId,
        id,
        bytes[id]!,
        descriptor.mediaType,
      );
    }
    await service.publish(owner, "demo", copy.buildManifest.buildId, null);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, created_at, publication_epoch) VALUES ('publication-runtime-session', 'demo', ?, 'publication-runtime-hash', 'Presenting', '2026', 1)",
      ).bind(owner.userId),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at, host_generation, execution_state) VALUES ('publication-runtime-session', 'runtime-demo', 'Cloud', 'https://runtime.example.test', 1, 1, '2026', '2099-01-01T00:00:00.000Z', 1, 'ready')",
      ),
    ]);
    const app = createApp();
    const runtimePath =
      "https://example.test/internal/runtime/bootstrap?sessionId=publication-runtime-session&runtimeId=runtime-demo&assignmentEpoch=1";
    const invalidCloudBoot = await app.fetch(
      new Request(`${runtimePath}&executionBootId=standalone-process`, {
        headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` },
      }),
      runtimeEnvironment(),
    );
    expect(invalidCloudBoot.status).toBe(409);
    const initial = await app.fetch(
      new Request(runtimePath, {
        headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` },
      }),
      runtimeEnvironment(),
    );
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({
      checkpoint: null,
      checkpointSource: null,
    });
    const pinned = (await service.publishedArtifacts("demo", 1)).publishedPresentation;
    const storedEnvelope = {
      ...(await checkpointEnvelope("publication-runtime-session")),
      runtimeId: "runtime-demo",
      publication: {
        presentationId: pinned.presentationId,
        publicationEpoch: String(pinned.publicationEpoch),
        publicationManifestHash: pinned.publicationManifestHash,
      },
      definitionHash: pinned.definitionHash,
      renderBundleHash: pinned.renderBundleHash,
    };
    for (const [payload, status] of [
      [JSON.stringify("あ".repeat(524288)), 409],
      [JSON.stringify({ ...storedEnvelope, schemaVersion: 2 }), 409],
      [JSON.stringify(storedEnvelope), 200],
    ] as const) {
      await env.DB.prepare(
        "INSERT OR REPLACE INTO session_checkpoints (session_id, version, last_sequence, idempotency_key, payload, received_at) VALUES ('publication-runtime-session', 1, 5, 'checkpoint', ?, '2026')",
      )
        .bind(payload)
        .run();
      const restored = await app.fetch(
        new Request(runtimePath, {
          headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` },
        }),
        runtimeEnvironment(),
      );
      expect(restored.status).toBe(status);
    }
    for (const corrupt of [
      { ...storedEnvelope, sessionId: "other-session" },
      { ...storedEnvelope, checkpointSequence: "2" },
      { ...storedEnvelope, reliableSequence: "6" },
      { ...storedEnvelope, runtimeId: "missing-runtime" },
      { ...storedEnvelope, runtimeKind: "RUNTIME_KIND_VENUE_EDGE" },
      { ...storedEnvelope, assignmentEpoch: "2" },
      { ...storedEnvelope, definitionHash: `sha256:${"0".repeat(64)}` },
      { ...storedEnvelope, renderBundleHash: `sha256:${"0".repeat(64)}` },
      { ...storedEnvelope, publication: { ...storedEnvelope.publication, publicationEpoch: "2" } },
    ]) {
      await env.DB.prepare(
        "UPDATE session_checkpoints SET payload = ? WHERE session_id = 'publication-runtime-session'",
      )
        .bind(JSON.stringify(corrupt))
        .run();
      const response = await app.fetch(
        new Request(runtimePath, {
          headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` },
        }),
        runtimeEnvironment(),
      );
      expect(response.status).toBe(409);
    }
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE session_checkpoints SET payload = ? WHERE session_id = 'publication-runtime-session'",
      ).bind(JSON.stringify(storedEnvelope)),
      env.DB.prepare(
        "UPDATE runtime_assignments SET released_at = '2026' WHERE session_id = 'publication-runtime-session'",
      ),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id,runtime_id,runtime_kind,endpoint,epoch,revision,issued_at,lease_expires_at,host_generation) VALUES ('publication-runtime-session','new-runtime','Cloud','https://new.test',2,1,'2026','2099',1)",
      ),
    ]);
    const restored = await app.fetch(
      new Request(
        runtimePath.replace(
          "runtimeId=runtime-demo&assignmentEpoch=1",
          "runtimeId=new-runtime&assignmentEpoch=2",
        ),
        { headers: { authorization: `Bearer ${runtimeEnvironment().SERVICE_IDENTITY_SECRET}` } },
      ),
      runtimeEnvironment(),
    );
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      assignment: { runtimeId: "new-runtime", assignmentEpoch: 2 },
      checkpoint: storedEnvelope,
      checkpointSource: {
        runtimeId: "runtime-demo",
        runtimeKind: "Cloud",
        assignmentEpoch: 1,
        checkpointSequence: 1,
      },
    });
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
         (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at, host_generation, execution_state)
         VALUES ('publication-runtime-session', 'runtime-demo', 'Cloud', 'https://runtime.example.test', 1, 1, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 1, 'ready')`,
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
    for (const asset of externalDelivery.assetAccess!) {
      const expectedKey = `publication-builds/demo/${copy.buildManifest.buildId}/${asset.assetId}`;
      expect(decodeURIComponent(new URL(asset.url!).pathname)).toBe(`/assets/${expectedKey}`);
      expect(await env.ASSETS.head(expectedKey)).not.toBeNull();
    }
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
    await env.DB.prepare(
      `INSERT INTO venue_edges (id, runtime_id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at)
       VALUES ('delivery-edge', 'runtime-demo', 'active', 'test', 'v3', 1, 'https://venue.example.test:9443', ?, 'healthy', ?, ?, ?)`,
    )
      .bind(
        `sha256:${"a".repeat(64)}`,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    await env.DB.prepare(
      "UPDATE runtime_assignments SET runtime_kind = 'VenueEdge', endpoint = 'https://venue.example.test:9443', provisioning_edge_id = 'delivery-edge', certificate_fingerprint = ? WHERE session_id = 'publication-runtime-session'",
    )
      .bind(`sha256:${"a".repeat(64)}`)
      .run();
    const edgeDelivery = decodeWireMessage(
      "unframe.delivery.DeliveryManifest",
      await new DeliveryService(validateConfig(environment)).manifest(
        owner,
        "publication-runtime-session",
        "quest-baked-web-v1",
      ),
    ) as DeliveryManifestWire;
    expect(edgeDelivery.assetAccess![0]!.url).toBe(
      `https://venue.example.test:9443/sessions/publication-runtime-session/assets/${encodeURIComponent(edgeDelivery.assetAccess![0]!.assetId!)}`,
    );
    const resolveAsset = (overrides: Record<string, string> = {}, authorized = true) =>
      app.fetch(
        new Request(
          `https://example.test/internal/runtime/assets?${new URLSearchParams({ sessionId: "publication-runtime-session", runtimeId: "runtime-demo", assignmentEpoch: "1", participantId: owner.userId, assetId: edgeDelivery.assetAccess![0]!.assetId!, ...overrides })}`,
          {
            headers: authorized
              ? { authorization: `Bearer ${environment.SERVICE_IDENTITY_SECRET}` }
              : {},
          },
        ),
        environment,
      );
    const resolved = await resolveAsset();
    expect(resolved.status).toBe(200);
    await expect(resolved.json()).resolves.toMatchObject({
      checksum: edgeDelivery.assetAccess![0]!.checksum,
      size: Number(edgeDelivery.assetAccess![0]!.encodedSizeBytes),
      mediaType: edgeDelivery.assetAccess![0]!.mediaType,
      publication: { publicationManifestHash: manifest.publicationManifestHash },
    });
    expect((await resolveAsset({}, false)).status).toBe(401);
    expect((await resolveAsset({ assignmentEpoch: "2" })).status).toBe(409);
    expect((await resolveAsset({ participantId: "missing" })).status).toBe(403);
    expect((await resolveAsset({ assetId: "missing" })).status).toBe(403);
    await env.DB.prepare(
      "UPDATE venue_edges SET status = 'revoked' WHERE id = 'delivery-edge'",
    ).run();
    expect((await resolveAsset()).status).toBe(409);
    await env.DB.prepare(
      "UPDATE runtime_assignments SET runtime_kind = 'Cloud', endpoint = 'https://runtime.example.test', provisioning_edge_id = NULL, certificate_fingerprint = NULL WHERE session_id = 'publication-runtime-session'",
    ).run();
    await env.DB.prepare("DELETE FROM venue_edges WHERE id = 'delivery-edge'").run();
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

it("normalizes the media-capable Unity profile independently of the baked-only profile", () => {
  const media = normalizedCapability("unity-media-v1");
  expect(media.model.supported).toBe(true);
  expect(media.renderers.video).toMatchObject({ supported: true, features: ["h264", "audio"] });
  media.model.features.length = 0;
  expect(normalizedCapability("unity-media-v1").model.features).toContain("animation");
  expect(normalizedCapability("quest-baked-web-v1").model.supported).toBe(false);
  expect(() => normalizedCapability("unknown")).toThrow("Unsupported device capability profile");
});
