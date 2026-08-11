import { applyD1Migrations, env } from "cloudflare:test";
import migration from "../migrations/0001_presentations.sql?raw";
import authMigration from "../migrations/0002_better_auth.sql?raw";
import assetMigration from "../migrations/0003_assets.sql?raw";
import assetExpiryIndexMigration from "../migrations/0004_assets_expiry_index.sql?raw";
import authPasswordResetMfaMigration from "../migrations/0005_auth_password_reset_mfa.sql?raw";
import sessionMigration from "../migrations/0006_sessions.sql?raw";
import persistenceMigration from "../migrations/0007_realtime_persistence.sql?raw";

const [assetTables, ...assetTriggers] = assetMigration.split("CREATE TRIGGER");

await applyD1Migrations(env.DB, [
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
]);
