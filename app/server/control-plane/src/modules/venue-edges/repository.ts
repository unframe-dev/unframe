import { and, eq } from "drizzle-orm";

import { createD1Database } from "../../adapters/d1/database";
import { venueEdgeCredentials, venueEdges } from "../../adapters/d1/schema";

export type VenueEdgeRecord = {
  capacity: number | null;
  certificateFingerprint: string | null;
  createdAt: string;
  health: string | null;
  id: string;
  lastSeenAt: string;
  localEndpoint: string | null;
  protocolVersion: string | null;
  registeredAt: string | null;
  revokedAt: string | null;
  runtimeId: string | null;
  runtimeVersion: string | null;
  status: "active" | "revoked";
};
export type VenueEdgeCredentialRecord = {
  createdAt: string;
  edgeId: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
  tokenHash: string;
  tokenId: string;
};
export type EdgeRegistration = {
  capacity: number;
  certificateFingerprint: string;
  health: string;
  localEndpoint: string;
  observedAt: string;
  protocolVersion: string;
  runtimeId: string;
  runtimeVersion: string;
};
export interface VenueEdgeRepository {
  createEdge(edge: VenueEdgeRecord, credential: VenueEdgeCredentialRecord): Promise<void>;
  findCredential(edgeId: string, tokenId: string): Promise<VenueEdgeCredentialRecord | null>;
  findEdge(id: string): Promise<VenueEdgeRecord | null>;
  register(edgeId: string, update: EdgeRegistration): Promise<boolean>;
  revokeEdge(edgeId: string, revokedAt: string): Promise<boolean>;
  rotateCredential(input: {
    credential: VenueEdgeCredentialRecord;
    edgeId: string;
    previousExpiresAt: string;
  }): Promise<boolean>;
  touchCredential(edgeId: string, tokenId: string, usedAt: string): Promise<void>;
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
    credential,
    edgeId,
    previousExpiresAt,
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
          "UPDATE runtime_assignments SET released_at = ? WHERE provisioning_edge_id = ? AND released_at IS NULL",
        )
        .bind(revokedAt, edgeId),
    ]);
    return edge?.meta.changes === 1;
  }
  async register(edgeId: string, update: EdgeRegistration) {
    const result = await this.database
      .prepare(
        "UPDATE venue_edges SET runtime_id = ?, runtime_version = ?, protocol_version = ?, capacity = ?, local_endpoint = ?, certificate_fingerprint = ?, health = ?, registered_at = COALESCE(registered_at, ?), last_seen_at = ? WHERE id = ? AND status = 'active' AND (runtime_id IS NULL OR runtime_id = ?) AND NOT EXISTS (SELECT 1 FROM venue_edges AS registered WHERE registered.runtime_id = ? AND registered.id != ?)",
      )
      .bind(
        update.runtimeId,
        update.runtimeVersion,
        update.protocolVersion,
        update.capacity,
        update.localEndpoint,
        update.certificateFingerprint,
        update.health,
        update.observedAt,
        update.observedAt,
        edgeId,
        update.runtimeId,
        update.runtimeId,
        edgeId,
      )
      .run();
    return result.meta.changes === 1;
  }
}
