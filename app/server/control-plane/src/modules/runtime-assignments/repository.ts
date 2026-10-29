import { currentHostGeneration } from "../runtime-hosts/fence";
import { and, desc, eq, gt, gte, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { createD1Database } from "../../adapters/d1/database";
import {
  presentationSessions,
  runtimeAssignments,
  runtimeHosts,
  venueEdges,
} from "../../adapters/d1/schema";

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
  findConnectable(
    sessionId: string,
    now: string,
    healthyAfter: string,
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
        `INSERT INTO runtime_assignments
          (session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint, provisioning_edge_id,
           epoch, revision, issued_at, lease_expires_at, released_at, host_generation)
         SELECT ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(epoch) + 1 FROM runtime_assignments WHERE session_id = ?), 1),
           ?, ?, ?, NULL, (SELECT generation FROM runtime_hosts WHERE runtime_id = ?)
         WHERE EXISTS (
           SELECT 1 FROM presentation_sessions AS session
           JOIN presentations AS presentation ON presentation.id = session.presentation_id
           WHERE session.id = ? AND session.state != 'Ended' AND presentation.revision = ?
         ) AND (
           (? = 'Cloud' AND ? IS NULL AND ? IS NULL AND EXISTS (
             SELECT 1 FROM runtime_hosts AS host
             WHERE host.runtime_id = ? AND host.endpoint = ? AND host.generation > 0
               AND host.accepting = 1 AND host.last_seen_at >= ?
               AND (SELECT COUNT(*) FROM runtime_assignments AS active
                 WHERE active.runtime_id = host.runtime_id AND active.released_at IS NULL AND active.lease_expires_at > ?
                   AND active.epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = active.session_id)
                   AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = active.session_id AND state != 'Ended')) < host.capacity
           )) OR (
             ? = 'VenueEdge' AND EXISTS (
               SELECT 1 FROM venue_edges WHERE id = ? AND runtime_id = ? AND status = 'active'
                 AND protocol_version = 'v3' AND health = 'healthy' AND registered_at IS NOT NULL
                 AND last_seen_at >= ? AND capacity > 0 AND local_endpoint = ? AND certificate_fingerprint = ?
             ) AND NOT EXISTS (SELECT 1 FROM runtime_hosts WHERE runtime_id = ?)
               AND NOT EXISTS (SELECT 1 FROM runtime_assignments WHERE runtime_id = ? AND released_at IS NULL AND lease_expires_at > ?)
           )
         ) AND NOT EXISTS (
           SELECT 1 FROM runtime_assignments WHERE session_id = ? AND execution_state != 'stopped' AND lease_expires_at > ?
         )
         RETURNING session_id AS sessionId, runtime_id AS runtimeId, runtime_kind AS runtimeKind, endpoint,
           certificate_fingerprint AS certificateFingerprint, provisioning_edge_id AS provisioningEdgeId,
           epoch AS assignmentEpoch, revision AS presentationRevision, issued_at AS issuedAt,
           lease_expires_at AS leaseExpiresAt, released_at AS releasedAt`,
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
        input.runtimeId,
        input.sessionId,
        input.presentationRevision,
        input.runtimeKind,
        input.provisioningEdgeId,
        input.certificateFingerprint,
        input.runtimeId,
        input.endpoint,
        input.edgeHealthyAfter,
        input.issuedAt,
        input.runtimeKind,
        input.provisioningEdgeId,
        input.runtimeId,
        input.edgeHealthyAfter,
        input.endpoint,
        input.certificateFingerprint,
        input.runtimeId,
        input.runtimeId,
        input.issuedAt,
        input.sessionId,
        input.issuedAt,
      )
      .run<RuntimeAssignment>();
    return result.results[0] ?? null;
  }
  async claimExecutionBoot(
    sessionId: string,
    runtimeId: string,
    epoch: number,
    bootId: string,
    now: string,
  ) {
    const result = await this.database
      .prepare(`
      UPDATE runtime_assignments SET execution_boot_id = ?
      WHERE session_id = ? AND runtime_id = ? AND epoch = ? AND runtime_kind = 'VenueEdge'
        AND released_at IS NULL AND lease_expires_at > ?
        AND (execution_boot_id IS NULL OR execution_boot_id = ?)
        AND epoch = (SELECT MAX(epoch) FROM runtime_assignments WHERE session_id = ?)
        AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = ? AND state != 'Ended' AND publication_epoch IS NOT NULL)
      RETURNING epoch
    `)
      .bind(bootId, sessionId, runtimeId, epoch, now, bootId, sessionId, sessionId)
      .first();
    return result !== null;
  }

  async findActive(sessionId: string, now: string, edgeHealthyAfter: string) {
    return (
      (await this.db
        .select({
          sessionId: runtimeAssignments.sessionId,
          runtimeId: runtimeAssignments.runtimeId,
          runtimeKind: runtimeAssignments.runtimeKind,
          endpoint: runtimeAssignments.endpoint,
          certificateFingerprint: runtimeAssignments.certificateFingerprint,
          provisioningEdgeId: runtimeAssignments.provisioningEdgeId,
          assignmentEpoch: runtimeAssignments.epoch,
          presentationRevision: runtimeAssignments.revision,
          issuedAt: runtimeAssignments.issuedAt,
          leaseExpiresAt: runtimeAssignments.leaseExpiresAt,
          releasedAt: runtimeAssignments.releasedAt,
        })
        .from(runtimeAssignments)
        .innerJoin(presentationSessions, eq(presentationSessions.id, runtimeAssignments.sessionId))
        .leftJoin(venueEdges, eq(venueEdges.id, runtimeAssignments.provisioningEdgeId))
        .where(
          and(
            eq(runtimeAssignments.sessionId, sessionId),
            sql`${runtimeAssignments.epoch} = (SELECT MAX(latest.epoch) FROM runtime_assignments AS latest WHERE latest.session_id = ${sessionId})`,
            ne(presentationSessions.state, "Ended"),
            currentHostGeneration,
            isNull(runtimeAssignments.releasedAt),
            gt(runtimeAssignments.leaseExpiresAt, now),
            or(
              and(
                eq(runtimeAssignments.runtimeKind, "Cloud"),
                isNull(runtimeAssignments.provisioningEdgeId),
              ),
              and(
                eq(runtimeAssignments.runtimeKind, "VenueEdge"),
                eq(venueEdges.runtimeId, runtimeAssignments.runtimeId),
                eq(venueEdges.status, "active"),
                eq(venueEdges.protocolVersion, "v3"),
                eq(venueEdges.health, "healthy"),
                isNotNull(venueEdges.registeredAt),
                gte(venueEdges.lastSeenAt, edgeHealthyAfter),
                gt(venueEdges.capacity, 0),
                eq(venueEdges.localEndpoint, runtimeAssignments.endpoint),
                eq(venueEdges.certificateFingerprint, runtimeAssignments.certificateFingerprint),
              ),
            ),
          ),
        )
        .orderBy(desc(runtimeAssignments.epoch))
        .limit(1)
        .get()) ?? null
    );
  }
  async findConnectable(sessionId: string, now: string, healthyAfter: string) {
    const assignment = await this.findActive(sessionId, now, healthyAfter);
    if (!assignment || assignment.runtimeKind === "VenueEdge") return assignment;
    const ready = await this.db
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
          eq(runtimeAssignments.sessionId, sessionId),
          eq(runtimeAssignments.epoch, assignment.assignmentEpoch),
          eq(runtimeAssignments.executionState, "ready"),
          eq(runtimeHosts.endpoint, assignment.endpoint),
          gte(runtimeHosts.lastSeenAt, healthyAfter),
        ),
      )
      .get();
    return ready ? assignment : null;
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
        "UPDATE runtime_assignments SET lease_expires_at = ? WHERE session_id = ? AND runtime_kind = 'VenueEdge' AND provisioning_edge_id = ? AND epoch = ? AND released_at IS NULL AND lease_expires_at > ? AND lease_expires_at < ? AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = ? AND state != 'Ended') AND EXISTS (SELECT 1 FROM venue_edges WHERE id = ? AND runtime_id = runtime_assignments.runtime_id AND status = 'active' AND protocol_version = 'v3' AND health = 'healthy' AND registered_at IS NOT NULL AND capacity > 0 AND local_endpoint = runtime_assignments.endpoint AND certificate_fingerprint = runtime_assignments.certificate_fingerprint)",
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
    const result = await this.db
      .update(runtimeAssignments)
      .set({ releasedAt: now })
      .where(
        and(
          eq(runtimeAssignments.sessionId, sessionId),
          eq(runtimeAssignments.provisioningEdgeId, provisioningEdgeId),
          eq(runtimeAssignments.epoch, assignmentEpoch),
          isNull(runtimeAssignments.releasedAt),
          gt(runtimeAssignments.leaseExpiresAt, now),
        ),
      )
      .run();
    return result.meta.changes === 1;
  }
  async releaseSession(sessionId: string, now: string) {
    await this.db
      .update(runtimeAssignments)
      .set({ releasedAt: now })
      .where(
        and(eq(runtimeAssignments.sessionId, sessionId), isNull(runtimeAssignments.releasedAt)),
      )
      .run();
  }
  private async byEpoch(sessionId: string, epoch: number) {
    const value = await this.db
      .select()
      .from(runtimeAssignments)
      .where(and(eq(runtimeAssignments.sessionId, sessionId), eq(runtimeAssignments.epoch, epoch)))
      .get();
    if (!value) return null;
    return {
      sessionId: value.sessionId,
      runtimeId: value.runtimeId,
      runtimeKind: value.runtimeKind,
      endpoint: value.endpoint,
      certificateFingerprint: value.certificateFingerprint,
      provisioningEdgeId: value.provisioningEdgeId,
      assignmentEpoch: value.epoch,
      presentationRevision: value.revision,
      issuedAt: value.issuedAt,
      leaseExpiresAt: value.leaseExpiresAt,
      releasedAt: value.releasedAt,
    };
  }
}
