import type { D1Database } from "@cloudflare/workers-types";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { createD1Database } from "../../adapters/d1/database";
import { runtimeAssignments, venueEdgeCredentials, venueEdges } from "../../adapters/d1/schema";

export type VenueEdgeRecord = {
  id: string;
  runtimeId: string | null;
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
export type EdgeRegistration = {
  runtimeId: string;
  runtimeVersion: string;
  protocolVersion: "v3";
  capacity: number;
  localEndpoint: string;
  certificateFingerprint: string;
  health: string;
  observedAt: string;
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
    await this.db
      .update(venueEdgeCredentials)
      .set({ lastUsedAt: usedAt })
      .where(
        and(eq(venueEdgeCredentials.edgeId, edgeId), eq(venueEdgeCredentials.tokenId, tokenId)),
      )
      .run();
  }
  async rotateCredential({
    edgeId,
    previousExpiresAt,
    credential,
  }: Parameters<VenueEdgeRepository["rotateCredential"]>[0]) {
    const expiry = this.db
      .update(venueEdgeCredentials)
      .set({ expiresAt: previousExpiresAt })
      .where(
        and(
          eq(venueEdgeCredentials.edgeId, edgeId),
          eq(venueEdgeCredentials.status, "active"),
          gt(venueEdgeCredentials.expiresAt, previousExpiresAt),
        ),
      );
    const replacement = this.db.insert(venueEdgeCredentials).select(
      this.db
        .select({
          edgeId: sql<string>`${credential.edgeId}`.as("edgeId"),
          tokenId: sql<string>`${credential.tokenId}`.as("tokenId"),
          tokenHash: sql<string>`${credential.tokenHash}`.as("tokenHash"),
          status: sql<VenueEdgeCredentialRecord["status"]>`${credential.status}`.as("status"),
          createdAt: sql<string>`${credential.createdAt}`.as("createdAt"),
          expiresAt: sql<string>`${credential.expiresAt}`.as("expiresAt"),
          lastUsedAt: sql<string | null>`${credential.lastUsedAt}`.as("lastUsedAt"),
          revokedAt: sql<string | null>`${credential.revokedAt}`.as("revokedAt"),
        })
        .from(venueEdges)
        .where(and(eq(venueEdges.id, edgeId), eq(venueEdges.status, "active"))),
    );
    const result = await this.db.batch([expiry, replacement]);
    return result[1]?.meta.changes === 1;
  }
  async revokeEdge(edgeId: string, revokedAt: string) {
    const [edge] = await this.db.batch([
      this.db
        .update(venueEdges)
        .set({ status: "revoked", revokedAt })
        .where(and(eq(venueEdges.id, edgeId), eq(venueEdges.status, "active"))),
      this.db
        .update(venueEdgeCredentials)
        .set({ status: "revoked", revokedAt })
        .where(
          and(eq(venueEdgeCredentials.edgeId, edgeId), eq(venueEdgeCredentials.status, "active")),
        ),
      this.db
        .update(runtimeAssignments)
        .set({ releasedAt: revokedAt })
        .where(
          and(
            eq(runtimeAssignments.provisioningEdgeId, edgeId),
            isNull(runtimeAssignments.releasedAt),
          ),
        ),
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
