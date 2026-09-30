import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { AssetMediaType } from "../../modules/assets/schema";
import type { AssetRecord } from "../../modules/assets/service";
import type { PresentationDefinition } from "../../presentation/schema";

export const presentations = sqliteTable("presentations", {
  createdAt: text("created_at").notNull(),
  definition: text({ mode: "json" }).$type<PresentationDefinition>().notNull(),
  id: text().primaryKey(),
  ownerId: text("owner_id").notNull(),
  revision: integer().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const presentationMembers = sqliteTable(
  "presentation_members",
  {
    presentationId: text("presentation_id").notNull(),
    role: text().$type<"owner" | "editor">().notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.presentationId, table.userId] })],
);

export const assets = sqliteTable("assets", {
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  id: text().primaryKey(),
  mediaType: text("media_type").$type<AssetMediaType>().notNull(),
  name: text().notNull(),
  objectKey: text("object_key").notNull(),
  ownerId: text("owner_id").notNull(),
  presentationId: text("presentation_id").notNull(),
  sha256Hex: text("sha256_hex").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text().$type<AssetRecord["status"]>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const presentationAssetRefs = sqliteTable(
  "presentation_asset_refs",
  {
    assetId: text("asset_id").notNull(),
    presentationId: text("presentation_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.presentationId, table.assetId] })],
);

export const presentationSessions = sqliteTable("presentation_sessions", {
  createdAt: text("created_at").notNull(),
  endedAt: text("ended_at"),
  id: text().primaryKey(),
  joinCodeHash: text("join_code_hash").notNull(),
  maxParticipants: integer("max_participants").notNull(),
  participantCount: integer("participant_count").notNull(),
  presentationId: text("presentation_id").notNull(),
  presenterId: text("presenter_id").notNull(),
  state: text().$type<"Waiting" | "Presenting" | "Ended">().notNull(),
});

export const sessionParticipants = sqliteTable(
  "session_participants",
  {
    joinedAt: text("joined_at").notNull(),
    role: text().$type<"presenter" | "viewer">().notNull(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })],
);

export const sessionJoinAttempts = sqliteTable("session_join_attempts", {
  attemptedAt: integer("attempted_at").notNull(),
  codeHash: text("code_hash").notNull(),
  ipAddress: text("ip_address").notNull(),
  userId: text("user_id").notNull(),
});

export const venueEdges = sqliteTable("venue_edges", {
  capacity: integer(),
  certificateFingerprint: text("certificate_fingerprint"),
  createdAt: text("created_at").notNull(),
  health: text(),
  id: text().primaryKey(),
  lastSeenAt: text("last_seen_at").notNull(),
  localEndpoint: text("local_endpoint"),
  protocolVersion: text("protocol_version"),
  registeredAt: text("registered_at"),
  revokedAt: text("revoked_at"),
  runtimeId: text("runtime_id"),
  runtimeVersion: text("runtime_version"),
  status: text().$type<"active" | "revoked">().notNull(),
});

export const venueEdgeCredentials = sqliteTable(
  "venue_edge_credentials",
  {
    createdAt: text("created_at").notNull(),
    edgeId: text("edge_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    status: text().$type<"active" | "revoked">().notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenId: text("token_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.edgeId, table.tokenId] })],
);

export const runtimeAssignments = sqliteTable(
  "runtime_assignments",
  {
    certificateFingerprint: text("certificate_fingerprint"),
    endpoint: text().notNull(),
    epoch: integer().notNull(),
    issuedAt: text("issued_at").notNull(),
    leaseExpiresAt: text("lease_expires_at").notNull(),
    provisioningEdgeId: text("provisioning_edge_id"),
    releasedAt: text("released_at"),
    revision: integer().notNull(),
    runtimeId: text("runtime_id").notNull(),
    runtimeKind: text("runtime_kind").$type<"Cloud" | "VenueEdge">().notNull(),
    sessionId: text("session_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.epoch] })],
);
