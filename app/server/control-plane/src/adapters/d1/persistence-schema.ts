import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const sessionCheckpoints = sqliteTable(
  "session_checkpoints",
  {
    sessionId: text("session_id").notNull(),
    version: integer().notNull(),
    lastSequence: integer("last_sequence").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: text().notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.version] }),
    unique().on(table.sessionId, table.idempotencyKey),
  ],
);

export const sessionCompletions = sqliteTable(
  "session_completions",
  {
    sessionId: text("session_id").primaryKey(),
    checkpointVersion: integer("checkpoint_version").notNull(),
    lastSequence: integer("last_sequence").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at").notNull(),
    participantCount: integer("participant_count").notNull(),
    participants: text().notNull(),
    finalState: text("final_state").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [unique().on(table.sessionId, table.idempotencyKey)],
);
