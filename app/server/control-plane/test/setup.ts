import { applyD1Migrations, env } from "cloudflare:test";
import migration from "../migrations/0001_presentations.sql?raw";
import authMigration from "../migrations/0002_better_auth.sql?raw";
import assetMigration from "../migrations/0003_assets.sql?raw";
import assetExpiryIndexMigration from "../migrations/0004_assets_expiry_index.sql?raw";
import authPasswordResetMfaMigration from "../migrations/0005_auth_password_reset_mfa.sql?raw";
import sessionMigration from "../migrations/0006_sessions.sql?raw";
import persistenceMigration from "../migrations/0007_realtime_persistence.sql?raw";
import venueEdgesMigration from "../migrations/0008_venue_edges.sql?raw";
import runtimeAssignmentsMigration from "../migrations/0009_runtime_assignments.sql?raw";

const [assetTables, ...assetTriggers] = assetMigration.split("CREATE TRIGGER");

const foundationMigrations = [
  {
    name: "0001_presentations.sql",
    queries: migration
      .split(";")
      .map((query: string) => query.trim())
      .filter(Boolean),
  },
  {
    name: "0002_better_auth.sql",
    queries: authMigration
      .split(";")
      .map((query: string) => query.trim())
      .filter(Boolean),
  },
  {
    name: "0003_assets.sql",
    queries: [
      ...assetTables!
        .split(";")
        .map((query: string) => query.trim())
        .filter(Boolean),
      ...assetTriggers.map((trigger) => `CREATE TRIGGER${trigger}`),
    ],
  },
  {
    name: "0004_assets_expiry_index.sql",
    queries: assetExpiryIndexMigration
      .split(";")
      .map((query: string) => query.trim())
      .filter(Boolean),
  },
  {
    name: "0005_auth_password_reset_mfa.sql",
    queries: authPasswordResetMfaMigration
      .split(";")
      .map((query: string) => query.trim())
      .filter(Boolean),
  },
  {
    name: "0006_sessions.sql",
    queries: sessionMigration
      .split(";")
      .map((query: string) => query.trim())
      .filter(Boolean),
  },
  {
    name: "0007_realtime_persistence.sql",
    queries: persistenceMigration
      .split(";")
      .map((query: string) => query.trim())
      .filter(Boolean),
  },
  {
    name: "0008_venue_edges.sql",
    queries: venueEdgesMigration
      .split(";")
      .map((query: string) => query.trim())
      .filter(Boolean),
  },
];

await applyD1Migrations(env.DB, foundationMigrations);

await env.DB.batch([
  env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('migration-runtime-user', 'Migration User', 'migration-runtime@example.test', 1, '2026', '2026')",
  ),
  env.DB.prepare(
    "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES ('migration-runtime-presentation', 'migration-runtime-user', 1, '{\"groups\":[],\"assets\":[]}', '2026', '2026')",
  ),
  env.DB.prepare(
    "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES ('migration-runtime-session', 'migration-runtime-presentation', 'migration-runtime-user', 'migration-runtime-hash', 'Presenting', 1, 50, '2026')",
  ),
  env.DB.prepare(
    "INSERT INTO venue_edges (id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES ('migration-provisioning-edge', 'active', 'legacy', 'v1', 1, 'https://legacy-edge.example.test', 'sha256:legacy', 'healthy', '2026', '2026', '2026')",
  ),
  env.DB.prepare(
    "INSERT INTO session_edge_assignments (session_id, edge_id, assignment_epoch, presentation_revision, issued_at, lease_expires_at) VALUES ('migration-runtime-session', 'migration-provisioning-edge', 1, 1, '2026-08-20T00:00:00.000Z', '2099-08-20T00:00:00.000Z')",
  ),
]);

await applyD1Migrations(env.DB, [
  {
    name: "0009_runtime_assignments.sql",
    queries: runtimeAssignmentsMigration
      .split(";")
      .map((query: string) => query.trim())
      .filter(Boolean),
  },
]);
