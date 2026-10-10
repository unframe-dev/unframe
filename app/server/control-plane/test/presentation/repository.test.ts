import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PresentationService } from "../../src/presentation/service";
import { D1PresentationRepository } from "../../src/presentation/repository";
import { definition } from "./schema.test";
import type { PresentationDefinition } from "../../src/presentation/schema";

describe("D1 presentation migration", () => {
  it("registers null draft metadata atomically and does not grant access on a local ID collision", async () => {
    const suffix = crypto.randomUUID();
    const firstUser = `registration-first-${suffix}`;
    const secondUser = `registration-second-${suffix}`;
    for (const userId of [firstUser, secondUser])
      await env.DB.prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, '2026', '2026')",
      )
        .bind(userId, `${userId}@example.test`)
        .run();
    const repository = new D1PresentationRepository(env.DB);
    const service = new PresentationService(repository, () => "2026");
    const id = `local-${suffix}`;
    const outcomes = await Promise.allSettled([
      service.create({ userId: firstUser, globalRole: "user" }, { id, name: "First" }),
      service.create({ userId: secondUser, globalRole: "user" }, { id, name: "Second" }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "forbidden" }) }),
    ]);
    const registered = await repository.findById(id);
    expect(registered).toMatchObject({ id, revision: 1, definition: null });
    const members = await env.DB.prepare(
      "SELECT user_id FROM presentation_members WHERE presentation_id = ?",
    )
      .bind(id)
      .all<{ user_id: string }>();
    expect(members.results).toEqual([{ user_id: registered!.ownerId }]);
    expect(
      await service.create(
        { userId: registered!.ownerId, globalRole: "user" },
        { id, name: "Renamed" },
      ),
    ).toMatchObject({ name: registered!.name, definition: null });
  });

  it("locks draft replacement and deletion while a session uses the presentation", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-lock-${suffix}`;
    const presentationId = `presentation-lock-${suffix}`;
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, '2026', '2026')",
    )
      .bind(ownerId, `${ownerId}@example.test`)
      .run();
    const repository = new D1PresentationRepository(env.DB);
    const value = { ...definition, assets: [] } as unknown as PresentationDefinition;
    await repository.create({
      id: presentationId,
      ownerId,
      revision: 1,
      name: value.metadata.title,
      definition: value,
      createdAt: "2026",
      updatedAt: "2026",
    });
    await env.DB.prepare(
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, created_at) VALUES (?, ?, ?, ?, 'Waiting', '2026')",
    )
      .bind(`session-${suffix}`, presentationId, ownerId, `hash-${suffix}`)
      .run();
    await expect(repository.replace(presentationId, 1, value, "2027")).resolves.toBeNull();
    await expect(repository.delete(presentationId, 1)).resolves.toBe(false);
    await env.DB.prepare("UPDATE presentation_sessions SET state = 'Ended' WHERE id = ?")
      .bind(`session-${suffix}`)
      .run();
    await expect(repository.replace(presentationId, 1, value, "2027")).resolves.toMatchObject({
      revision: 2,
    });
  });
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
      name: value.metadata.title,
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

  it("lists only presentations available to a member in newest-first order", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const memberId = `member-${suffix}`;
    const repository = new D1PresentationRepository(env.DB);
    const value = { ...definition, assets: [] } as unknown as PresentationDefinition;
    for (const id of [ownerId, memberId]) {
      await env.DB.prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(id, "User", `${id}@example.test`, 1, "2026-01-01", "2026-01-01")
        .run();
    }
    await repository.create({
      id: `older-${suffix}`,
      ownerId,
      revision: 1,
      name: value.metadata.title,
      definition: value,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repository.create({
      id: `newer-${suffix}`,
      ownerId,
      revision: 1,
      name: value.metadata.title,
      definition: value,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    await env.DB.prepare(
      "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES (?, ?, 'editor')",
    )
      .bind(`older-${suffix}`, memberId)
      .run();

    await expect(repository.listByUser(memberId)).resolves.toEqual([
      expect.objectContaining({ id: `older-${suffix}`, ownerId }),
    ]);
    const listed = await repository.listAll();
    expect(listed.filter(({ id }) => id.endsWith(suffix)).map(({ id }) => id)).toEqual([
      `newer-${suffix}`,
      `older-${suffix}`,
    ]);
  });

  it("rejects owners and members that do not exist in the auth user table", async () => {
    const repository = new D1PresentationRepository(env.DB);
    const value = { ...definition, assets: [] } as unknown as PresentationDefinition;
    await expect(
      repository.create({
        id: `invalid-${crypto.randomUUID()}`,
        ownerId: "missing-user",
        revision: 1,
        name: value.metadata.title,
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
      name: empty.metadata.title,
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
      name: empty.metadata.title,
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
