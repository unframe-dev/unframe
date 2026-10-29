import { seedCloudHost } from "../../fixtures/runtime-host";
import { env } from "cloudflare:test";
import { describe, expect, it, assert } from "vitest";
import { createApp } from "../../../src/app";
import { checkpointEnvelope } from "../../fixtures/checkpoint";
import { runtimeEnvironment } from "../../runtime-environment";

const seedSession = async () => {
  const sessionId = crypto.randomUUID();
  await seedCloudHost("runtime", "https://runtime.example.com");
  const userId = `owner-${sessionId}`;
  const presentationId = `presentation-${sessionId}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(userId, "Owner", `${userId}@example.test`, "2026-01-01", "2026-01-01"),
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
    ).bind(
      presentationId,
      userId,
      '{"title":"Demo","groups":[],"assets":[]}',
      "2026-01-01",
      "2026-01-01",
    ),
  ]);
  await env.DB.prepare(
    "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES (?, ?, ?, ?, 'Presenting', 1, 50, ?)",
  )
    .bind(sessionId, presentationId, userId, `hash-${sessionId}`, "2026-01-01")
    .run();
  await env.DB.prepare(
    "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at, host_generation) VALUES (?, 'runtime', 'Cloud', 'https://runtime.example.com', 1, 1, '2026-01-01', '2099-01-01', 1)",
  )
    .bind(sessionId)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO presentation_builds (presentation_id,build_id,target_revision,artifacts,created_at) VALUES (?, 'build', 1, '{}', '2026')",
    ).bind(presentationId),
    env.DB.prepare(
      "INSERT INTO presentation_publications (presentation_id,epoch,build_id,manifest,published_at) VALUES (?, 1, 'build', ?, '2026')",
    ).bind(
      presentationId,
      JSON.stringify({
        publicationManifestHash: `sha256:${"a".repeat(64)}`,
        definitionHash: `sha256:${"b".repeat(64)}`,
        renderBundleHash: `sha256:${"c".repeat(64)}`,
      }),
    ),
    env.DB.prepare("UPDATE presentation_sessions SET publication_epoch = 1 WHERE id = ?").bind(
      sessionId,
    ),
  ]);
  return sessionId;
};

describe("persistence callback HTTP boundary", () => {
  it("requires service identity and deduplicates writes", async () => {
    const sessionId = await seedSession();
    const app = createApp({ identityProvider: async () => undefined });
    const callback = (
      path: string,
      body: unknown,
      token = "test-service-identity-secret-32-characters",
    ) =>
      app.fetch(
        new Request(`https://api.example.com${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        runtimeEnvironment(),
      );
    const checkpoint = {
      sessionId,
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      assignmentEpoch: 1,
      presentationRevision: 1,
      version: 1,
      lastSequence: 5,
      idempotencyKey: "cp-1",
      payload: {
        ...(await checkpointEnvelope(sessionId)),
        publication: {
          presentationId: `presentation-${sessionId}`,
          publicationEpoch: "1",
          publicationManifestHash: `sha256:${"a".repeat(64)}`,
        },
      },
    };
    expect((await callback("/callbacks/checkpoints", checkpoint, "wrong-secret")).status).toBe(401);
    await expect((await callback("/callbacks/checkpoints", checkpoint)).json()).resolves.toEqual({
      applied: true,
    });
    await expect((await callback("/callbacks/checkpoints", checkpoint)).json()).resolves.toEqual({
      applied: false,
    });

    const storedCheckpoint = await env.DB.prepare(
      "SELECT payload FROM session_checkpoints WHERE session_id = ? AND version = 1",
    )
      .bind(sessionId)
      .first<{ payload: string }>();
    assert.isNotNull(storedCheckpoint);
    expect(JSON.parse(storedCheckpoint.payload)).toEqual(checkpoint.payload);
    const completion = {
      sessionId,
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      assignmentEpoch: 1,
      presentationRevision: 1,
      checkpointVersion: 1,
      lastSequence: 5,
      idempotencyKey: "done-1",
      startedAt: "2026-08-11T00:00:00.000Z",
      endedAt: "2026-08-11T00:01:00.000Z",
      participantCount: 1,
      participants: [{ userId: "presenter", role: "presenter" }],
      finalCheckpoint: { ...checkpoint.payload },
    };
    const staleRuntimeId = crypto.randomUUID();
    const staleResponse = await callback("/callbacks/completions", {
      ...completion,
      runtimeId: staleRuntimeId,
      finalCheckpoint: { ...completion.finalCheckpoint, runtimeId: staleRuntimeId },
      idempotencyKey: "stale-done",
    });
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({ error: { code: "conflict" } });
    await expect((await callback("/callbacks/completions", completion)).json()).resolves.toEqual({
      applied: true,
    });

    const storedCompletion = await env.DB.prepare(
      "SELECT final_state FROM session_completions WHERE session_id = ?",
    )
      .bind(sessionId)
      .first<{ final_state: string }>();
    assert.isNotNull(storedCompletion);
    expect(JSON.parse(storedCompletion.final_state)).toEqual(completion.finalCheckpoint);
    await expect(
      env.DB.prepare("SELECT state FROM presentation_sessions WHERE id = ?")
        .bind(sessionId)
        .first(),
    ).resolves.toMatchObject({ state: "Ended" });
  });

  it.each(["/callbacks/checkpoints", "/callbacks/completions"])(
    "rejects oversized checkpoint at %s",
    async (path) => {
      const response = await createApp().fetch(
        new Request(`https://api.example.com${path}`, {
          method: "POST",
          headers: {
            authorization: "Bearer test-service-identity-secret-32-characters",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sessionId: crypto.randomUUID(),
            runtimeId: "runtime",
            runtimeKind: "Cloud",
            assignmentEpoch: 1,
            presentationRevision: 1,
            version: 1,
            checkpointVersion: 1,
            lastSequence: 1,
            idempotencyKey: "oversized",
            startedAt: "2026-10-22T00:00:00Z",
            endedAt: "2026-10-22T00:01:00Z",
            participantCount: 1,
            participants: [{ userId: "presenter", role: "presenter" }],
            payload: "あ".repeat(524288),
            finalCheckpoint: "あ".repeat(524288),
          }),
        }),
        runtimeEnvironment(),
      );
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "checkpoint_payload_too_large" },
      });
    },
  );

  it("publishes only the public signing key", async () => {
    const response = await createApp().fetch(
      new Request("https://api.example.com/.well-known/jwks.json"),
      runtimeEnvironment(),
    );
    expect(response.status).toBe(200);
    const jwks = await response.json<{ keys: JsonWebKey[] }>();
    expect(jwks.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", kid: "test-realtime" });
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });
});
