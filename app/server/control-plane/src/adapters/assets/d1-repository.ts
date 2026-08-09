import type { AssetMediaType } from "../../modules/assets/schema";
import type { AssetRecord, AssetRepository } from "../../modules/assets/service";

type Row = Omit<
  AssetRecord,
  "mediaType" | "sizeBytes" | "sha256Hex" | "objectKey" | "expiresAt" | "createdAt" | "updatedAt"
> & {
  media_type: AssetMediaType;
  size_bytes: number;
  sha256_hex: string;
  object_key: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

const record = (row: Row): AssetRecord => ({
  id: row.id,
  ownerId: row.ownerId,
  presentationId: row.presentationId,
  name: row.name,
  mediaType: row.media_type,
  sizeBytes: row.size_bytes,
  sha256Hex: row.sha256_hex,
  objectKey: row.object_key,
  status: row.status,
  expiresAt: row.expires_at,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export class D1AssetRepository implements AssetRepository {
  constructor(private readonly database: D1Database) {}
  async create(value: AssetRecord) {
    await this.database
      .prepare(
        "INSERT INTO assets (id, owner_id, presentation_id, name, media_type, size_bytes, sha256_hex, object_key, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        value.id,
        value.ownerId,
        value.presentationId,
        value.name,
        value.mediaType,
        value.sizeBytes,
        value.sha256Hex,
        value.objectKey,
        value.status,
        value.expiresAt,
        value.createdAt.toISOString(),
        value.updatedAt.toISOString(),
      )
      .run();
  }
  async findById(id: string) {
    const value = await this.database
      .prepare(
        "SELECT id, owner_id AS ownerId, presentation_id AS presentationId, name, media_type, size_bytes, sha256_hex, object_key, status, expires_at, created_at, updated_at FROM assets WHERE id = ?",
      )
      .bind(id)
      .first<Row>();
    return value ? record(value) : null;
  }
  async save(value: AssetRecord) {
    const result = await this.database
      .prepare("UPDATE assets SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .bind(value.status, value.updatedAt.toISOString(), value.id)
      .run();
    return result.meta.changes === 1;
  }
  async deleteClaimed(id: string) {
    await this.database
      .prepare("DELETE FROM assets WHERE id = ? AND status = 'deleting'")
      .bind(id)
      .run();
  }
  async claimDeletion(id: string, statuses: readonly AssetRecord["status"][]) {
    if (statuses.length === 0) return null;
    const placeholders = statuses.map(() => "?").join(", ");
    const value = await this.database
      .prepare(
        `UPDATE assets SET status = 'deleting' WHERE id = ? AND status IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM presentation_asset_refs WHERE asset_id = assets.id) RETURNING id, owner_id AS ownerId, presentation_id AS presentationId, name, media_type, size_bytes, sha256_hex, object_key, status, expires_at, created_at, updated_at`,
      )
      .bind(id, ...statuses)
      .first<Row>();
    return value ? record(value) : null;
  }
  async isReferenced(id: string) {
    return Boolean(
      await this.database
        .prepare("SELECT 1 AS present FROM presentation_asset_refs WHERE asset_id = ? LIMIT 1")
        .bind(id)
        .first<{ present: number }>(),
    );
  }
  async findExpiredUnfinalized(before: Date) {
    const values = await this.database
      .prepare(
        "SELECT id, owner_id AS ownerId, presentation_id AS presentationId, name, media_type, size_bytes, sha256_hex, object_key, status, expires_at, created_at, updated_at FROM assets WHERE status IN ('pending', 'failed', 'deleting') AND created_at < ?",
      )
      .bind(before.toISOString())
      .all<Row>();
    return values.results.map(record);
  }
}
