import type { D1Database } from "@cloudflare/workers-types";
import { and, eq } from "drizzle-orm";

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
             AND (assignment.runtime_kind != 'Cloud' OR EXISTS (SELECT 1 FROM runtime_hosts AS host WHERE host.runtime_id = assignment.runtime_id AND host.generation = assignment.host_generation AND host.endpoint = assignment.endpoint))
             AND assignment.epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = assignment.session_id)
             AND EXISTS (
               SELECT 1 FROM presentation_publications AS publication
               WHERE publication.presentation_id = session.presentation_id
                 AND publication.epoch = session.publication_epoch
                 AND json_extract(?, '$.publication.presentationId') = session.presentation_id
                 AND CAST(json_extract(?, '$.publication.publicationEpoch') AS INTEGER) = session.publication_epoch
                 AND json_extract(?, '$.publication.publicationManifestHash') = json_extract(publication.manifest, '$.publicationManifestHash')
                 AND json_extract(?, '$.definitionHash') = json_extract(publication.manifest, '$.definitionHash')
                 AND json_extract(?, '$.renderBundleHash') = json_extract(publication.manifest, '$.renderBundleHash')
             )
             AND session.state != 'Ended'
         )
         AND ? > COALESCE((SELECT MAX(version) FROM session_checkpoints WHERE session_id = ?), 0)
         AND ? >= COALESCE((SELECT MAX(last_sequence) FROM session_checkpoints WHERE session_id = ?), 0)`,
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
        ...Array<string>(5).fill(JSON.stringify(input.payload)),
        input.version,
        input.sessionId,
        input.lastSequence,
        input.sessionId,
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
             AND (assignment.runtime_kind != 'Cloud' OR EXISTS (SELECT 1 FROM runtime_hosts AS host WHERE host.runtime_id = assignment.runtime_id AND host.generation = assignment.host_generation AND host.endpoint = assignment.endpoint))
             AND assignment.epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = assignment.session_id)
             AND EXISTS (
               SELECT 1 FROM presentation_publications AS publication
               WHERE publication.presentation_id = session.presentation_id
                 AND publication.epoch = session.publication_epoch
                 AND json_extract(?, '$.publication.presentationId') = session.presentation_id
                 AND CAST(json_extract(?, '$.publication.publicationEpoch') AS INTEGER) = session.publication_epoch
                 AND json_extract(?, '$.publication.publicationManifestHash') = json_extract(publication.manifest, '$.publicationManifestHash')
                 AND json_extract(?, '$.definitionHash') = json_extract(publication.manifest, '$.definitionHash')
                 AND json_extract(?, '$.renderBundleHash') = json_extract(publication.manifest, '$.renderBundleHash')
             )
               AND session.state != 'Ended'
           )
           AND ? >= COALESCE((SELECT MAX(version) FROM session_checkpoints WHERE session_id = ?), 0)
           AND ? >= COALESCE((SELECT MAX(last_sequence) FROM session_checkpoints WHERE session_id = ?), 0)`,
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
          ...Array<string>(5).fill(JSON.stringify(input.finalCheckpoint)),
          input.checkpointVersion,
          input.sessionId,
          input.lastSequence,
          input.sessionId,
        ),
      this.database
        .prepare(
          "UPDATE presentation_sessions SET state = 'Ended', ended_at = ? WHERE id = ? AND state != 'Ended' AND changes() = 1 AND EXISTS (SELECT 1 FROM session_completions WHERE session_id = ? AND idempotency_key = ?)",
        )
        .bind(input.endedAt, input.sessionId, input.sessionId, input.idempotencyKey),
      this.database
        .prepare(
          "UPDATE runtime_assignments SET released_at = ? WHERE session_id = ? AND runtime_id = ? AND runtime_kind = ? AND epoch = ? AND revision = ? AND released_at IS NULL AND lease_expires_at > ? AND changes() = 1 AND EXISTS (SELECT 1 FROM session_completions WHERE session_id = ? AND idempotency_key = ?)",
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
  private async latestIdentity(input: CheckpointInput | CompletionInput): Promise<boolean> {
    return Boolean(
      await this.database
        .prepare(
          "SELECT 1 FROM runtime_assignments WHERE session_id = ? AND runtime_id = ? AND runtime_kind = ? AND revision = ? AND epoch = ? AND epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = ?) AND (runtime_kind != 'Cloud' OR EXISTS (SELECT 1 FROM runtime_hosts AS host WHERE host.runtime_id = runtime_assignments.runtime_id AND host.generation = runtime_assignments.host_generation AND host.endpoint = runtime_assignments.endpoint))",
        )
        .bind(
          input.sessionId,
          input.runtimeId,
          input.runtimeKind,
          input.presentationRevision,
          input.assignmentEpoch,
          input.sessionId,
        )
        .first(),
    );
  }

  private async checkpointFailure(input: CheckpointInput): Promise<PersistenceResult> {
    const stored = await this.db
      .select()
      .from(sessionCheckpoints)
      .where(
        and(
          eq(sessionCheckpoints.sessionId, input.sessionId),
          eq(sessionCheckpoints.version, input.version),
          eq(sessionCheckpoints.idempotencyKey, input.idempotencyKey),
          eq(sessionCheckpoints.lastSequence, input.lastSequence),
          eq(sessionCheckpoints.payload, JSON.stringify(input.payload)),
        ),
      )
      .get();
    if (stored && (await this.latestIdentity(input))) return "duplicate";
    return (await this.sessionExists(input.sessionId)) ? "conflict" : "not_found";
  }

  private async completionFailure(input: CompletionInput): Promise<PersistenceResult> {
    const stored = await this.db
      .select()
      .from(sessionCompletions)
      .where(
        and(
          eq(sessionCompletions.sessionId, input.sessionId),
          eq(sessionCompletions.checkpointVersion, input.checkpointVersion),
          eq(sessionCompletions.lastSequence, input.lastSequence),
          eq(sessionCompletions.idempotencyKey, input.idempotencyKey),
          eq(sessionCompletions.startedAt, input.startedAt),
          eq(sessionCompletions.endedAt, input.endedAt),
          eq(sessionCompletions.participantCount, input.participantCount),
          eq(sessionCompletions.participants, JSON.stringify(input.participants)),
          eq(sessionCompletions.finalState, JSON.stringify(input.finalCheckpoint)),
        ),
      )
      .get();
    if (stored && (await this.latestIdentity(input))) return "duplicate";
    return (await this.sessionExists(input.sessionId)) ? "conflict" : "not_found";
  }
}
