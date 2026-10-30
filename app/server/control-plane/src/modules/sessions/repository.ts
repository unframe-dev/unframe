import type { D1Database } from "@cloudflare/workers-types";
import { publicationFenceSchema } from "@unframe/contracts/presentation";
import type { z } from "zod";
import {
  and,
  count,
  eq,
  exists,
  isNull,
  lt,
  ne,
  or,
  desc,
  sql,
  getTableColumns,
} from "drizzle-orm";

import { createD1Database } from "../../adapters/d1/database";
import {
  presentationPublications,
  presentationSessions,
  runtimeAssignments,
  sessionJoinAttempts,
  sessionParticipants,
} from "../../adapters/d1/schema";
import type { SessionRole, SessionState } from "./schema";

export type SessionRecord = {
  id: string;
  presentationId: string;
  presenterId: string;
  joinCodeHash: string;
  joinCode: string | null;
  state: SessionState;
  participantCount: number;
  maxParticipants: number;
  createdAt: string;
  endedAt: string | null;
  publicationEpoch: number | null;
  publicationFence: z.infer<typeof publicationFenceSchema> | null;
};

export type SessionCreateRecord = Omit<SessionRecord, "publicationEpoch" | "publicationFence">;

export type SessionParticipant = {
  sessionId: string;
  userId: string;
  role: SessionRole;
  joinedAt: string;
};

export type JoinResult = "joined" | "existing" | "full" | "ended" | "not_found";

export type SessionRepository = {
  create(record: SessionCreateRecord, presenter: SessionParticipant): Promise<SessionRecord | null>;
  findById(id: string): Promise<SessionRecord | null>;
  listByPresenter(
    userId: string,
    limit: number,
    cursor?: Pick<SessionRecord, "id" | "createdAt">,
  ): Promise<SessionRecord[]>;
  updateJoinCode(
    id: string,
    presenterId: string,
    code: string,
    hash: string,
    previousHash: string,
  ): Promise<boolean>;
  findActiveByCodeHash(joinCodeHash: string): Promise<SessionRecord | null>;
  participantFor(sessionId: string, userId: string): Promise<SessionParticipant | null>;
  join(
    sessionId: string,
    userId: string,
    joinedAt: string,
    expectedCodeHash?: string,
  ): Promise<JoinResult>;
  consumeJoinAttempt(input: {
    codeHash: string;
    userId: string;
    ipAddress: string;
    attemptedAt: number;
    windowStart: number;
  }): Promise<boolean>;
  start(id: string): Promise<SessionRecord | null>;
  end(id: string, endedAt: string): Promise<SessionRecord | null>;
};

export class D1SessionRepository implements SessionRepository {
  private readonly db;

  constructor(private readonly database: D1Database) {
    this.db = createD1Database(database);
  }

  async create(record: SessionCreateRecord, presenter: SessionParticipant) {
    const participant = this.db
      .insert(sessionParticipants)
      .select(
        this.db
          .select({
            sessionId: sql<string>`${presenter.sessionId}`.as("sessionId"),
            userId: sql<string>`${presenter.userId}`.as("userId"),
            role: sql<SessionRole>`${presenter.role}`.as("role"),
            joinedAt: sql<string>`${presenter.joinedAt}`.as("joinedAt"),
          })
          .from(presentationSessions)
          .where(eq(presentationSessions.id, record.id)),
      )
      .toSQL();
    const [inserted] = await this.database.batch([
      this.database
        .prepare(
          `INSERT OR IGNORE INTO presentation_sessions
         (id, presentation_id, presenter_id, join_code_hash, join_code, state, participant_count,
          max_participants, created_at, ended_at, publication_epoch)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                (SELECT MAX(epoch) FROM presentation_publications WHERE presentation_id = ?)
         WHERE EXISTS (SELECT 1 FROM presentation_publications WHERE presentation_id = ?)`,
        )
        .bind(
          record.id,
          record.presentationId,
          record.presenterId,
          record.joinCodeHash,
          record.joinCode,
          record.state,
          record.participantCount,
          record.maxParticipants,
          record.createdAt,
          record.endedAt,
          record.presentationId,
          record.presentationId,
        ),
      this.database.prepare(participant.sql).bind(...participant.params),
    ]);
    return inserted?.meta.changes === 1 ? this.findById(record.id) : null;
  }

  private selection() {
    return {
      ...getTableColumns(presentationSessions),
      publicationManifest: presentationPublications.manifest,
    };
  }

  async findById(id: string) {
    const row = await this.db
      .select(this.selection())
      .from(presentationSessions)
      .leftJoin(
        presentationPublications,
        and(
          eq(presentationPublications.presentationId, presentationSessions.presentationId),
          eq(presentationPublications.epoch, presentationSessions.publicationEpoch),
        ),
      )
      .where(eq(presentationSessions.id, id))
      .get();
    return row ? sessionRecord(row) : null;
  }

  async listByPresenter(
    userId: string,
    limit: number,
    cursor?: Pick<SessionRecord, "id" | "createdAt">,
  ) {
    const rows = await this.db
      .select(this.selection())
      .from(presentationSessions)
      .leftJoin(
        presentationPublications,
        and(
          eq(presentationPublications.presentationId, presentationSessions.presentationId),
          eq(presentationPublications.epoch, presentationSessions.publicationEpoch),
        ),
      )
      .where(
        and(
          eq(presentationSessions.presenterId, userId),
          cursor
            ? or(
                lt(presentationSessions.createdAt, cursor.createdAt),
                and(
                  eq(presentationSessions.createdAt, cursor.createdAt),
                  lt(presentationSessions.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(presentationSessions.createdAt), desc(presentationSessions.id))
      .limit(limit);
    return rows.map(sessionRecord);
  }

  async updateJoinCode(
    id: string,
    presenterId: string,
    code: string,
    hash: string,
    previousHash: string,
  ) {
    const result = await this.database
      .prepare(
        `UPDATE OR IGNORE presentation_sessions SET join_code = ?, join_code_hash = ? WHERE id = ? AND presenter_id = ? AND state != 'Ended' AND join_code_hash = ? AND join_code_hash != ?`,
      )
      .bind(code, hash, id, presenterId, previousHash, hash)
      .run();
    return result.meta.changes === 1;
  }

  async findActiveByCodeHash(joinCodeHash: string) {
    const row = await this.db
      .select(this.selection())
      .from(presentationSessions)
      .leftJoin(
        presentationPublications,
        and(
          eq(presentationPublications.presentationId, presentationSessions.presentationId),
          eq(presentationPublications.epoch, presentationSessions.publicationEpoch),
        ),
      )
      .where(
        and(
          eq(presentationSessions.joinCodeHash, joinCodeHash),
          ne(presentationSessions.state, "Ended"),
        ),
      )
      .get();
    return row ? sessionRecord(row) : null;
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

  async join(
    sessionId: string,
    userId: string,
    joinedAt: string,
    expectedCodeHash?: string,
  ): Promise<JoinResult> {
    const existing = await this.participantFor(sessionId, userId);
    if (existing) {
      const session = await this.findById(sessionId);
      if (
        !session ||
        session.state === "Ended" ||
        (expectedCodeHash && session.joinCodeHash !== expectedCodeHash)
      )
        return "not_found";
      return "existing";
    }
    const participants = this.db
      .select({ value: count() })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, sessionId));
    const participantCount = this.db
      .update(presentationSessions)
      .set({ participantCount: sql`(${participants})` })
      .where(eq(presentationSessions.id, sessionId))
      .toSQL();
    const [inserted] = await this.database.batch([
      this.database
        .prepare(
          `INSERT OR IGNORE INTO session_participants(session_id, user_id, role, joined_at)
           SELECT id, ?, 'viewer', ?
           FROM presentation_sessions
           WHERE id = ?
             AND state IN ('Waiting', 'Presenting')
             AND (? IS NULL OR join_code_hash = ?)
             AND (SELECT count(*) FROM session_participants WHERE session_id = ?) < max_participants`,
        )
        .bind(
          userId,
          joinedAt,
          sessionId,
          expectedCodeHash ?? null,
          expectedCodeHash ?? null,
          sessionId,
        ),
      this.database.prepare(participantCount.sql).bind(...participantCount.params),
    ]);
    if (inserted?.meta.changes === 1) return "joined";
    const session = await this.findById(sessionId);
    if (!session || (expectedCodeHash && session.joinCodeHash !== expectedCodeHash))
      return "not_found";
    if (session.state === "Ended") return "ended";
    return (await this.participantFor(sessionId, userId)) ? "existing" : "full";
  }

  async consumeJoinAttempt({
    codeHash,
    userId,
    ipAddress,
    attemptedAt,
    windowStart,
  }: Parameters<SessionRepository["consumeJoinAttempt"]>[0]) {
    const cleanup = this.db
      .delete(sessionJoinAttempts)
      .where(lt(sessionJoinAttempts.attemptedAt, windowStart))
      .toSQL();
    const [, result] = await this.database.batch([
      this.database.prepare(cleanup.sql).bind(...cleanup.params),
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
    const publication = this.db
      .select({ epoch: presentationPublications.epoch })
      .from(presentationPublications)
      .where(
        and(
          eq(presentationPublications.presentationId, presentationSessions.presentationId),
          eq(presentationPublications.epoch, presentationSessions.publicationEpoch),
        ),
      );
    const result = await this.db
      .update(presentationSessions)
      .set({ state: "Presenting" })
      .where(
        and(
          eq(presentationSessions.id, id),
          eq(presentationSessions.state, "Waiting"),
          exists(publication),
        ),
      )
      .run();
    return result.meta.changes === 1 ? this.findById(id) : null;
  }

  async end(id: string, endedAt: string) {
    await this.db.batch([
      this.db
        .update(presentationSessions)
        .set({ state: "Ended", endedAt })
        .where(and(eq(presentationSessions.id, id), ne(presentationSessions.state, "Ended"))),
      this.db
        .update(runtimeAssignments)
        .set({ releasedAt: endedAt })
        .where(and(eq(runtimeAssignments.sessionId, id), isNull(runtimeAssignments.releasedAt))),
    ]);
    return this.findById(id);
  }
}

const sessionRecord = ({
  publicationManifest,
  ...record
}: typeof presentationSessions.$inferSelect & {
  publicationManifest: string | null;
}): SessionRecord => {
  if (record.publicationEpoch === null) return { ...record, publicationFence: null };
  if (publicationManifest === null) throw new Error("Session publication is missing");
  const manifest: unknown = JSON.parse(publicationManifest);
  const publicationFence = publicationFenceSchema.strip().parse(manifest);
  if (
    publicationFence.presentationId !== record.presentationId ||
    publicationFence.publicationEpoch !== record.publicationEpoch
  )
    throw new Error("Session publication fence does not match its saved epoch");
  return { ...record, publicationFence };
};
