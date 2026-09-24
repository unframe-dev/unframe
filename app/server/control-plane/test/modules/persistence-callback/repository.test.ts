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
  await env.DB.prepare(
    "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at) VALUES (?, 'runtime', 'Cloud', 'https://runtime.example.com', 1, 1, '2026-01-01', '2099-01-01')",
  )
    .bind(id)
    .run();
  return id;
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
      runtimeId: "runtime",
      runtimeKind: "Cloud" as const,
      assignmentEpoch: 1,
      presentationRevision: 1,
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
    const completion = {
      sessionId,
      runtimeId: "runtime",
      runtimeKind: "Cloud" as const,
      assignmentEpoch: 1,
      presentationRevision: 1,
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
      env.DB.prepare(
        "SELECT session.state, session.ended_at, assignment.released_at FROM presentation_sessions AS session JOIN runtime_assignments AS assignment ON assignment.session_id = session.id WHERE session.id = ?",
      )
        .bind(sessionId)
        .first(),
    ).resolves.toMatchObject({
      state: "Ended",
      ended_at: completion.endedAt,
      released_at: "2026-08-11T00:00:00.000Z",
    });
    await expect(
      repository.applyCheckpoint({
        sessionId,
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        assignmentEpoch: 1,
        presentationRevision: 1,
        version: 2,
        lastSequence: 13,
        idempotencyKey: "checkpoint-after-completion",
        payload: { slide: 3 },
      }),
    ).resolves.toBe("conflict");
  });

  it("rejects callbacks that do not match an active assignment", async () => {
    const sessionId = await seedSession();
    const checkpoint = {
      sessionId,
      runtimeId: "wrong-runtime",
      runtimeKind: "Cloud" as const,
      assignmentEpoch: 1,
      presentationRevision: 1,
      version: 1,
      lastSequence: 12,
      idempotencyKey: "wrong-runtime",
      payload: { slide: 2 },
    };

    await expect(repository.applyCheckpoint(checkpoint)).resolves.toBe("conflict");
    await expect(
      repository.applyCompletion({
        sessionId,
        runtimeId: "wrong-runtime",
        runtimeKind: "Cloud",
        assignmentEpoch: 1,
        presentationRevision: 1,
        checkpointVersion: 1,
        lastSequence: 12,
        idempotencyKey: "wrong-runtime-completion",
        startedAt: "2026-08-11T00:00:00.000Z",
        endedAt: "2026-08-11T00:01:00.000Z",
        participantCount: 1,
        participants: [{ userId: "presenter", role: "presenter" }],
        finalCheckpoint: { slide: 2 },
      }),
    ).resolves.toBe("conflict");
    await expect(
      env.DB.prepare(
        "SELECT session.state, assignment.released_at FROM presentation_sessions AS session JOIN runtime_assignments AS assignment ON assignment.session_id = session.id WHERE session.id = ?",
      )
        .bind(sessionId)
        .first(),
    ).resolves.toMatchObject({ state: "Presenting", released_at: null });
    await env.DB.prepare(
      "UPDATE runtime_assignments SET released_at = '2026-08-10T00:00:00.000Z' WHERE session_id = ?",
    )
      .bind(sessionId)
      .run();
    await expect(repository.applyCheckpoint({ ...checkpoint, runtimeId: "runtime" })).resolves.toBe(
      "conflict",
    );
  });

  it("rejects completion from a superseded assignment epoch", async () => {
    const sessionId = await seedSession();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE runtime_assignments SET released_at = ? WHERE session_id = ? AND epoch = 1",
      ).bind("2026-08-11T00:10:00.000Z", sessionId),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at) VALUES (?, 'runtime-next', 'Cloud', 'https://runtime-next.example.com', 2, 1, ?, ?)",
      ).bind(sessionId, "2026-08-11T00:10:00.000Z", "2026-08-11T01:00:00.000Z"),
    ]);

    await expect(
      repository.applyCompletion({
        sessionId,
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        assignmentEpoch: 1,
        presentationRevision: 1,
        checkpointVersion: 1,
        lastSequence: 12,
        idempotencyKey: "stale-completion",
        startedAt: "2026-08-11T00:00:00.000Z",
        endedAt: "2026-08-11T00:11:00.000Z",
        participantCount: 1,
        participants: [{ userId: "presenter", role: "presenter" }],
        finalCheckpoint: { slide: 2 },
      }),
    ).resolves.toBe("conflict");
    await expect(
      env.DB.prepare("SELECT state FROM presentation_sessions WHERE id = ?")
        .bind(sessionId)
        .first(),
    ).resolves.toMatchObject({ state: "Presenting" });
    await expect(
      env.DB.prepare(
        "SELECT released_at FROM runtime_assignments WHERE session_id = ? AND epoch = 2",
      )
        .bind(sessionId)
        .first(),
    ).resolves.toMatchObject({ released_at: null });
  });

  it("distinguishes an unknown session from a duplicate", async () => {
    await expect(
      repository.applyCheckpoint({
        sessionId: crypto.randomUUID(),
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        assignmentEpoch: 1,
        presentationRevision: 1,
        version: 1,
        lastSequence: 1,
        idempotencyKey: "unknown",
        payload: {},
      }),
    ).resolves.toBe("not_found");
  });
});
