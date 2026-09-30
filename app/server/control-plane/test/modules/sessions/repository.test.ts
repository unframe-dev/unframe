import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { D1SessionRepository } from "../../../src/modules/sessions/repository";

const addUser = async (id: string) => {
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, "User", `${id}@example.test`, 1, "2026-01-01", "2026-01-01")
    .run();
};

const addPresentation = async (id: string, ownerId: string) => {
  await env.DB.prepare(
    "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, ownerId, 1, '{"groups":[],"assets":[]}', "2026-01-01", "2026-01-01")
    .run();
};

describe("D1SessionRepository", () => {
  it("persists only a join-code hash and its presenter participant", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const presentationId = `presentation-${suffix}`;
    await addUser(ownerId);
    await addPresentation(presentationId, ownerId);
    const repository = new D1SessionRepository(env.DB);
    await repository.create(
      {
        createdAt: "2026-01-01",
        endedAt: null,
        id: `session-${suffix}`,
        joinCodeHash: `hash-${suffix}`,
        maxParticipants: 50,
        participantCount: 1,
        presentationId,
        presenterId: ownerId,
        state: "Waiting",
      },
      {
        joinedAt: "2026-01-01",
        role: "presenter",
        sessionId: `session-${suffix}`,
        userId: ownerId,
      },
    );
    await expect(repository.findActiveByCodeHash(`hash-${suffix}`)).resolves.toMatchObject({
      presenterId: ownerId,
      state: "Waiting",
    });
    await expect(repository.participantFor(`session-${suffix}`, ownerId)).resolves.toMatchObject({
      role: "presenter",
    });
  });

  it("keeps concurrent joins at the configured maximum and treats repeat joins as idempotent", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const presentationId = `presentation-${suffix}`;
    const sessionId = `session-${suffix}`;
    await addUser(ownerId);
    await addPresentation(presentationId, ownerId);
    const repository = new D1SessionRepository(env.DB);
    await repository.create(
      {
        createdAt: "2026-01-01",
        endedAt: null,
        id: sessionId,
        joinCodeHash: `hash-${suffix}`,
        maxParticipants: 50,
        participantCount: 1,
        presentationId,
        presenterId: ownerId,
        state: "Waiting",
      },
      { joinedAt: "2026-01-01", role: "presenter", sessionId, userId: ownerId },
    );
    await env.DB.batch([
      env.DB.prepare(
        `WITH RECURSIVE numbers(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM numbers WHERE value < 48)
           INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
           SELECT 'seed-' || value || ?, 'Viewer', 'seed-' || value || ? || '@example.test', 1, '2026-01-01', '2026-01-01' FROM numbers`,
      ).bind(suffix, suffix),
      env.DB.prepare(
        `WITH RECURSIVE numbers(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM numbers WHERE value < 48)
           INSERT INTO session_participants (session_id, user_id, role, joined_at)
           SELECT ?, 'seed-' || value || ?, 'viewer', '2026-01-01' FROM numbers`,
      ).bind(sessionId, suffix),
      env.DB.prepare("UPDATE presentation_sessions SET participant_count = 49 WHERE id = ?").bind(
        sessionId,
      ),
    ]);
    const userIds = [`viewer-a-${suffix}`, `viewer-b-${suffix}`];
    await Promise.all(userIds.map(addUser));
    const results = await Promise.all(
      userIds.map((userId) => repository.join(sessionId, userId, "2026-01-01")),
    );
    expect(results.filter((result) => result === "joined")).toHaveLength(1);
    expect(results.filter((result) => result === "full")).toHaveLength(1);
    const joinedUser = userIds[results.findIndex((result) => result === "joined")]!;
    await expect(repository.join(sessionId, joinedUser, "2026-01-01")).resolves.toBe("existing");
    await expect(repository.findById(sessionId)).resolves.toMatchObject({ participantCount: 50 });
  });

  it("makes a code unusable after ending and atomically limits code, user, and IP attempts", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const presentationId = `presentation-${suffix}`;
    const sessionId = `session-${suffix}`;
    await addUser(ownerId);
    await addPresentation(presentationId, ownerId);
    const repository = new D1SessionRepository(env.DB);
    await repository.create(
      {
        createdAt: "2026-01-01",
        endedAt: null,
        id: sessionId,
        joinCodeHash: `hash-${suffix}`,
        maxParticipants: 50,
        participantCount: 1,
        presentationId,
        presenterId: ownerId,
        state: "Waiting",
      },
      { joinedAt: "2026-01-01", role: "presenter", sessionId, userId: ownerId },
    );
    for (const limitedBy of ["code", "user", "ip"] as const) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await expect(
          repository.consumeJoinAttempt({
            attemptedAt: 1000,
            codeHash:
              limitedBy === "code" ? `hash-${limitedBy}-${suffix}` : `hash-${attempt}-${suffix}`,
            ipAddress: limitedBy === "ip" ? `192.0.2.${limitedBy}` : `192.0.2.${attempt}`,
            userId:
              limitedBy === "user" ? `user-${limitedBy}-${suffix}` : `user-${attempt}-${suffix}`,
            windowStart: 0,
          }),
        ).resolves.toBe(true);
      }
      await expect(
        repository.consumeJoinAttempt({
          attemptedAt: 1000,
          codeHash:
            limitedBy === "code"
              ? `hash-${limitedBy}-${suffix}`
              : `other-hash-${limitedBy}-${suffix}`,
          ipAddress: limitedBy === "ip" ? `192.0.2.${limitedBy}` : `192.0.2.254`,
          userId:
            limitedBy === "user"
              ? `user-${limitedBy}-${suffix}`
              : `other-user-${limitedBy}-${suffix}`,
          windowStart: 0,
        }),
      ).resolves.toBe(false);
    }
    await repository.end(sessionId, "2026-01-02");
    await expect(repository.findActiveByCodeHash(`hash-${suffix}`)).resolves.toBeNull();
  });
});
