import {
  D1RuntimeAssignmentRepository,
  type RuntimeAssignment,
} from "../runtime-assignments/repository";

export type HostHeartbeat = {
  endpoint: string;
  accepting: boolean;
  serving?: { sessionId: string; assignmentEpoch: number } | undefined;
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

export class RuntimeHostRepository {
  constructor(private readonly db: D1Database) {}

  async heartbeat(runtimeId: string, input: HostHeartbeat, now: Date) {
    const timestamp = now.toISOString();
    const [registered, , , active] = await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO runtime_hosts (runtime_id, endpoint, accepting, last_seen_at, serving_session_id, serving_assignment_epoch) SELECT ?, ?, ?, ?, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM runtime_assignments WHERE runtime_id = ? AND released_at IS NULL AND lease_expires_at > ? AND (runtime_kind != 'Cloud' OR endpoint != ?)) ON CONFLICT(runtime_id) DO UPDATE SET endpoint = excluded.endpoint, accepting = excluded.accepting, last_seen_at = excluded.last_seen_at, serving_session_id = NULL, serving_assignment_epoch = NULL RETURNING runtime_id",
        )
        .bind(
          runtimeId,
          input.endpoint,
          input.accepting ? 1 : 0,
          timestamp,
          runtimeId,
          timestamp,
          input.endpoint,
        ),
      this.db
        .prepare(
          "UPDATE runtime_assignments SET lease_expires_at = MAX(lease_expires_at, ?) WHERE ? = 1 AND runtime_id = ? AND runtime_kind = 'Cloud' AND endpoint = ? AND released_at IS NULL AND lease_expires_at > ? AND EXISTS (SELECT 1 FROM runtime_hosts WHERE runtime_id = ? AND endpoint = ? AND accepting = 1) AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = runtime_assignments.session_id AND state != 'Ended')",
        )
        .bind(
          leaseUntil(now),
          input.accepting ? 1 : 0,
          runtimeId,
          input.endpoint,
          timestamp,
          runtimeId,
          input.endpoint,
        ),
      this.db
        .prepare(
          "UPDATE runtime_hosts SET serving_session_id = ?, serving_assignment_epoch = ? WHERE runtime_id = ? AND endpoint = ? AND accepting = 1 AND EXISTS (SELECT 1 FROM runtime_assignments AS assignment JOIN presentation_sessions AS session ON session.id = assignment.session_id WHERE assignment.session_id = ? AND assignment.epoch = ? AND assignment.runtime_id = ? AND assignment.runtime_kind = 'Cloud' AND assignment.endpoint = ? AND assignment.released_at IS NULL AND assignment.lease_expires_at > ? AND session.state != 'Ended')",
        )
        .bind(
          input.serving?.sessionId ?? null,
          input.serving?.assignmentEpoch ?? null,
          runtimeId,
          input.endpoint,
          input.serving?.sessionId ?? null,
          input.serving?.assignmentEpoch ?? null,
          runtimeId,
          input.endpoint,
          timestamp,
        ),
      this.db
        .prepare(
          "SELECT assignment.session_id AS sessionId, assignment.runtime_id AS runtimeId, assignment.runtime_kind AS runtimeKind, assignment.endpoint, assignment.certificate_fingerprint AS certificateFingerprint, assignment.provisioning_edge_id AS provisioningEdgeId, assignment.epoch AS assignmentEpoch, assignment.revision AS presentationRevision, assignment.issued_at AS issuedAt, assignment.lease_expires_at AS leaseExpiresAt, assignment.released_at AS releasedAt FROM runtime_assignments AS assignment JOIN presentation_sessions AS session ON session.id = assignment.session_id WHERE assignment.runtime_id = ? AND assignment.runtime_kind = 'Cloud' AND assignment.endpoint = ? AND assignment.released_at IS NULL AND assignment.lease_expires_at > ? AND session.state != 'Ended' ORDER BY assignment.issued_at DESC LIMIT 1",
        )
        .bind(runtimeId, input.endpoint, timestamp),
    ]);
    if (!registered?.results.length) return undefined;
    return { assignment: (active?.results[0] as RuntimeAssignment | undefined) ?? null };
  }

  async prepare(sessionId: string, now: Date) {
    await this.db
      .prepare(
        "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint, provisioning_edge_id, epoch, revision, issued_at, lease_expires_at, released_at) SELECT session.id, host.runtime_id, 'Cloud', host.endpoint, NULL, NULL, COALESCE((SELECT MAX(epoch) + 1 FROM runtime_assignments WHERE session_id = session.id), 1), presentation.revision, ?, ?, NULL FROM runtime_hosts AS host JOIN presentation_sessions AS session ON session.id = ? JOIN presentations AS presentation ON presentation.id = session.presentation_id WHERE session.state != 'Ended' AND session.publication_epoch IS NOT NULL AND host.accepting = 1 AND host.last_seen_at >= ? AND NOT EXISTS (SELECT 1 FROM runtime_assignments WHERE session_id = session.id AND released_at IS NULL AND lease_expires_at > ?) AND NOT EXISTS (SELECT 1 FROM runtime_assignments WHERE runtime_id = host.runtime_id AND released_at IS NULL AND lease_expires_at > ?) ORDER BY host.runtime_id LIMIT 1",
      )
      .bind(
        now.toISOString(),
        leaseUntil(now),
        sessionId,
        healthyAfter(now),
        now.toISOString(),
        now.toISOString(),
      )
      .run();
    return this.status(sessionId, now);
  }

  async status(sessionId: string, now: Date): Promise<RuntimePreparation> {
    const session = await this.db
      .prepare("SELECT state FROM presentation_sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ state: string }>();
    if (session?.state === "Ended") return { state: "ended" };
    const assignment = await new D1RuntimeAssignmentRepository(this.db).findActive(
      sessionId,
      now.toISOString(),
      healthyAfter(now),
    );
    if (!assignment) return { state: "unassigned" };
    const ready = await this.db
      .prepare(
        "SELECT runtime_id FROM runtime_hosts WHERE runtime_id = ? AND endpoint = ? AND accepting = 1 AND last_seen_at >= ? AND serving_session_id = ? AND serving_assignment_epoch = ?",
      )
      .bind(
        assignment.runtimeId,
        assignment.endpoint,
        healthyAfter(now),
        sessionId,
        assignment.assignmentEpoch,
      )
      .first();
    return {
      state: ready ? "ready" : "starting",
      runtimeId: assignment.runtimeId,
      assignmentEpoch: assignment.assignmentEpoch,
      leaseExpiresAt: assignment.leaseExpiresAt,
    };
  }
}
