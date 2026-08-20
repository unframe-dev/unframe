import { and, desc, eq } from "drizzle-orm";

import { createD1Database } from "../../adapters/d1/database";
import { sessionEdgeAssignments, venueEdgeCredentials, venueEdges } from "../../adapters/d1/schema";

export type VenueEdgeRecord = {
  id: string;
  status: "active" | "revoked";
  runtimeVersion: string | null;
  protocolVersion: string | null;
  capacity: number | null;
  localEndpoint: string | null;
  certificateFingerprint: string | null;
  health: string | null;
  registeredAt: string | null;
  lastSeenAt: string;
  createdAt: string;
  revokedAt: string | null;
};
export type VenueEdgeCredentialRecord = {
  edgeId: string;
  tokenId: string;
  tokenHash: string;
  status: "active" | "revoked";
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
export type EdgeSessionAssignment = {
  sessionId: string;
  edgeId: string;
  assignmentEpoch: number;
  presentationRevision: number;
  issuedAt: string;
  leaseExpiresAt: string;
  releasedAt: string | null;
};
export type ActiveEdgeSessionAssignment = EdgeSessionAssignment & {
  localEndpoint: string;
  certificateFingerprint: string;
};
export type EdgeRegistration = {
  runtimeVersion: string;
  protocolVersion: string;
  capacity: number;
  localEndpoint: string;
  certificateFingerprint: string;
  health: string;
  observedAt: string;
};
export type AssignmentRequest = {
  sessionId: string;
  edgeId: string;
  presentationRevision: number;
  issuedAt: string;
  leaseExpiresAt: string;
  edgeHealthyAfter: string;
};
export type LeaseRequest = {
  sessionId: string;
  edgeId: string;
  assignmentEpoch: number;
  now: string;
  leaseExpiresAt?: string;
};
export interface VenueEdgeRepository {
  createEdge(edge: VenueEdgeRecord, credential: VenueEdgeCredentialRecord): Promise<void>;
  findEdge(id: string): Promise<VenueEdgeRecord | null>;
  findCredential(edgeId: string, tokenId: string): Promise<VenueEdgeCredentialRecord | null>;
  touchCredential(edgeId: string, tokenId: string, usedAt: string): Promise<void>;
  rotateCredential(input: {
    edgeId: string;
    previousExpiresAt: string;
    credential: VenueEdgeCredentialRecord;
  }): Promise<boolean>;
  revokeEdge(edgeId: string, revokedAt: string): Promise<boolean>;
  register(edgeId: string, update: EdgeRegistration): Promise<boolean>;
  assign(input: AssignmentRequest): Promise<EdgeSessionAssignment | null>;
  renew(input: LeaseRequest): Promise<EdgeSessionAssignment | null>;
  release(input: LeaseRequest): Promise<boolean>;
  findActiveAssignment(
    sessionId: string,
    now: string,
    edgeHealthyAfter: string,
  ): Promise<ActiveEdgeSessionAssignment | null>;
}

export class D1VenueEdgeRepository implements VenueEdgeRepository {
  private readonly db;
  constructor(private readonly database: D1Database) {
    this.db = createD1Database(database);
  }
  async createEdge(edge: VenueEdgeRecord, credential: VenueEdgeCredentialRecord) {
    await this.db.batch([
      this.db.insert(venueEdges).values(edge),
      this.db.insert(venueEdgeCredentials).values(credential),
    ]);
  }
  async findEdge(id: string) {
    return (await this.db.select().from(venueEdges).where(eq(venueEdges.id, id)).get()) ?? null;
  }
  async findCredential(edgeId: string, tokenId: string) {
    return (
      (await this.db
        .select()
        .from(venueEdgeCredentials)
        .where(
          and(eq(venueEdgeCredentials.edgeId, edgeId), eq(venueEdgeCredentials.tokenId, tokenId)),
        )
        .get()) ?? null
    );
  }
  async touchCredential(edgeId: string, tokenId: string, usedAt: string) {
    await this.database
      .prepare(
        "UPDATE venue_edge_credentials SET last_used_at = ? WHERE edge_id = ? AND token_id = ?",
      )
      .bind(usedAt, edgeId, tokenId)
      .run();
  }
  async rotateCredential({
    edgeId,
    previousExpiresAt,
    credential,
  }: Parameters<VenueEdgeRepository["rotateCredential"]>[0]) {
    const result = await this.database.batch([
      this.database
        .prepare(
          "UPDATE venue_edge_credentials SET expires_at = ? WHERE edge_id = ? AND status = 'active' AND expires_at > ?",
        )
        .bind(previousExpiresAt, edgeId, previousExpiresAt),
      this.database
        .prepare(
          "INSERT INTO venue_edge_credentials (edge_id, token_id, token_hash, status, created_at, expires_at, last_used_at, revoked_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM venue_edges WHERE id = ? AND status = 'active')",
        )
        .bind(
          credential.edgeId,
          credential.tokenId,
          credential.tokenHash,
          credential.status,
          credential.createdAt,
          credential.expiresAt,
          credential.lastUsedAt,
          credential.revokedAt,
          edgeId,
        ),
    ]);
    return result[1]?.meta.changes === 1;
  }
  async revokeEdge(edgeId: string, revokedAt: string) {
    const [edge] = await this.database.batch([
      this.database
        .prepare(
          "UPDATE venue_edges SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'",
        )
        .bind(revokedAt, edgeId),
      this.database
        .prepare(
          "UPDATE venue_edge_credentials SET status = 'revoked', revoked_at = ? WHERE edge_id = ? AND status = 'active'",
        )
        .bind(revokedAt, edgeId),
      this.database
        .prepare(
          "UPDATE session_edge_assignments SET released_at = ? WHERE edge_id = ? AND released_at IS NULL",
        )
        .bind(revokedAt, edgeId),
    ]);
    return edge?.meta.changes === 1;
  }
  async register(edgeId: string, update: EdgeRegistration) {
    const result = await this.database
      .prepare(
        "UPDATE venue_edges SET runtime_version = ?, protocol_version = ?, capacity = ?, local_endpoint = ?, certificate_fingerprint = ?, health = ?, registered_at = COALESCE(registered_at, ?), last_seen_at = ? WHERE id = ? AND status = 'active'",
      )
      .bind(
        update.runtimeVersion,
        update.protocolVersion,
        update.capacity,
        update.localEndpoint,
        update.certificateFingerprint,
        update.health,
        update.observedAt,
        update.observedAt,
        edgeId,
      )
      .run();
    return result.meta.changes === 1;
  }
  async assign(input: AssignmentRequest) {
    const result = await this.database
      .prepare(
        "INSERT INTO session_edge_assignments (session_id, edge_id, assignment_epoch, presentation_revision, issued_at, lease_expires_at, released_at) SELECT ?, ?, COALESCE((SELECT MAX(assignment_epoch) + 1 FROM session_edge_assignments WHERE session_id = ?), 1), ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM presentation_sessions AS session JOIN presentations AS presentation ON presentation.id = session.presentation_id WHERE session.id = ? AND session.state != 'Ended' AND presentation.revision = ?) AND EXISTS (SELECT 1 FROM venue_edges WHERE id = ? AND status = 'active' AND protocol_version = 'v1' AND health = 'healthy' AND registered_at IS NOT NULL AND last_seen_at >= ? AND capacity > 0 AND local_endpoint IS NOT NULL AND certificate_fingerprint IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM session_edge_assignments WHERE session_id = ? AND released_at IS NULL AND lease_expires_at > ?) AND NOT EXISTS (SELECT 1 FROM session_edge_assignments WHERE edge_id = ? AND released_at IS NULL AND lease_expires_at > ?)",
      )
      .bind(
        input.sessionId,
        input.edgeId,
        input.sessionId,
        input.presentationRevision,
        input.issuedAt,
        input.leaseExpiresAt,
        input.sessionId,
        input.presentationRevision,
        input.edgeId,
        input.edgeHealthyAfter,
        input.sessionId,
        input.issuedAt,
        input.edgeId,
        input.issuedAt,
      )
      .run();
    return result.meta.changes === 1 ? this.currentAssignment(input.sessionId) : null;
  }
  async renew({ sessionId, edgeId, assignmentEpoch, now, leaseExpiresAt }: LeaseRequest) {
    const result = await this.database
      .prepare(
        "UPDATE session_edge_assignments SET lease_expires_at = ? WHERE session_id = ? AND edge_id = ? AND assignment_epoch = ? AND released_at IS NULL AND lease_expires_at > ? AND lease_expires_at < ? AND EXISTS (SELECT 1 FROM venue_edges WHERE id = ? AND status = 'active' AND protocol_version = 'v1' AND health = 'healthy') AND EXISTS (SELECT 1 FROM presentation_sessions WHERE id = ? AND state != 'Ended')",
      )
      .bind(
        leaseExpiresAt,
        sessionId,
        edgeId,
        assignmentEpoch,
        now,
        leaseExpiresAt,
        edgeId,
        sessionId,
      )
      .run();
    return result.meta.changes === 1 ? this.assignment(sessionId, assignmentEpoch) : null;
  }
  async release({ sessionId, edgeId, assignmentEpoch, now }: LeaseRequest) {
    const result = await this.database
      .prepare(
        "UPDATE session_edge_assignments SET released_at = ? WHERE session_id = ? AND edge_id = ? AND assignment_epoch = ? AND released_at IS NULL AND lease_expires_at > ?",
      )
      .bind(now, sessionId, edgeId, assignmentEpoch, now)
      .run();
    return result.meta.changes === 1;
  }
  async findActiveAssignment(sessionId: string, now: string, edgeHealthyAfter: string) {
    return (
      (await this.database
        .prepare(
          "SELECT assignment.session_id AS sessionId, assignment.edge_id AS edgeId, assignment.assignment_epoch AS assignmentEpoch, assignment.presentation_revision AS presentationRevision, assignment.issued_at AS issuedAt, assignment.lease_expires_at AS leaseExpiresAt, assignment.released_at AS releasedAt, edge.local_endpoint AS localEndpoint, edge.certificate_fingerprint AS certificateFingerprint FROM session_edge_assignments AS assignment JOIN venue_edges AS edge ON edge.id = assignment.edge_id JOIN presentation_sessions AS session ON session.id = assignment.session_id WHERE assignment.session_id = ? AND session.state != 'Ended' AND assignment.released_at IS NULL AND assignment.lease_expires_at > ? AND edge.status = 'active' AND edge.protocol_version = 'v1' AND edge.health = 'healthy' AND edge.registered_at IS NOT NULL AND edge.last_seen_at >= ? AND edge.local_endpoint IS NOT NULL AND edge.certificate_fingerprint IS NOT NULL ORDER BY assignment.assignment_epoch DESC LIMIT 1",
        )
        .bind(sessionId, now, edgeHealthyAfter)
        .first<ActiveEdgeSessionAssignment>()) ?? null
    );
  }
  private async currentAssignment(sessionId: string) {
    return (
      (await this.db
        .select()
        .from(sessionEdgeAssignments)
        .where(eq(sessionEdgeAssignments.sessionId, sessionId))
        .orderBy(desc(sessionEdgeAssignments.assignmentEpoch))
        .get()) ?? null
    );
  }
  private async assignment(sessionId: string, assignmentEpoch: number) {
    return (
      (await this.db
        .select()
        .from(sessionEdgeAssignments)
        .where(
          and(
            eq(sessionEdgeAssignments.sessionId, sessionId),
            eq(sessionEdgeAssignments.assignmentEpoch, assignmentEpoch),
          ),
        )
        .get()) ?? null
    );
  }
}
