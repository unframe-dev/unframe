import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { AssetMediaType } from "../../modules/assets/schema";
import type { AssetRecord } from "../../modules/assets/service";
import type { PresentationDefinition } from "../../presentation/schema";

export const presentations = sqliteTable("presentations", {
  id: text().primaryKey(),
  ownerId: text("owner_id").notNull(),
  revision: integer().notNull(),
  definition: text({ mode: "json" }).$type<PresentationDefinition>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const presentationMembers = sqliteTable(
  "presentation_members",
  {
    presentationId: text("presentation_id").notNull(),
    userId: text("user_id").notNull(),
    role: text().$type<"owner" | "editor">().notNull(),
  },
  (table) => [primaryKey({ columns: [table.presentationId, table.userId] })],
);

export const assets = sqliteTable("assets", {
  id: text().primaryKey(),
  ownerId: text("owner_id").notNull(),
  presentationId: text("presentation_id").notNull(),
  name: text().notNull(),
  mediaType: text("media_type").$type<AssetMediaType>().notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256Hex: text("sha256_hex").notNull(),
  objectKey: text("object_key").notNull(),
  status: text().$type<AssetRecord["status"]>().notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const presentationAssetRefs = sqliteTable(
  "presentation_asset_refs",
  {
    presentationId: text("presentation_id").notNull(),
    assetId: text("asset_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.presentationId, table.assetId] })],
);

export const presentationSessions = sqliteTable("presentation_sessions", {
  id: text().primaryKey(),
  presentationId: text("presentation_id").notNull(),
  presenterId: text("presenter_id").notNull(),
  joinCodeHash: text("join_code_hash").notNull(),
  state: text().$type<"Waiting" | "Presenting" | "Ended">().notNull(),
  participantCount: integer("participant_count").notNull(),
  maxParticipants: integer("max_participants").notNull(),
  createdAt: text("created_at").notNull(),
  endedAt: text("ended_at"),
});

export const sessionParticipants = sqliteTable(
  "session_participants",
  {
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    role: text().$type<"presenter" | "viewer">().notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })],
);

export const sessionJoinAttempts = sqliteTable("session_join_attempts", {
  codeHash: text("code_hash").notNull(),
  userId: text("user_id").notNull(),
  ipAddress: text("ip_address").notNull(),
  attemptedAt: integer("attempted_at").notNull(),
});

export const venueEdges = sqliteTable("venue_edges", {
  id: text().primaryKey(),
  runtimeId: text("runtime_id"),
  status: text().$type<"active" | "revoked">().notNull(),
  runtimeVersion: text("runtime_version"),
  protocolVersion: text("protocol_version"),
  capacity: integer(),
  localEndpoint: text("local_endpoint"),
  certificateFingerprint: text("certificate_fingerprint"),
  health: text(),
  registeredAt: text("registered_at"),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
});

export const venueEdgeCredentials = sqliteTable(
  "venue_edge_credentials",
  {
    edgeId: text("edge_id").notNull(),
    tokenId: text("token_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text().$type<"active" | "revoked">().notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [primaryKey({ columns: [table.edgeId, table.tokenId] })],
);

export const runtimeAssignments = sqliteTable(
  "runtime_assignments",
  {
    sessionId: text("session_id").notNull(),
    runtimeId: text("runtime_id").notNull(),
    runtimeKind: text("runtime_kind").$type<"Cloud" | "VenueEdge">().notNull(),
    endpoint: text().notNull(),
    certificateFingerprint: text("certificate_fingerprint"),
    provisioningEdgeId: text("provisioning_edge_id"),
    epoch: integer().notNull(),
    revision: integer().notNull(),
    issuedAt: text("issued_at").notNull(),
    leaseExpiresAt: text("lease_expires_at").notNull(),
    releasedAt: text("released_at"),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.epoch] })],
);
