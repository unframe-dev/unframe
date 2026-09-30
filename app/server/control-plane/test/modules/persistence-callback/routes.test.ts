import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";

const seedSession = async () => {
  const sessionId = crypto.randomUUID();
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
    "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at) VALUES (?, 'runtime', 'Cloud', 'https://runtime.example.com', 1, 1, '2026-01-01', '2099-01-01')",
  )
    .bind(sessionId)
    .run();
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
          body: JSON.stringify(body),
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          method: "POST",
        }),
        runtimeEnvironment(),
      );
    const checkpoint = {
      assignmentEpoch: 1,
      idempotencyKey: "cp-1",
      lastSequence: 5,
      payload: { step: 2 },
      presentationRevision: 1,
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      sessionId,
      version: 1,
    };
    expect((await callback("/callbacks/checkpoints", checkpoint, "wrong-secret")).status).toBe(401);
    await expect((await callback("/callbacks/checkpoints", checkpoint)).json()).resolves.toEqual({
      applied: true,
    });
    await expect((await callback("/callbacks/checkpoints", checkpoint)).json()).resolves.toEqual({
      applied: false,
    });
    const completion = {
      assignmentEpoch: 1,
      checkpointVersion: 1,
      endedAt: "2026-08-11T00:01:00.000Z",
      finalCheckpoint: { step: 2 },
      idempotencyKey: "done-1",
      lastSequence: 5,
      participantCount: 1,
      participants: [{ role: "presenter", userId: "presenter" }],
      presentationRevision: 1,
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      sessionId,
      startedAt: "2026-08-11T00:00:00.000Z",
    };
    const staleResponse = await callback("/callbacks/completions", {
      ...completion,
      idempotencyKey: "stale-done",
      runtimeId: crypto.randomUUID(),
    });
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({ error: { code: "conflict" } });
    await expect((await callback("/callbacks/completions", completion)).json()).resolves.toEqual({
      applied: true,
    });
    await expect(
      env.DB.prepare("SELECT state FROM presentation_sessions WHERE id = ?")
        .bind(sessionId)
        .first(),
    ).resolves.toMatchObject({ state: "Ended" });
  });

  it("publishes only the public signing key", async () => {
    const response = await createApp().fetch(
      new Request("https://api.example.com/.well-known/jwks.json"),
      runtimeEnvironment(),
    );
    expect(response.status).toBe(200);
    const jwks = await response.json<{ keys: Array<JsonWebKey> }>();
    expect(jwks.keys[0]).toMatchObject({ crv: "Ed25519", kid: "test-realtime", kty: "OKP" });
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });
});
