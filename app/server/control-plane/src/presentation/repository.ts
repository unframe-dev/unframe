import type { PresentationDefinition } from "./schema";

export type PresentationRecord = {
  id: string;
  ownerId: string;
  revision: number;
  definition: PresentationDefinition;
  createdAt: string;
  updatedAt: string;
};

export type PresentationRepository = {
  create(record: PresentationRecord): Promise<void>;
  listAll(): Promise<PresentationRecord[]>;
  listByUser(userId: string): Promise<PresentationRecord[]>;
  findById(id: string): Promise<PresentationRecord | null>;
  roleFor(id: string, userId: string): Promise<"owner" | "editor" | null>;
  hasValidAssetReferences(id: string, assetIds: readonly string[]): Promise<boolean>;
  replace(
    id: string,
    expectedRevision: number,
    definition: PresentationDefinition,
    updatedAt: string,
  ): Promise<PresentationRecord | null>;
  delete(id: string, expectedRevision: number): Promise<boolean>;
};

export class D1PresentationRepository implements PresentationRepository {
  constructor(private readonly database: D1Database) {}

  async create(record: PresentationRecord) {
    await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          record.id,
          record.ownerId,
          record.revision,
          JSON.stringify(record.definition),
          record.createdAt,
          record.updatedAt,
        ),
      this.database
        .prepare(
          "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES (?, ?, 'owner')",
        )
        .bind(record.id, record.ownerId),
    ]);
  }

  async listByUser(userId: string) {
    const result = await this.database
      .prepare(
        "SELECT p.id, p.owner_id, p.revision, p.definition, p.created_at, p.updated_at FROM presentations p JOIN presentation_members m ON m.presentation_id = p.id WHERE m.user_id = ? ORDER BY p.created_at DESC",
      )
      .bind(userId)
      .all<StoredPresentation>();
    return result.results.map(toRecord);
  }

  async listAll() {
    const result = await this.database
      .prepare(
        "SELECT id, owner_id, revision, definition, created_at, updated_at FROM presentations ORDER BY created_at DESC",
      )
      .all<StoredPresentation>();
    return result.results.map(toRecord);
  }

  async findById(id: string) {
    const row = await this.database
      .prepare(
        "SELECT id, owner_id, revision, definition, created_at, updated_at FROM presentations WHERE id = ?",
      )
      .bind(id)
      .first<StoredPresentation>();
    return row ? toRecord(row) : null;
  }

  async roleFor(id: string, userId: string) {
    const row = await this.database
      .prepare("SELECT role FROM presentation_members WHERE presentation_id = ? AND user_id = ?")
      .bind(id, userId)
      .first<{ role: "owner" | "editor" }>();
    return row?.role ?? null;
  }

  async hasValidAssetReferences(id: string, assetIds: readonly string[]) {
    if (assetIds.length === 0) return true;
    const placeholders = assetIds.map(() => "?").join(", ");
    const row = await this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM assets WHERE presentation_id = ? AND status = 'ready' AND id IN (${placeholders})`,
      )
      .bind(id, ...assetIds)
      .first<{ count: number }>();
    return row?.count === new Set(assetIds).size;
  }

  async replace(
    id: string,
    expectedRevision: number,
    definition: PresentationDefinition,
    updatedAt: string,
  ) {
    const result = await this.database
      .prepare(
        "UPDATE presentations SET definition = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM json_each(?, '$.assets') refs LEFT JOIN assets ON assets.id = json_extract(refs.value, '$.assetId') AND assets.presentation_id = ? AND assets.status = 'ready' WHERE assets.id IS NULL) RETURNING id",
      )
      .bind(
        JSON.stringify(definition),
        updatedAt,
        id,
        expectedRevision,
        JSON.stringify(definition),
        id,
      )
      .all<{ id: string }>();
    return result.results.length === 1 ? this.findById(id) : null;
  }

  async delete(id: string, expectedRevision: number) {
    const result = await this.database
      .prepare(
        "DELETE FROM presentations WHERE id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM assets WHERE presentation_id = ?)",
      )
      .bind(id, expectedRevision, id)
      .run();
    return result.meta.changes === 1;
  }
}

type StoredPresentation = {
  id: string;
  owner_id: string;
  revision: number;
  definition: string;
  created_at: string;
  updated_at: string;
};
const toRecord = (row: StoredPresentation): PresentationRecord => ({
  id: row.id,
  ownerId: row.owner_id,
  revision: row.revision,
  definition: JSON.parse(row.definition) as PresentationDefinition,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
