import { and, count, desc, eq, inArray } from "drizzle-orm";

import { createD1Database } from "../adapters/d1/database";
import { assets, presentationMembers, presentations } from "../adapters/d1/schema";
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
  private readonly db;

  constructor(private readonly database: D1Database) {
    this.db = createD1Database(database);
  }

  async create(record: PresentationRecord) {
    await this.db.batch([
      this.db.insert(presentations).values(record),
      this.db.insert(presentationMembers).values({
        presentationId: record.id,
        userId: record.ownerId,
        role: "owner",
      }),
    ]);
  }

  async listByUser(userId: string) {
    return this.db
      .select({
        id: presentations.id,
        ownerId: presentations.ownerId,
        revision: presentations.revision,
        definition: presentations.definition,
        createdAt: presentations.createdAt,
        updatedAt: presentations.updatedAt,
      })
      .from(presentations)
      .innerJoin(
        presentationMembers,
        eq(presentationMembers.presentationId, presentations.id),
      )
      .where(eq(presentationMembers.userId, userId))
      .orderBy(desc(presentations.createdAt));
  }

  async listAll() {
    return this.db.select().from(presentations).orderBy(desc(presentations.createdAt));
  }

  async findById(id: string) {
    return (await this.db.select().from(presentations).where(eq(presentations.id, id)).get()) ?? null;
  }

  async roleFor(id: string, userId: string) {
    const row = await this.db
      .select({ role: presentationMembers.role })
      .from(presentationMembers)
      .where(
        and(eq(presentationMembers.presentationId, id), eq(presentationMembers.userId, userId)),
      )
      .get();
    return row?.role ?? null;
  }

  async hasValidAssetReferences(id: string, assetIds: readonly string[]) {
    if (assetIds.length === 0) return true;
    const uniqueIds = [...new Set(assetIds)];
    const row = await this.db
      .select({ value: count() })
      .from(assets)
      .where(
        and(
          eq(assets.presentationId, id),
          eq(assets.status, "ready"),
          inArray(assets.id, uniqueIds),
        ),
      )
      .get();
    return row?.value === uniqueIds.length;
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
