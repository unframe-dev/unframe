import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Better Auth account issuer migration", () => {
  it("backfills the stable issuer for existing credential accounts", async () => {
    await expect(
      env.DB.prepare(
        "SELECT issuer FROM account WHERE id = 'migration-credential-account'",
      ).first(),
    ).resolves.toEqual({ issuer: "local:credential" });
  });

  it("enforces unique issuer and account ID pairs", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO account (id, issuer, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          "duplicate-migration-credential-account",
          "local:credential",
          "migration-runtime-user",
          "credential",
          "migration-runtime-user",
          "2026",
          "2026",
        )
        .run(),
    ).rejects.toThrow();
  });
});
