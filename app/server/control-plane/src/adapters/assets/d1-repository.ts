import { and, eq, inArray, lt } from "drizzle-orm";

import { createD1Database } from "../d1/database";
import { assets, presentationAssetRefs } from "../d1/schema";
import type { AssetRecord, AssetRepository } from "../../modules/assets/service";

type Row = typeof assets.$inferSelect;

const record = (row: Row): AssetRecord => ({
  id: row.id,
  ownerId: row.ownerId,
  presentationId: row.presentationId,
  name: row.name,
  mediaType: row.mediaType,
  sizeBytes: row.sizeBytes,
  sha256Hex: row.sha256Hex,
  objectKey: row.objectKey,
  status: row.status,
  expiresAt: row.expiresAt,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});

export class D1AssetRepository implements AssetRepository {
  private readonly db;

  constructor(private readonly database: D1Database) {
    this.db = createD1Database(database);
  }

  async create(value: AssetRecord) {
    await this.db
      .insert(assets)
      .values({
        ...value,
        expiresAt: value.expiresAt,
        createdAt: value.createdAt.toISOString(),
        updatedAt: value.updatedAt.toISOString(),
      })
      .run();
  }

  async findById(id: string) {
    const value = await this.db.select().from(assets).where(eq(assets.id, id)).get();
    return value ? record(value) : null;
  }

  async findByObjectKey(objectKey: string) {
    const value = await this.db.select().from(assets).where(eq(assets.objectKey, objectKey)).get();
    return value ? record(value) : null;
  }

  async save(value: AssetRecord) {
    const result = await this.database
      .prepare(`
        UPDATE assets
        SET status = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .bind(value.status, value.updatedAt.toISOString(), value.id)
      .run();
    return result.meta.changes === 1;
  }

  async deleteClaimed(id: string) {
    await this.db
      .delete(assets)
      .where(and(eq(assets.id, id), eq(assets.status, "deleting")))
      .run();
  }

  async claimDeletion(id: string, statuses: readonly AssetRecord["status"][]) {
    if (statuses.length === 0) {
      return null;
    }
    const placeholders = statuses.map(() => "?").join(", ");
    const value = await this.database
      .prepare(
        `
          UPDATE assets
          SET status = 'deleting'
          WHERE id = ?
            AND status IN (${placeholders})
            AND NOT EXISTS (
              SELECT 1
              FROM presentation_asset_refs
              WHERE asset_id = assets.id
            )
          RETURNING
            id,
            owner_id AS ownerId,
            presentation_id AS presentationId,
            name,
            media_type AS mediaType,
            size_bytes AS sizeBytes,
            sha256_hex AS sha256Hex,
            object_key AS objectKey,
            status,
            expires_at AS expiresAt,
            created_at AS createdAt,
            updated_at AS updatedAt
        `,
      )
      .bind(id, ...statuses)
      .first<Row>();
    return value ? record(value) : null;
  }

  async isReferenced(id: string) {
    return Boolean(
      await this.db
        .select({ assetId: presentationAssetRefs.assetId })
        .from(presentationAssetRefs)
        .where(eq(presentationAssetRefs.assetId, id))
        .limit(1)
        .get(),
    );
  }

  async findExpiredUnfinalized(before: Date) {
    const values = await this.db
      .select()
      .from(assets)
      .where(
        and(
          inArray(assets.status, ["pending", "failed", "deleting"]),
          lt(assets.expiresAt, before.toISOString()),
        ),
      );
    return values.map(record);
  }
}
