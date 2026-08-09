import { applyD1Migrations, env } from "cloudflare:test";
import migration from "../migrations/0001_presentations.sql?raw";
import authMigration from "../migrations/0002_better_auth.sql?raw";
import assetMigration from "../migrations/0003_assets.sql?raw";
import assetExpiryIndexMigration from "../migrations/0004_assets_expiry_index.sql?raw";

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
]);
