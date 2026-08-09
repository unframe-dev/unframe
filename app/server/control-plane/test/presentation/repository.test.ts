import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { D1PresentationRepository } from "../../src/presentation/repository";
import { definition } from "./schema.test";
import type { PresentationDefinition } from "../../src/presentation/schema";

describe("D1 presentation migration", () => {
  it("creates the presentation tables in an empty database", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    expect(tables.results.map((table: { name: string }) => table.name)).toEqual(
      expect.arrayContaining(["presentation_members", "presentations"]),
    );
    const repository = new D1PresentationRepository(env.DB);
    await expect(repository.findById("missing")).resolves.toBeNull();
  });

  it("persists and compares a revision", async () => {
    const repository = new D1PresentationRepository(env.DB);
    const value = { ...definition, assets: [] } as unknown as PresentationDefinition;
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind("owner", "Owner", "owner@example.test", 1, "2026-01-01", "2026-01-01")
      .run();
    await repository.create({
      id: "persisted",
      ownerId: "owner",
      revision: 1,
      definition: value,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(repository.roleFor("persisted", "owner")).resolves.toBe("owner");
    await expect(
      repository.replace("persisted", 2, value, "2026-01-02T00:00:00.000Z"),
    ).resolves.toBeNull();
    await expect(
      repository.replace("persisted", 1, value, "2026-01-02T00:00:00.000Z"),
    ).resolves.toMatchObject({ revision: 2 });
  });

  it("rejects owners and members that do not exist in the auth user table", async () => {
    const repository = new D1PresentationRepository(env.DB);
    const value = { ...definition, assets: [] } as unknown as PresentationDefinition;
    await expect(
      repository.create({
        id: `invalid-${crypto.randomUUID()}`,
        ownerId: "missing-user",
        revision: 1,
        definition: value,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      }),
    ).rejects.toThrow();
  });

  it("synchronizes asset references only when the expected revision is updated", async () => {
    const suffix = crypto.randomUUID();
    const presentationId = `presentation-${suffix}`;
    const ownerId = `owner-${suffix}`;
    const assetId = `asset-${suffix}`;
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(ownerId, "Owner", `${suffix}@example.test`, 1, "2026-01-01", "2026-01-01")
      .run();
    const repository = new D1PresentationRepository(env.DB);
    const empty = { ...definition, assets: [] } as unknown as PresentationDefinition;
    await repository.create({
      id: presentationId,
      ownerId,
      revision: 1,
      definition: empty,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    await env.DB.prepare(
      "INSERT INTO assets (id, owner_id, presentation_id, name, media_type, size_bytes, sha256_hex, object_key, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        assetId,
        ownerId,
        presentationId,
        "image",
        "image/png",
        8,
        "a".repeat(64),
        `assets/${suffix}`,
        "ready",
        "2026-01-01",
        "2026-01-01",
        "2026-01-01",
      )
      .run();
    const referenced = {
      ...definition,
      assets: [{ assetId }],
    } as unknown as PresentationDefinition;
    await expect(
      repository.replace(presentationId, 1, referenced, "2026-01-02"),
    ).resolves.toMatchObject({ revision: 2 });
    await expect(
      env.DB.prepare("SELECT asset_id FROM presentation_asset_refs WHERE presentation_id = ?")
        .bind(presentationId)
        .first<{ asset_id: string }>(),
    ).resolves.toMatchObject({ asset_id: assetId });
    await expect(repository.replace(presentationId, 1, empty, "2026-01-03")).resolves.toBeNull();
    await expect(
      env.DB.prepare("SELECT asset_id FROM presentation_asset_refs WHERE presentation_id = ?")
        .bind(presentationId)
        .first<{ asset_id: string }>(),
    ).resolves.toMatchObject({ asset_id: assetId });
    await expect(repository.delete(presentationId, 2)).resolves.toBe(false);
    await expect(repository.findById(presentationId)).resolves.toMatchObject({
      id: presentationId,
    });
  });

  it("rejects invalid asset references without raising a trigger error", async () => {
    const suffix = crypto.randomUUID();
    const presentationId = `presentation-${suffix}`;
    const ownerId = `owner-${suffix}`;
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(ownerId, "Owner", `${suffix}@example.test`, 1, "2026-01-01", "2026-01-01")
      .run();
    const repository = new D1PresentationRepository(env.DB);
    const empty = { ...definition, assets: [] } as unknown as PresentationDefinition;
    await repository.create({
      id: presentationId,
      ownerId,
      revision: 1,
      definition: empty,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    const invalid = {
      ...definition,
      assets: [{ assetId: "missing-asset" }],
    } as unknown as PresentationDefinition;
    await expect(
      repository.hasValidAssetReferences(presentationId, ["missing-asset"]),
    ).resolves.toBe(false);
    await expect(repository.replace(presentationId, 1, invalid, "2026-01-02")).resolves.toBeNull();
    await expect(repository.findById(presentationId)).resolves.toMatchObject({ revision: 1 });
  });
});
