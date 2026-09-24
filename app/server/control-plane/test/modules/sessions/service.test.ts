import { describe, expect, it } from "vitest";

import type {
  PresentationRecord,
  PresentationRepository,
} from "../../../src/presentation/repository";
import type {
  JoinResult,
  SessionParticipant,
  SessionRecord,
  SessionRepository,
} from "../../../src/modules/sessions/repository";
import { SessionError, SessionService } from "../../../src/modules/sessions/service";

const owner = { userId: "owner", globalRole: "user" } as const;
const admin = { userId: "admin", globalRole: "admin" } as const;

class FakePresentations implements Pick<PresentationRepository, "findById" | "roleFor"> {
  async findById(id: string) {
    return id === "presentation" ? ({ id } as PresentationRecord) : null;
  }

  async roleFor(id: string, userId: string) {
    return id === "presentation" && userId === "owner" ? ("owner" as const) : null;
  }
}

class FakeSessions implements SessionRepository {
  records = new Map<string, SessionRecord>();
  participants = new Map<string, SessionParticipant>();
  attempts: Array<{ codeHash: string; userId: string; ipAddress: string; attemptedAt: number }> =
    [];

  async create(record: SessionRecord, presenter: SessionParticipant) {
    this.records.set(record.id, record);
    this.participants.set(`${presenter.sessionId}:${presenter.userId}`, presenter);
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async findActiveByCodeHash(hash: string) {
    return (
      [...this.records.values()].find(
        (record) => record.joinCodeHash === hash && record.state !== "Ended",
      ) ?? null
    );
  }
  async participantFor(sessionId: string, userId: string) {
    return this.participants.get(`${sessionId}:${userId}`) ?? null;
  }
  async join(sessionId: string, userId: string, joinedAt: string): Promise<JoinResult> {
    const session = this.records.get(sessionId);
    if (!session) return "not_found";
    if (session.state === "Ended") return "ended";
    if (await this.participantFor(sessionId, userId)) return "existing";
    if (session.participantCount === session.maxParticipants) return "full";
    this.participants.set(`${sessionId}:${userId}`, {
      sessionId,
      userId,
      role: "viewer",
      joinedAt,
    });
    session.participantCount += 1;
    return "joined";
  }
  async consumeJoinAttempt(input: {
    codeHash: string;
    userId: string;
    ipAddress: string;
    attemptedAt: number;
    windowStart: number;
  }) {
    const count = this.attempts.filter(
      (attempt) =>
        attempt.attemptedAt >= input.windowStart &&
        (attempt.codeHash === input.codeHash ||
          attempt.userId === input.userId ||
          attempt.ipAddress === input.ipAddress),
    ).length;
    if (count >= 10) return false;
    this.attempts.push(input);
    return true;
  }
  async start(id: string) {
    const session = this.records.get(id);
    if (!session || session.state !== "Waiting") return null;
    session.state = "Presenting";
    return session;
  }
  async end(id: string, endedAt: string) {
    const session = this.records.get(id);
    if (!session) return null;
    session.state = "Ended";
    session.endedAt = endedAt;
    return session;
  }
}

const setup = () => {
  const sessions = new FakeSessions();
  let next = 0;
  const service = new SessionService(
    sessions,
    new FakePresentations() as PresentationRepository,
    () => new Date("2026-08-11T00:00:00.000Z"),
    () => `session-${++next}`,
    () => "ABCD-EFGH",
    async (code) => `hash:${code}`,
  );
  return { service, sessions };
};

describe("SessionService", () => {
  it("creates a Waiting session with its creator as the fixed presenter", async () => {
    const { service, sessions } = setup();
    await expect(service.create(owner, "presentation")).resolves.toMatchObject({
      joinCode: "ABCD-EFGH",
      session: { state: "Waiting", presenterId: "owner", participantCount: 1 },
    });
    await expect(sessions.participantFor("session-1", "owner")).resolves.toMatchObject({
      role: "presenter",
    });
  });

  it("allows only an administrator or a presentation member to create", async () => {
    const { service } = setup();
    await expect(
      service.create({ userId: "other", globalRole: "user" }, "presentation"),
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<SessionError>);
    await expect(service.create(admin, "presentation")).resolves.toMatchObject({
      session: { presenterId: "admin" },
    });
  });

  it("requires participation to get a session except for administrators", async () => {
    const { service } = setup();
    const created = await service.create(owner, "presentation");
    await expect(
      service.get({ userId: "viewer", globalRole: "user" }, created.session.id),
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<SessionError>);
    await expect(service.get(admin, created.session.id)).resolves.toMatchObject({
      id: created.session.id,
    });
  });

  it("rejects persisted sessions whose capacity violates the public contract", async () => {
    const { service, sessions } = setup();
    const created = await service.create(owner, "presentation");
    sessions.records.get(created.session.id)!.maxParticipants = 49;

    await expect(service.get(admin, created.session.id)).rejects.toThrowError(
      "session maxParticipants must be 50",
    );
  });

  it("joins idempotently, never exposes the code hash, and rejects ended sessions", async () => {
    const { service } = setup();
    const created = await service.create(owner, "presentation");
    expect(created.session).not.toHaveProperty("joinCodeHash");
    await expect(
      service.join({ userId: "viewer", globalRole: "user" }, created.joinCode, "127.0.0.1"),
    ).resolves.toEqual(expect.objectContaining({ participantCount: 2 }));
    await expect(
      service.join({ userId: "viewer", globalRole: "user" }, created.joinCode, "127.0.0.1"),
    ).resolves.toEqual(expect.objectContaining({ participantCount: 2 }));
    await service.end(owner, created.session.id);
    await expect(
      service.join({ userId: "other", globalRole: "user" }, created.joinCode, "127.0.0.2"),
    ).rejects.toMatchObject({
      code: "not_found",
    } satisfies Partial<SessionError>);
  });

  it("allows only the presenter or an administrator to transition Waiting to Presenting and end", async () => {
    const { service } = setup();
    const created = await service.create(owner, "presentation");
    await expect(
      service.start({ userId: "viewer", globalRole: "user" }, created.session.id),
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<SessionError>);
    await expect(service.start(owner, created.session.id)).resolves.toMatchObject({
      state: "Presenting",
    });
    await expect(service.start(owner, created.session.id)).rejects.toMatchObject({
      code: "conflict",
    } satisfies Partial<SessionError>);
    await expect(service.end(admin, created.session.id)).resolves.toMatchObject({ state: "Ended" });
  });

  it("enforces the code, user, and IP attempt windows independently", async () => {
    const { service } = setup();
    const created = await service.create(owner, "presentation");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await service.join(
        { userId: `viewer-${attempt}`, globalRole: "user" },
        created.joinCode,
        `10.0.0.${attempt}`,
      );
    }
    await expect(
      service.join({ userId: "viewer-11", globalRole: "user" }, created.joinCode, "10.0.0.11"),
    ).rejects.toMatchObject({
      code: "rate_limited",
    } satisfies Partial<SessionError>);
  });
});
