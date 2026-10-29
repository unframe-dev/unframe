import { env } from "cloudflare:test";

export const seedCloudHost = (runtimeId: string, endpoint: string) =>
  env.DB.prepare(
    "INSERT OR IGNORE INTO runtime_hosts (runtime_id, endpoint, accepting, last_seen_at, boot_id, boot_started_at, generation, capacity) VALUES (?, ?, 1, '2099', 'boot', '2026', 1, 2)",
  )
    .bind(runtimeId, endpoint)
    .run();
