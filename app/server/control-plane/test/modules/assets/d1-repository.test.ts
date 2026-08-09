import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { D1AssetRepository } from "../../../src/adapters/assets/d1-repository";
import type { AssetRecord } from "../../../src/modules/assets/service";

const asset = (
  suffix: string,
  status: AssetRecord["status"] = "pending",
  createdAt = "2026-01-01T00:00:00.000Z",
): AssetRecord => ({
  id: `asset-${suffix}`,
  ownerId: `owner-${suffix}`,
  presentationId: `presentation-${suffix}`,
  name: "image.png",
  mediaType: "image/png",
  sizeBytes: 8,
  sha256Hex: "a".repeat(64),
  objectKey: `assets/${suffix}`,
  status,
  expiresAt: "2026-01-01T00:10:00.000Z",
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
});
async function persistOwnerAndPresentation(value: AssetRecord) {
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(value.ownerId, "Owner", `${value.ownerId}@example.test`, 1, "2026-01-01", "2026-01-01")
    .run();
  await env.DB.prepare(
    "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      value.presentationId,
      value.ownerId,
      1,
      JSON.stringify({ metadata: { title: "Test" }, slides: [], assets: [] }),
      "2026-01-01",
      "2026-01-01",
    )
    .run();
}

describe("D1AssetRepository", () => {
  it("creates and finds asset records", async () => {
    const value = asset(crypto.randomUUID());
    await persistOwnerAndPresentation(value);
    const repository = new D1AssetRepository(env.DB);
    await repository.create(value);
    await expect(repository.findById(value.id)).resolves.toEqual(value);
  });

  it("uses a pending-only compare-and-set so ready and failed states are terminal", async () => {
    const ready = asset(crypto.randomUUID());
    await persistOwnerAndPresentation(ready);
    const repository = new D1AssetRepository(env.DB);
    await repository.create(ready);
    expect(
      await repository.save({
        ...ready,
        status: "ready",
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      await repository.save({
        ...ready,
        status: "failed",
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
    ).toBe(false);
    expect((await repository.findById(ready.id))?.status).toBe("ready");
  });

  it("atomically claims only unreferenced eligible assets for deletion", async () => {
    const suffix = crypto.randomUUID();
    const pending = asset(`${suffix}-pending`);
    const ready = asset(`${suffix}-ready`, "ready");
    for (const value of [pending, ready]) await persistOwnerAndPresentation(value);
    const repository = new D1AssetRepository(env.DB);
    await repository.create(pending);
    await repository.create(ready);
    await env.DB.prepare(
      "INSERT INTO presentation_asset_refs (presentation_id, asset_id) VALUES (?, ?)",
    )
      .bind(ready.presentationId, ready.id)
      .run();
    await expect(
      repository.claimDeletion(pending.id, ["pending", "failed", "deleting"]),
    ).resolves.toMatchObject({ id: pending.id, status: "deleting" });
    await expect(
      env.DB.prepare(
        "INSERT INTO presentation_asset_refs (presentation_id, asset_id) VALUES (?, ?)",
      )
        .bind(pending.presentationId, pending.id)
        .run(),
    ).rejects.toThrow("presentation asset must be ready");
    await expect(repository.claimDeletion(ready.id, ["ready"])).resolves.toBeNull();
    await expect(repository.findById(ready.id)).resolves.toMatchObject({ status: "ready" });
  });

  it("deletes records, reports references, and finds only expired unfinalized assets", async () => {
    const suffix = crypto.randomUUID();
    const oldPending = asset(`${suffix}-pending`, "pending", "2025-12-31T23:59:59.999Z");
    const oldFailed = asset(`${suffix}-failed`, "failed", "2025-12-31T23:59:59.999Z");
    const ready = asset(`${suffix}-ready`, "ready", "2025-12-31T23:59:59.999Z");
    for (const value of [oldPending, oldFailed, ready]) {
      await persistOwnerAndPresentation(value);
    }
    const repository = new D1AssetRepository(env.DB);
    for (const value of [oldPending, oldFailed, ready]) await repository.create(value);
    await env.DB.prepare(
      "INSERT INTO presentation_asset_refs (presentation_id, asset_id) VALUES (?, ?)",
    )
      .bind(ready.presentationId, ready.id)
      .run();
    await expect(repository.isReferenced(ready.id)).resolves.toBe(true);
    await expect(
      repository.findExpiredUnfinalized(new Date("2026-01-01T00:00:00.000Z")),
    ).resolves.toEqual(expect.arrayContaining([oldPending, oldFailed]));
    expect(
      (await repository.findExpiredUnfinalized(new Date("2026-01-01T00:00:00.000Z"))).map(
        (value) => value.id,
      ),
    ).not.toContain(ready.id);
    await repository.claimDeletion(oldFailed.id, ["failed"]);
    await repository.deleteClaimed(oldFailed.id);
    await expect(repository.findById(oldFailed.id)).resolves.toBeNull();
  });
});
