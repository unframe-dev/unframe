import { and, eq, ne } from "drizzle-orm";

import { createD1Database } from "../../adapters/d1/database";
import { presentationSessions, sessionParticipants } from "../../adapters/d1/schema";
import type { SessionRole, SessionState } from "./schema";

export type SessionRecord = {
  createdAt: string;
  endedAt: string | null;
  id: string;
  joinCodeHash: string;
  maxParticipants: number;
  participantCount: number;
  presentationId: string;
  presenterId: string;
  state: SessionState;
};

export type SessionParticipant = {
  joinedAt: string;
  role: SessionRole;
  sessionId: string;
  userId: string;
};

export type JoinResult = "joined" | "existing" | "full" | "ended" | "not_found";

export type SessionRepository = {
  consumeJoinAttempt(input: {
    attemptedAt: number;
    codeHash: string;
    ipAddress: string;
    userId: string;
    windowStart: number;
  }): Promise<boolean>;
  create(record: SessionRecord, presenter: SessionParticipant): Promise<void>;
  end(id: string, endedAt: string): Promise<SessionRecord | null>;
  findActiveByCodeHash(joinCodeHash: string): Promise<SessionRecord | null>;
  findById(id: string): Promise<SessionRecord | null>;
  join(sessionId: string, userId: string, joinedAt: string): Promise<JoinResult>;
  participantFor(sessionId: string, userId: string): Promise<SessionParticipant | null>;
  start(id: string): Promise<SessionRecord | null>;
};

export class D1SessionRepository implements SessionRepository {
  private readonly db;

  constructor(private readonly database: D1Database) {
    this.db = createD1Database(database);
  }

  async create(record: SessionRecord, presenter: SessionParticipant) {
    await this.db.batch([
      this.db.insert(presentationSessions).values(record),
      this.db.insert(sessionParticipants).values(presenter),
    ]);
  }

  async findById(id: string) {
    return (
      (await this.db
        .select()
        .from(presentationSessions)
        .where(eq(presentationSessions.id, id))
        .get()) ?? null
    );
  }

  async findActiveByCodeHash(joinCodeHash: string) {
    return (
      (await this.db
        .select()
        .from(presentationSessions)
        .where(
          and(
            eq(presentationSessions.joinCodeHash, joinCodeHash),
            ne(presentationSessions.state, "Ended"),
          ),
        )
        .get()) ?? null
    );
  }

  async participantFor(sessionId: string, userId: string) {
    return (
      (await this.db
        .select()
        .from(sessionParticipants)
        .where(
          and(eq(sessionParticipants.sessionId, sessionId), eq(sessionParticipants.userId, userId)),
        )
        .get()) ?? null
    );
  }

  async join(sessionId: string, userId: string, joinedAt: string): Promise<JoinResult> {
    const existing = await this.participantFor(sessionId, userId);
    if (existing) {
      return "existing";
    }
    const [inserted] = await this.database.batch([
      this.database
        .prepare(
          `INSERT OR IGNORE INTO session_participants(session_id, user_id, role, joined_at)
           SELECT id, ?, 'viewer', ?
           FROM presentation_sessions
           WHERE id = ?
             AND state IN ('Waiting', 'Presenting')
             AND (SELECT count(*) FROM session_participants WHERE session_id = ?) < max_participants`,
        )
        .bind(userId, joinedAt, sessionId, sessionId),
      this.database
        .prepare(
          `UPDATE presentation_sessions
           SET participant_count = (SELECT count(*) FROM session_participants WHERE session_id = ?)
           WHERE id = ?`,
        )
        .bind(sessionId, sessionId),
    ]);
    if (inserted?.meta.changes === 1) {
      return "joined";
    }
    const session = await this.findById(sessionId);
    if (!session) {
      return "not_found";
    }
    if (session.state === "Ended") {
      return "ended";
    }
    return (await this.participantFor(sessionId, userId)) ? "existing" : "full";
  }

  async consumeJoinAttempt({
    attemptedAt,
    codeHash,
    ipAddress,
    userId,
    windowStart,
  }: Parameters<SessionRepository["consumeJoinAttempt"]>[0]) {
    const [, result] = await this.database.batch([
      this.database
        .prepare("DELETE FROM session_join_attempts WHERE attempted_at < ?")
        .bind(windowStart),
      this.database
        .prepare(
          `INSERT INTO session_join_attempts(code_hash, user_id, ip_address, attempted_at)
         SELECT ?, ?, ?, ?
         WHERE (SELECT count(*) FROM session_join_attempts WHERE code_hash = ? AND attempted_at >= ?) < 10
           AND (SELECT count(*) FROM session_join_attempts WHERE user_id = ? AND attempted_at >= ?) < 10
           AND (SELECT count(*) FROM session_join_attempts WHERE ip_address = ? AND attempted_at >= ?) < 10`,
        )
        .bind(
          codeHash,
          userId,
          ipAddress,
          attemptedAt,
          codeHash,
          windowStart,
          userId,
          windowStart,
          ipAddress,
          windowStart,
        ),
    ]);
    return result?.meta.changes === 1;
  }

  async start(id: string) {
    const result = await this.database
      .prepare(
        "UPDATE presentation_sessions SET state = 'Presenting' WHERE id = ? AND state = 'Waiting'",
      )
      .bind(id)
      .run();
    return result.meta.changes === 1 ? this.findById(id) : null;
  }

  async end(id: string, endedAt: string) {
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE presentation_sessions SET state = 'Ended', ended_at = ? WHERE id = ? AND state != 'Ended'",
        )
        .bind(endedAt, id),
      this.database
        .prepare(
          "UPDATE runtime_assignments SET released_at = ? WHERE session_id = ? AND released_at IS NULL",
        )
        .bind(endedAt, id),
    ]);
    return this.findById(id);
  }
}
