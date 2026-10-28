import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const presentationBuilds = sqliteTable(
  "presentation_builds",
  {
    presentationId: text("presentation_id").notNull(),
    buildId: text("build_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    artifacts: text().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.presentationId, table.buildId] })],
);

export const presentationPublications = sqliteTable(
  "presentation_publications",
  {
    presentationId: text("presentation_id").notNull(),
    epoch: integer().notNull(),
    buildId: text("build_id").notNull(),
    manifest: text().notNull(),
    publishedAt: text("published_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.presentationId, table.epoch] })],
);

export const sessionParticipantCapabilities = sqliteTable(
  "session_participant_capabilities",
  {
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    capabilityProfileId: text("capability_profile_id").notNull(),
    capabilityJson: text("capability_json").notNull(),
    projectionProfileId: text("projection_profile_id").notNull(),
    selectedAt: text("selected_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })],
);
