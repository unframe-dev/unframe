import { and, eq, or } from "drizzle-orm";

import { createD1Database } from "../../adapters/d1/database";
import { presentationSessions } from "../../adapters/d1/schema";
import { sessionCheckpoints, sessionCompletions } from "../../adapters/d1/persistence-schema";
import type { CompletionInput, CheckpointInput } from "./schema";
import type { PersistenceCallbackRepository, PersistenceResult } from "./service";

export class D1PersistenceCallbackRepository implements PersistenceCallbackRepository {
  private readonly db;

  constructor(
    private readonly database: D1Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.db = createD1Database(database);
  }

  async applyCheckpoint(input: CheckpointInput): Promise<PersistenceResult> {
    const receivedAt = this.now();
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO session_checkpoints
           (session_id, version, last_sequence, idempotency_key, payload, received_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM runtime_assignments AS assignment
           JOIN presentation_sessions AS session ON session.id = assignment.session_id
           WHERE assignment.session_id = ?
             AND assignment.runtime_id = ?
             AND assignment.runtime_kind = ?
             AND assignment.epoch = ?
             AND assignment.revision = ?
             AND assignment.released_at IS NULL
             AND assignment.lease_expires_at > ?
             AND session.state != 'Ended'
         )`,
      )
      .bind(
        input.sessionId,
        input.version,
        input.lastSequence,
        input.idempotencyKey,
        JSON.stringify(input.payload),
        receivedAt,
        input.sessionId,
        input.runtimeId,
        input.runtimeKind,
        input.assignmentEpoch,
        input.presentationRevision,
        receivedAt,
      )
      .run();
    if (result.meta.changes === 1) return "applied";
    return this.checkpointFailure(input);
  }

  async applyCompletion(input: CompletionInput): Promise<PersistenceResult> {
    const receivedAt = this.now();
    const [inserted] = await this.database.batch([
      this.database
        .prepare(
          `INSERT OR IGNORE INTO session_completions
             (session_id, checkpoint_version, last_sequence, idempotency_key, started_at,
              ended_at, participant_count, participants, final_state, received_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1
             FROM runtime_assignments AS assignment
             JOIN presentation_sessions AS session ON session.id = assignment.session_id
             WHERE assignment.session_id = ?
               AND assignment.runtime_id = ?
               AND assignment.runtime_kind = ?
               AND assignment.epoch = ?
               AND assignment.revision = ?
               AND assignment.released_at IS NULL
               AND assignment.lease_expires_at > ?
               AND session.state != 'Ended'
           )`,
        )
        .bind(
          input.sessionId,
          input.checkpointVersion,
          input.lastSequence,
          input.idempotencyKey,
          input.startedAt,
          input.endedAt,
          input.participantCount,
          JSON.stringify(input.participants),
          JSON.stringify(input.finalCheckpoint),
          receivedAt,
          input.sessionId,
          input.runtimeId,
          input.runtimeKind,
          input.assignmentEpoch,
          input.presentationRevision,
          receivedAt,
        ),
      this.database
        .prepare(
          "UPDATE presentation_sessions SET state = 'Ended', ended_at = ? WHERE id = ? AND state != 'Ended' AND EXISTS (SELECT 1 FROM session_completions WHERE session_id = ? AND idempotency_key = ?)",
        )
        .bind(input.endedAt, input.sessionId, input.sessionId, input.idempotencyKey),
      this.database
        .prepare(
          "UPDATE runtime_assignments SET released_at = ? WHERE session_id = ? AND runtime_id = ? AND runtime_kind = ? AND epoch = ? AND revision = ? AND released_at IS NULL AND lease_expires_at > ? AND EXISTS (SELECT 1 FROM session_completions WHERE session_id = ? AND idempotency_key = ?)",
        )
        .bind(
          receivedAt,
          input.sessionId,
          input.runtimeId,
          input.runtimeKind,
          input.assignmentEpoch,
          input.presentationRevision,
          receivedAt,
          input.sessionId,
          input.idempotencyKey,
        ),
    ]);
    if (inserted?.meta.changes === 1) return "applied";
    return this.completionFailure(input);
  }

  private async sessionExists(sessionId: string) {
    return Boolean(
      await this.db
        .select({ id: presentationSessions.id })
        .from(presentationSessions)
        .where(eq(presentationSessions.id, sessionId))
        .get(),
    );
  }
  private async checkpointFailure(input: CheckpointInput): Promise<PersistenceResult> {
    if (
      await this.db
        .select({ sessionId: sessionCheckpoints.sessionId })
        .from(sessionCheckpoints)
        .where(
          and(
            eq(sessionCheckpoints.sessionId, input.sessionId),
            or(
              eq(sessionCheckpoints.version, input.version),
              eq(sessionCheckpoints.idempotencyKey, input.idempotencyKey),
            ),
          ),
        )
        .get()
    )
      return "duplicate";
    return (await this.sessionExists(input.sessionId)) ? "conflict" : "not_found";
  }

  private async completionFailure(input: CompletionInput): Promise<PersistenceResult> {
    if (
      await this.db
        .select({ sessionId: sessionCompletions.sessionId })
        .from(sessionCompletions)
        .where(eq(sessionCompletions.sessionId, input.sessionId))
        .get()
    )
      return "duplicate";
    return (await this.sessionExists(input.sessionId)) ? "conflict" : "not_found";
  }
}
