import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authUsers = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
  emailVerified: integer().notNull(),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
});

export const anonymousViewerCredentials = sqliteTable("anonymous_viewer_credentials", {
  userId: text("user_id").primaryKey(),
  sessionId: text("session_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  renewableUntil: text("renewable_until").notNull(),
  revokedAt: text("revoked_at"),
});

export const authSessions = sqliteTable("session", {
  id: text().primaryKey(),
  expiresAt: integer().notNull(),
  token: text().notNull(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
  ipAddress: text(),
  userAgent: text(),
  userId: text().notNull(),
  assurance: text().notNull(),
});

export const authVerifications = sqliteTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer().notNull(),
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
});

export const authDeviceCodes = sqliteTable("deviceCode", {
  id: text().primaryKey(),
  deviceCode: text().notNull(),
  userCode: text().notNull(),
  userId: text(),
  expiresAt: integer().notNull(),
  status: text().notNull(),
  lastPolledAt: integer(),
  pollingInterval: integer(),
  clientId: text(),
  scope: text(),
});
