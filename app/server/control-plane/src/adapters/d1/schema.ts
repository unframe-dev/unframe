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
