import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createScheduledHandler } from "../../src/index";
import { collectDeletedPresentationBuilds } from "../../src/modules/publications/cleanup";
import { D1PresentationRepository } from "../../src/presentation/repository";
import { PresentationService } from "../../src/presentation/service";
import { runtimeEnvironment } from "../runtime-environment";

const createPublishedPresentation = async () => {
  const ownerId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, '2026', '2026')",
  )
    .bind(ownerId, `${ownerId}@example.test`)
    .run();
  const identity = { userId: ownerId, globalRole: "user" } as const;
  const registration = { id, name: "Presentation" };
  const service = new PresentationService(new D1PresentationRepository(env.DB), () => "2026");
  await service.create(identity, registration);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO presentation_builds (presentation_id, build_id, target_revision, artifacts, created_at) VALUES (?, 'build', 1, '{}', '2026')",
    ).bind(id),
    env.DB.prepare(
      "INSERT INTO presentation_publications (presentation_id, epoch, build_id, manifest, published_at) VALUES (?, 1, 'build', '{}', '2026')",
    ).bind(id),
    env.DB.prepare(
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, publication_epoch, created_at) VALUES (?, ?, ?, ?, 'Ended', 1, '2026')",
    ).bind(sessionId, id, ownerId, sessionId),
  ]);
  return { identity, service, id, sessionId, registration };
};

const scheduled = async () => {
  let job: Promise<unknown> | undefined;
  await createScheduledHandler(undefined, () => {})({} as ScheduledEvent, runtimeEnvironment(), {
    waitUntil: (promise: Promise<unknown>) => {
      job = promise;
    },
  } as ExecutionContext);
  await job;
};

const makeCleanupDue = async (id: string) => {
  await env.DB.prepare(
    "UPDATE presentation_build_cleanup SET available_at = '2000-01-01' WHERE presentation_id = ?",
  )
    .bind(id)
    .run();
};

describe("published presentation deletion", () => {
  it("removes ended history and collects even a late publication upload without touching neighboring keys", async () => {
    const { id, sessionId, identity, registration, service } = await createPublishedPresentation();
    const key = `publication-builds/${id}/build/late-asset`;
    const neighborKey = `publication-builds/${id}-neighbor/build/asset`;
    await env.ASSETS.put(neighborKey, "neighbor");

    await service.delete(identity, id, 1);
    await expect(service.get(identity, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      env.DB.prepare("SELECT id FROM presentation_sessions WHERE id = ?").bind(sessionId).first(),
    ).resolves.toBeNull();
    await expect(service.create(identity, registration)).rejects.toMatchObject({
      code: "conflict",
    });

    await env.ASSETS.put(key, "late upload");
    await scheduled();
    await expect(env.ASSETS.head(key)).resolves.not.toBeNull();
    await makeCleanupDue(id);
    await scheduled();
    await expect(env.ASSETS.head(key)).resolves.toBeNull();
    await expect(env.ASSETS.head(neighborKey)).resolves.not.toBeNull();
    await expect(service.create(identity, registration)).resolves.toMatchObject({ id });
  });

  it("keeps ended history and publication intact when the deletion revision is stale", async () => {
    const { id, sessionId, identity, service } = await createPublishedPresentation();

    await expect(service.delete(identity, id, 2)).rejects.toMatchObject({ code: "conflict" });
    await expect(service.get(identity, id)).resolves.toMatchObject({ id, revision: 1 });
    await expect(
      env.DB.prepare("SELECT id FROM presentation_sessions WHERE id = ?").bind(sessionId).first(),
    ).resolves.toEqual({ id: sessionId });
    await expect(
      env.DB.prepare("SELECT epoch FROM presentation_publications WHERE presentation_id = ?")
        .bind(id)
        .first(),
    ).resolves.toEqual({ epoch: 1 });
  });

  it("retries a failed R2 deletion after its lease expires", async () => {
    const { id, identity, registration, service } = await createPublishedPresentation();
    await service.delete(identity, id, 1);
    await makeCleanupDue(id);
    const key = `publication-builds/${id}/build/asset`;
    await env.ASSETS.put(key, "asset");
    const now = new Date();
    const unavailable = {
      list: env.ASSETS.list.bind(env.ASSETS),
      delete: async () => {
        throw new Error("R2 temporarily unavailable");
      },
    };

    await expect(collectDeletedPresentationBuilds(env.DB, unavailable, now)).resolves.toEqual({
      deleted: 0,
      failed: 1,
    });
    await expect(service.create(identity, registration)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(collectDeletedPresentationBuilds(env.DB, env.ASSETS, now)).resolves.toEqual({
      deleted: 0,
      failed: 0,
    });
    await expect(env.ASSETS.head(key)).resolves.not.toBeNull();

    const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    await expect(collectDeletedPresentationBuilds(env.DB, env.ASSETS, nextDay)).resolves.toEqual({
      deleted: 1,
      failed: 0,
    });
    await expect(env.ASSETS.head(key)).resolves.toBeNull();
  });
});
