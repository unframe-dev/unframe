import { and, desc, eq } from "drizzle-orm";

import { createD1Database } from "../../adapters/d1/database";
import { runtimeAssignments } from "../../adapters/d1/schema";

export type RuntimeKind = "Cloud" | "VenueEdge";
export type RuntimeAssignment = {
  sessionId: string;
  runtimeId: string;
  runtimeKind: RuntimeKind;
  endpoint: string;
  certificateFingerprint: string | null;
  provisioningEdgeId: string | null;
  assignmentEpoch: number;
  presentationRevision: number;
  issuedAt: string;
  leaseExpiresAt: string;
  releasedAt: string | null;
};
export type AssignmentRequest = Omit<RuntimeAssignment, "assignmentEpoch" | "releasedAt"> & {
  edgeHealthyAfter: string;
};
export type LeaseRequest = {
  sessionId: string;
  provisioningEdgeId: string;
  assignmentEpoch: number;
  now: string;
  leaseExpiresAt?: string;
};

export interface RuntimeAssignmentRepository {
  assign(input: AssignmentRequest): Promise<RuntimeAssignment | null>;
  findActive(
    sessionId: string,
    now: string,
    edgeHealthyAfter: string,
  ): Promise<RuntimeAssignment | null>;
  renew(input: Required<LeaseRequest>): Promise<RuntimeAssignment | null>;
  release(input: Omit<LeaseRequest, "leaseExpiresAt">): Promise<boolean>;
  releaseSession(sessionId: string, now: string): Promise<void>;
}

export class D1RuntimeAssignmentRepository implements RuntimeAssignmentRepository {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = createD1Database(database);
  }
  async assign(input: AssignmentRequest) {
    const result = await this.database
      .prepare(
        "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint, provisioning_edge_id, epoch, revision, issued_at, lease_expires_at, released_at) SELECT ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(epoch) + 1 FROM runtime_assignments WHERE session_id = ?), 1), ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM presentation_sessions AS session JOIN presentations AS presentation ON presentation.id = session.presentation_id WHERE session.id = ? AND session.state != 'Ended' AND presentation.revision = ?) AND ((? = 'Cloud' AND ? IS NULL AND ? IS NULL) OR (? = 'VenueEdge' AND EXISTS (SELECT 1 FROM venue_edges WHERE id = ? AND runtime_id = ? AND status = 'active' AND protocol_version = 'v1' AND health = 'healthy' AND registered_at IS NOT NULL AND last_seen_at >= ? AND capacity > 0 AND local_endpoint = ? AND certificate_fingerprint = ?))) AND NOT EXISTS (SELECT 1 FROM runtime_assignments WHERE session_id = ? AND released_at IS NULL AND lease_expires_at > ?) AND NOT EXISTS (SELECT 1 FROM runtime_assignments WHERE runtime_id = ? AND released_at IS NULL AND lease_expires_at > ?)",
      )
      .bind(
        input.sessionId,
        input.runtimeId,
        input.runtimeKind,
        input.endpoint,
        input.certificateFingerprint,
        input.provisioningEdgeId,
        input.sessionId,
        input.presentationRevision,
        input.issuedAt,
        input.leaseExpiresAt,
        input.sessionId,
        input.presentationRevision,
        input.runtimeKind,
        input.provisioningEdgeId,
        input.certificateFingerprint,
        input.runtimeKind,
        input.provisioningEdgeId,
        input.runtimeId,
        input.edgeHealthyAfter,
        input.endpoint,
        input.certificateFingerprint,
        input.sessionId,
        input.issuedAt,
        input.runtimeId,
        input.issuedAt,
      )
      .run();
    return result.meta.changes === 1 ? this.latest(input.sessionId) : null;
  }
  async findActive(sessionId: string, now: string, edgeHealthyAfter: string) {
    return (
      (await this.database
        .prepare(
          "SELECT assignment.session_id AS sessionId, assignment.runtime_id AS runtimeId, assignment.runtime_kind AS runtimeKind, assignment.endpoint, assignment.certificate_fingerprint AS certificateFingerprint, assignment.provisioning_edge_id AS provisioningEdgeId, assignment.epoch AS assignmentEpoch, assignment.revision AS presentationRevision, assignment.issued_at AS issuedAt, assignment.lease_expires_at AS leaseExpiresAt, assignment.released_at AS releasedAt FROM runtime_assignments AS assignment JOIN presentation_sessions AS session ON session.id = assignment.session_id LEFT JOIN venue_edges AS edge ON edge.id = assignment.provisioning_edge_id WHERE assignment.session_id = ? AND session.state != 'Ended' AND assignment.released_at IS NULL AND assignment.lease_expires_at > ? AND ((assignment.runtime_kind = 'Cloud' AND assignment.provisioning_edge_id IS NULL) OR (assignment.runtime_kind = 'VenueEdge' AND edge.runtime_id = assignment.runtime_id AND edge.status = 'active' AND edge.protocol_version = 'v1' AND edge.health = 'healthy' AND edge.registered_at IS NOT NULL AND edge.last_seen_at >= ? AND edge.capacity > 0 AND edge.local_endpoint = assignment.endpoint AND edge.certificate_fingerprint = assignment.certificate_fingerprint)) ORDER BY assignment.epoch DESC LIMIT 1",
        )
        .bind(sessionId, now, edgeHealthyAfter)
        .first<RuntimeAssignment>()) ?? null
    );
  }
  async renew({
    sessionId,
    provisioningEdgeId,
    assignmentEpoch,
    now,
    leaseExpiresAt,
  }: Required<LeaseRequest>) {
    const result = await this.database
      .prepare(
        "UPDATE runtime_assignments SET lease_expires_at = ? WHERE session_id = ? AND runtime_kind = 'VenueEdge' AND provisioning_edge_id = ? AND epoch = ? AND released_at IS NULL AND lease_expires_at > ? AND lease_expires_at < ? AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = ? AND state != 'Ended') AND EXISTS (SELECT 1 FROM venue_edges WHERE id = ? AND runtime_id = runtime_assignments.runtime_id AND status = 'active' AND protocol_version = 'v1' AND health = 'healthy' AND registered_at IS NOT NULL AND capacity > 0 AND local_endpoint = runtime_assignments.endpoint AND certificate_fingerprint = runtime_assignments.certificate_fingerprint)",
      )
      .bind(
        leaseExpiresAt,
        sessionId,
        provisioningEdgeId,
        assignmentEpoch,
        now,
        leaseExpiresAt,
        sessionId,
        provisioningEdgeId,
      )
      .run();
    return result.meta.changes === 1 ? this.byEpoch(sessionId, assignmentEpoch) : null;
  }
  async release({
    sessionId,
    provisioningEdgeId,
    assignmentEpoch,
    now,
  }: Omit<LeaseRequest, "leaseExpiresAt">) {
    const result = await this.database
      .prepare(
        "UPDATE runtime_assignments SET released_at = ? WHERE session_id = ? AND provisioning_edge_id = ? AND epoch = ? AND released_at IS NULL AND lease_expires_at > ?",
      )
      .bind(now, sessionId, provisioningEdgeId, assignmentEpoch, now)
      .run();
    return result.meta.changes === 1;
  }
  async releaseSession(sessionId: string, now: string) {
    await this.database
      .prepare(
        "UPDATE runtime_assignments SET released_at = ? WHERE session_id = ? AND released_at IS NULL",
      )
      .bind(now, sessionId)
      .run();
  }
  private async latest(sessionId: string) {
    const value = await this.db
      .select()
      .from(runtimeAssignments)
      .where(eq(runtimeAssignments.sessionId, sessionId))
      .orderBy(desc(runtimeAssignments.epoch))
      .get();
    if (!value) return null;
    const { epoch, revision, ...assignment } = value;
    return { ...assignment, assignmentEpoch: epoch, presentationRevision: revision };
  }
  private async byEpoch(sessionId: string, epoch: number) {
    const value = await this.db
      .select()
      .from(runtimeAssignments)
      .where(and(eq(runtimeAssignments.sessionId, sessionId), eq(runtimeAssignments.epoch, epoch)))
      .get();
    if (!value) return null;
    const { epoch: storedEpoch, revision, ...assignment } = value;
    return { ...assignment, assignmentEpoch: storedEpoch, presentationRevision: revision };
  }
}
