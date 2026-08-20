import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";

const seedSession = async () => {
  const sessionId = crypto.randomUUID();
  const edgeId = crypto.randomUUID();
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
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO venue_edges (id, status, last_seen_at, created_at) VALUES (?, 'active', ?, ?)",
    ).bind(edgeId, "2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO session_edge_assignments (session_id, edge_id, assignment_epoch, presentation_revision, issued_at, lease_expires_at, released_at) VALUES (?, ?, 1, 1, ?, ?, NULL)",
    ).bind(sessionId, edgeId, "2026-08-11T00:00:00.000Z", "2099-08-11T01:00:00.000Z"),
  ]);
  return { sessionId, edgeId };
};

describe("persistence callback HTTP boundary", () => {
  it("requires service identity and deduplicates writes", async () => {
    const { sessionId, edgeId } = await seedSession();
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
      version: 1,
      lastSequence: 5,
      idempotencyKey: "cp-1",
      payload: { step: 2 },
    };
    expect((await callback("/callbacks/checkpoints", checkpoint, "wrong-secret")).status).toBe(401);
    await expect((await callback("/callbacks/checkpoints", checkpoint)).json()).resolves.toEqual({
      applied: true,
    });
    await expect((await callback("/callbacks/checkpoints", checkpoint)).json()).resolves.toEqual({
      applied: false,
    });
    const completion = {
      sessionId,
      edgeId,
      assignmentEpoch: 1,
      checkpointVersion: 1,
      lastSequence: 5,
      idempotencyKey: "done-1",
      startedAt: "2026-08-11T00:00:00.000Z",
      endedAt: "2026-08-11T00:01:00.000Z",
      participantCount: 1,
      participants: [{ userId: "presenter", role: "presenter" }],
      finalCheckpoint: { step: 2 },
    };
    const staleResponse = await callback("/callbacks/completions", {
      ...completion,
      edgeId: crypto.randomUUID(),
      idempotencyKey: "stale-done",
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
    const jwks = await response.json<{ keys: JsonWebKey[] }>();
    expect(jwks.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", kid: "test-realtime" });
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });
});
