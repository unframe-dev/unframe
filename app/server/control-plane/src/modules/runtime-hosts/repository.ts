import { and, eq, gte } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import { presentationSessions, runtimeAssignments, runtimeHosts } from "../../adapters/d1/schema";
import {
  D1RuntimeAssignmentRepository,
  type RuntimeAssignment,
} from "../runtime-assignments/repository";

export type HostRegistration = {
  endpoint: string;
  accepting: boolean;
  capacity: number;
  bootId: string;
  bootStartedAt: string;
};
export type HostHeartbeat = Omit<HostRegistration, "bootStartedAt"> & {
  generation: number;
  sessions: {
    sessionId: string;
    assignmentEpoch: number;
    state: "starting" | "recovering" | "ready" | "stopping" | "stopped" | "failed";
  }[];
};
export type RuntimePreparation =
  | { state: "unassigned" }
  | { state: "ended" }
  | {
      state: "starting" | "ready";
      runtimeId: string;
      assignmentEpoch: number;
      leaseExpiresAt: string;
    };

const healthyAfter = (now: Date) => new Date(now.getTime() - 60_000).toISOString();
const leaseUntil = (now: Date) => new Date(now.getTime() + 120_000).toISOString();
const assignmentColumns = `session_id AS sessionId, runtime_id AS runtimeId, runtime_kind AS runtimeKind,
  endpoint, certificate_fingerprint AS certificateFingerprint, provisioning_edge_id AS provisioningEdgeId,
  epoch AS assignmentEpoch, revision AS presentationRevision, issued_at AS issuedAt,
  lease_expires_at AS leaseExpiresAt, released_at AS releasedAt`;

export class RuntimeHostRepository {
  private readonly queries;
  constructor(private readonly db: D1Database) {
    this.queries = createD1Database(db);
  }

  async start(runtimeId: string, input: HostRegistration, now: Date) {
    const startedAt = new Date(input.bootStartedAt).toISOString();
    if (startedAt > now.toISOString()) return undefined;
    const row = await this.db
      .prepare(`
      INSERT INTO runtime_hosts (runtime_id, endpoint, accepting, capacity, last_seen_at, boot_id, boot_started_at, generation)
      SELECT ?, ?, ?, ?, ?, ?, ?, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM runtime_assignments WHERE runtime_id = ? AND execution_state != 'stopped'
          AND lease_expires_at > ? AND (runtime_kind != 'Cloud' OR endpoint != ?)
      )
      ON CONFLICT(runtime_id) DO UPDATE SET
        endpoint = excluded.endpoint,
        accepting = CASE WHEN runtime_hosts.boot_id = excluded.boot_id THEN runtime_hosts.accepting ELSE excluded.accepting END,
        capacity = CASE WHEN runtime_hosts.boot_id = excluded.boot_id THEN runtime_hosts.capacity ELSE excluded.capacity END,
        last_seen_at = CASE WHEN runtime_hosts.boot_id = excluded.boot_id THEN runtime_hosts.last_seen_at ELSE excluded.last_seen_at END,
        boot_id = excluded.boot_id, boot_started_at = excluded.boot_started_at,
        generation = CASE WHEN runtime_hosts.boot_id = excluded.boot_id THEN runtime_hosts.generation ELSE runtime_hosts.generation + 1 END
      WHERE (runtime_hosts.boot_id = excluded.boot_id AND runtime_hosts.boot_started_at = excluded.boot_started_at AND runtime_hosts.endpoint = excluded.endpoint)
        OR (runtime_hosts.boot_id != excluded.boot_id AND runtime_hosts.boot_started_at < excluded.boot_started_at)
      RETURNING generation
    `)
      .bind(
        runtimeId,
        input.endpoint,
        input.accepting ? 1 : 0,
        input.capacity,
        now.toISOString(),
        input.bootId,
        startedAt,
        runtimeId,
        now.toISOString(),
        input.endpoint,
      )
      .first<{ generation: number }>();
    return row ?? undefined;
  }

  async heartbeat(runtimeId: string, input: HostHeartbeat, now: Date) {
    const timestamp = now.toISOString();
    const statements = [
      this.db
        .prepare(`
      UPDATE runtime_hosts SET accepting = ?, capacity = ?, last_seen_at = ?
      WHERE runtime_id = ? AND boot_id = ? AND generation = ? AND endpoint = ? RETURNING generation
    `)
        .bind(
          input.accepting ? 1 : 0,
          input.capacity,
          timestamp,
          runtimeId,
          input.bootId,
          input.generation,
          input.endpoint,
        ),
    ];
    statements.push(
      this.db
        .prepare(`
      UPDATE runtime_assignments SET execution_state = 'starting'
      WHERE runtime_id = ? AND host_generation = ? AND execution_state = 'ready'
        AND EXISTS (SELECT 1 FROM runtime_hosts WHERE runtime_id = ? AND boot_id = ? AND generation = ? AND endpoint = ?)
    `)
        .bind(
          runtimeId,
          input.generation,
          runtimeId,
          input.bootId,
          input.generation,
          input.endpoint,
        ),
    );
    for (const report of input.sessions) {
      statements.push(
        this.db
          .prepare(`
        UPDATE runtime_assignments SET execution_state = ?,
          lease_expires_at = CASE WHEN ? IN ('starting','recovering','ready') THEN MAX(lease_expires_at, ?) ELSE lease_expires_at END
        WHERE session_id = ? AND epoch = ? AND runtime_id = ? AND runtime_kind = 'Cloud'
          AND host_generation = ? AND endpoint = ? AND (released_at IS NULL OR ? = 'stopped') AND lease_expires_at > ?
          AND epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = ?)
          AND EXISTS (SELECT 1 FROM runtime_hosts WHERE runtime_id = ? AND boot_id = ? AND generation = ? AND endpoint = ?)
          AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = ? AND state != 'Ended')
      `)
          .bind(
            report.state,
            report.state,
            leaseUntil(now),
            report.sessionId,
            report.assignmentEpoch,
            runtimeId,
            input.generation,
            input.endpoint,
            report.state,
            timestamp,
            report.sessionId,
            runtimeId,
            input.bootId,
            input.generation,
            input.endpoint,
            report.sessionId,
          ),
      );
    }
    // Recreate only the latest assignment for each Session after its previous authority has stopped.
    statements.push(
      this.db
        .prepare(`
      INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint, provisioning_edge_id,
        epoch, revision, issued_at, lease_expires_at, released_at, host_generation, execution_state)
      SELECT source.session_id, source.runtime_id, 'Cloud', source.endpoint, NULL, NULL,
        source.epoch + 1, source.revision, ?, ?, NULL, host.generation, 'recovering'
      FROM runtime_assignments AS source
      JOIN presentation_sessions AS session ON session.id = source.session_id
      JOIN runtime_hosts AS host ON host.runtime_id = source.runtime_id
      WHERE source.runtime_id = ? AND source.runtime_kind = 'Cloud' AND source.endpoint = ?
        AND source.released_at IS NULL AND (source.lease_expires_at <= ? OR (source.host_generation = host.generation AND source.execution_state = 'stopped'))
        AND source.epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = source.session_id)
        AND NOT EXISTS (SELECT 1 FROM runtime_assignments AS previous WHERE previous.session_id = source.session_id
          AND previous.epoch != source.epoch AND previous.lease_expires_at > ? AND previous.execution_state != 'stopped')
        AND session.state != 'Ended' AND session.publication_epoch IS NOT NULL
        AND host.boot_id = ? AND host.generation = ? AND host.endpoint = source.endpoint
      ORDER BY source.session_id
      LIMIT MAX(0, COALESCE((SELECT capacity FROM runtime_hosts WHERE runtime_id = ? AND boot_id = ? AND generation = ?), 0) - (
        SELECT COUNT(*) FROM runtime_assignments AS active WHERE active.runtime_id = ? AND active.released_at IS NULL
          AND active.lease_expires_at > ? AND active.execution_state != 'stopped'
          AND active.epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = active.session_id)
          AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = active.session_id AND state != 'Ended')
      ))
    `)
        .bind(
          timestamp,
          leaseUntil(now),
          runtimeId,
          input.endpoint,
          timestamp,
          timestamp,
          input.bootId,
          input.generation,
          runtimeId,
          input.bootId,
          input.generation,
          runtimeId,
          timestamp,
        ),
    );
    statements.push(
      this.db
        .prepare(`
      SELECT ${assignmentColumns}, (epoch > 1) AS recovery FROM runtime_assignments AS assignment
      WHERE runtime_id = ? AND runtime_kind = 'Cloud' AND endpoint = ? AND host_generation = ?
        AND released_at IS NULL AND lease_expires_at > ? AND execution_state != 'stopped'
        AND epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = assignment.session_id)
        AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = assignment.session_id AND state != 'Ended')
        AND EXISTS (SELECT 1 FROM runtime_hosts WHERE runtime_id = ? AND boot_id = ? AND generation = ? AND endpoint = ?)
      ORDER BY session_id
    `)
        .bind(
          runtimeId,
          input.endpoint,
          input.generation,
          timestamp,
          runtimeId,
          input.bootId,
          input.generation,
          input.endpoint,
        ),
    );
    const results = await this.db.batch(statements);
    if (!results[0]?.results.length) return undefined;
    const active = results.at(-1)?.results as (RuntimeAssignment & { recovery: number })[];
    return {
      generation: input.generation,
      assignments: active.map((value) => ({ ...value, recovery: Boolean(value.recovery) })),
    };
  }

  async prepare(sessionId: string, now: Date) {
    const timestamp = now.toISOString();
    await this.db
      .prepare(`
      INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint, provisioning_edge_id,
        epoch, revision, issued_at, lease_expires_at, released_at, host_generation, execution_state)
      SELECT session.id, host.runtime_id, 'Cloud', host.endpoint, NULL, NULL,
        COALESCE((SELECT MAX(epoch) + 1 FROM runtime_assignments WHERE session_id = session.id), 1),
        presentation.revision, ?, ?, NULL, host.generation,
        CASE WHEN EXISTS (SELECT 1 FROM runtime_assignments WHERE session_id = session.id) THEN 'recovering' ELSE 'starting' END
      FROM runtime_hosts AS host
      JOIN presentation_sessions AS session ON session.id = ?
      JOIN presentations AS presentation ON presentation.id = session.presentation_id
      WHERE session.state != 'Ended' AND session.publication_epoch IS NOT NULL
        AND host.accepting = 1 AND host.generation > 0 AND host.last_seen_at >= ?
        AND NOT EXISTS (SELECT 1 FROM runtime_assignments WHERE session_id = session.id AND execution_state != 'stopped' AND lease_expires_at > ?)
        AND (SELECT COUNT(*) FROM runtime_assignments AS active WHERE runtime_id = host.runtime_id AND released_at IS NULL AND lease_expires_at > ?
          AND epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = active.session_id)
          AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = active.session_id AND state != 'Ended')) < host.capacity
      ORDER BY host.runtime_id LIMIT 1
    `)
      .bind(timestamp, leaseUntil(now), sessionId, healthyAfter(now), timestamp, timestamp)
      .run();
    return this.status(sessionId, now);
  }

  async status(sessionId: string, now: Date): Promise<RuntimePreparation> {
    const session = await this.queries
      .select({ state: presentationSessions.state })
      .from(presentationSessions)
      .where(eq(presentationSessions.id, sessionId))
      .get();
    if (session?.state === "Ended") return { state: "ended" };
    const assignment = await new D1RuntimeAssignmentRepository(this.db).findActive(
      sessionId,
      now.toISOString(),
      healthyAfter(now),
    );
    if (!assignment) return { state: "unassigned" };
    const ready = await this.queries
      .select({ runtimeId: runtimeHosts.runtimeId })
      .from(runtimeHosts)
      .innerJoin(
        runtimeAssignments,
        and(
          eq(runtimeAssignments.runtimeId, runtimeHosts.runtimeId),
          eq(runtimeAssignments.hostGeneration, runtimeHosts.generation),
        ),
      )
      .where(
        and(
          eq(runtimeHosts.runtimeId, assignment.runtimeId),
          eq(runtimeHosts.endpoint, assignment.endpoint),
          gte(runtimeHosts.lastSeenAt, healthyAfter(now)),
          eq(runtimeAssignments.sessionId, sessionId),
          eq(runtimeAssignments.epoch, assignment.assignmentEpoch),
          eq(runtimeAssignments.executionState, "ready"),
        ),
      )
      .get();
    return {
      state: ready ? "ready" : "starting",
      runtimeId: assignment.runtimeId,
      assignmentEpoch: assignment.assignmentEpoch,
      leaseExpiresAt: assignment.leaseExpiresAt,
    };
  }
}
