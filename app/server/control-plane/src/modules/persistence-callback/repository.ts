import type { CompletionInput, CheckpointInput } from "./schema";
import type { PersistenceCallbackRepository, PersistenceResult } from "./service";

export class D1PersistenceCallbackRepository implements PersistenceCallbackRepository {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async applyCheckpoint(input: CheckpointInput): Promise<PersistenceResult> {
    if (!(await this.sessionExists(input.sessionId))) return "not_found";
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO session_checkpoints
           (session_id, version, last_sequence, idempotency_key, payload, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.sessionId,
        input.version,
        input.lastSequence,
        input.idempotencyKey,
        JSON.stringify(input.payload),
        this.now(),
      )
      .run();
    return result.meta.changes === 1 ? "applied" : "duplicate";
  }

  async applyCompletion(input: CompletionInput): Promise<PersistenceResult> {
    if (!(await this.sessionExists(input.sessionId))) return "not_found";
    const [inserted] = await this.database.batch([
      this.database
        .prepare(
          `INSERT OR IGNORE INTO session_completions
             (session_id, checkpoint_version, last_sequence, idempotency_key, started_at,
              ended_at, participant_count, participants, final_state, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          this.now(),
        ),
      this.database
        .prepare(
          "UPDATE presentation_sessions SET state = 'Ended', ended_at = ? WHERE id = ? AND state != 'Ended'",
        )
        .bind(input.endedAt, input.sessionId),
      this.database
        .prepare(
          "UPDATE session_edge_assignments SET released_at = ? WHERE session_id = ? AND released_at IS NULL",
        )
        .bind(input.endedAt, input.sessionId),
    ]);
    return inserted?.meta.changes === 1 ? "applied" : "duplicate";
  }

  private async sessionExists(sessionId: string) {
    return Boolean(
      await this.database
        .prepare("SELECT 1 FROM presentation_sessions WHERE id = ?")
        .bind(sessionId)
        .first(),
    );
  }
}
