import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { D1PersistenceCallbackRepository } from "../../../src/modules/persistence-callback/repository";

const suffix = () => crypto.randomUUID();

const seedSession = async () => {
  const id = suffix();
  const userId = `user-${id}`;
  const presentationId = `presentation-${id}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(userId, "User", `${userId}@example.test`, "2026-01-01", "2026-01-01"),
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
    ).bind(
      presentationId,
      userId,
      JSON.stringify({ title: "Presentation", groups: [], assets: [] }),
      "2026-01-01",
      "2026-01-01",
    ),
  ]);
  await env.DB.prepare(
    "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES (?, ?, ?, ?, 'Presenting', 1, 50, ?)",
  )
    .bind(id, presentationId, userId, `hash-${id}`, "2026-01-01")
    .run();
  return id;
};

const seedAssignment = async (sessionId: string) => {
  const edgeId = `edge-${sessionId}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO venue_edges (id, status, last_seen_at, created_at) VALUES (?, 'active', ?, ?)",
    ).bind(edgeId, "2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO session_edge_assignments (session_id, edge_id, assignment_epoch, presentation_revision, issued_at, lease_expires_at, released_at) VALUES (?, ?, 1, 1, ?, ?, NULL)",
    ).bind(sessionId, edgeId, "2026-08-11T00:00:00.000Z", "2026-08-11T01:00:00.000Z"),
  ]);
};

describe("D1PersistenceCallbackRepository", () => {
  let repository: D1PersistenceCallbackRepository;

  beforeEach(() => {
    repository = new D1PersistenceCallbackRepository(env.DB, () => "2026-08-11T00:00:00.000Z");
  });

  it("deduplicates checkpoints by session version and idempotency key", async () => {
    const sessionId = await seedSession();
    const checkpoint = {
      sessionId,
      version: 1,
      lastSequence: 12,
      idempotencyKey: "checkpoint-1",
      payload: { slide: 2 },
    };
    await expect(repository.applyCheckpoint(checkpoint)).resolves.toBe("applied");
    await expect(repository.applyCheckpoint(checkpoint)).resolves.toBe("duplicate");
    await expect(
      repository.applyCheckpoint({ ...checkpoint, idempotencyKey: "different-key" }),
    ).resolves.toBe("duplicate");
  });

  it("stores completion once and ends the session", async () => {
    const sessionId = await seedSession();
    await seedAssignment(sessionId);
    const completion = {
      sessionId,
      checkpointVersion: 1,
      lastSequence: 12,
      idempotencyKey: "completion-1",
      startedAt: "2026-08-11T00:00:00.000Z",
      endedAt: "2026-08-11T00:01:00.000Z",
      participantCount: 1,
      participants: [{ userId: "presenter", role: "presenter" as const }],
      finalCheckpoint: { slide: 2 },
    };
    await expect(repository.applyCompletion(completion)).resolves.toBe("applied");
    await expect(repository.applyCompletion(completion)).resolves.toBe("duplicate");
    await expect(
      env.DB.prepare("SELECT state, ended_at FROM presentation_sessions WHERE id = ?")
        .bind(sessionId)
        .first(),
    ).resolves.toMatchObject({ state: "Ended", ended_at: completion.endedAt });
    await expect(
      env.DB.prepare(
        "SELECT released_at FROM session_edge_assignments WHERE session_id = ? AND assignment_epoch = 1",
      )
        .bind(sessionId)
        .first(),
    ).resolves.toMatchObject({ released_at: completion.endedAt });
  });

  it("distinguishes an unknown session from a duplicate", async () => {
    await expect(
      repository.applyCheckpoint({
        sessionId: crypto.randomUUID(),
        version: 1,
        lastSequence: 1,
        idempotencyKey: "unknown",
        payload: {},
      }),
    ).resolves.toBe("not_found");
  });
});
