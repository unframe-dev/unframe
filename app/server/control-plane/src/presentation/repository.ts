import type { D1Database } from "@cloudflare/workers-types";
import { and, count, desc, eq, inArray, ne, notExists, sql } from "drizzle-orm";

import { createD1Database } from "../adapters/d1/database";
import {
  assets,
  presentationAssetRefs,
  presentationBuildCleanup,
  presentationBuilds,
  presentationMembers,
  presentationPublications,
  presentationSessions,
  presentations,
} from "../adapters/d1/schema";
import { deletedRoomViewerCleanup } from "../modules/viewer-credentials/cleanup";
import type { PresentationDefinition } from "./schema";

export type PresentationRecord = {
  id: string;
  ownerId: string;
  name: string;
  revision: number;
  definition: PresentationDefinition | null;
  createdAt: string;
  updatedAt: string;
};

export type PresentationRepository = {
  create(record: PresentationRecord, sourcePresentationId?: string): Promise<void>;
  listAll(): Promise<PresentationRecord[]>;
  listByUser(userId: string): Promise<PresentationRecord[]>;
  findById(id: string): Promise<PresentationRecord | null>;
  findByOwnerAndSource(
    ownerId: string,
    sourcePresentationId: string,
  ): Promise<PresentationRecord | null>;
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

const presentationRecordColumns = {
  id: presentations.id,
  ownerId: presentations.ownerId,
  name: presentations.name,
  revision: presentations.revision,
  definition: presentations.definition,
  createdAt: presentations.createdAt,
  updatedAt: presentations.updatedAt,
};

export class D1PresentationRepository implements PresentationRepository {
  private readonly db;

  constructor(private readonly database: D1Database) {
    this.db = createD1Database(database);
  }

  async create(record: PresentationRecord, sourcePresentationId = record.id) {
    await this.db.batch([
      this.db
        .insert(presentations)
        .values({
          ...record,
          sourcePresentationId,
          definition: sql`${JSON.stringify(record.definition)}`,
        })
        .onConflictDoNothing(),
      this.db
        .insert(presentationMembers)
        .select(
          this.db
            .select({
              presentationId: sql<string>`${record.id}`.as("presentationId"),
              userId: sql<string>`${record.ownerId}`.as("userId"),
              role: sql<"owner">`'owner'`.as("role"),
            })
            .from(presentations)
            .where(and(eq(presentations.id, record.id), eq(presentations.ownerId, record.ownerId))),
        )
        .onConflictDoNothing(),
    ]);
  }

  async listByUser(userId: string) {
    return this.db
      .select(presentationRecordColumns)
      .from(presentations)
      .innerJoin(presentationMembers, eq(presentationMembers.presentationId, presentations.id))
      .where(eq(presentationMembers.userId, userId))
      .orderBy(desc(presentations.createdAt));
  }

  async listAll() {
    return this.db
      .select(presentationRecordColumns)
      .from(presentations)
      .orderBy(desc(presentations.createdAt));
  }

  async findById(id: string) {
    return (
      (await this.db
        .select(presentationRecordColumns)
        .from(presentations)
        .where(eq(presentations.id, id))
        .get()) ?? null
    );
  }

  async findByOwnerAndSource(ownerId: string, sourcePresentationId: string) {
    return (
      (await this.db
        .select(presentationRecordColumns)
        .from(presentations)
        .where(
          and(
            eq(presentations.ownerId, ownerId),
            eq(presentations.sourcePresentationId, sourcePresentationId),
          ),
        )
        .get()) ?? null
    );
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
    if (assetIds.length === 0) {
      return true;
    }
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
        `
          UPDATE presentations
          SET definition = ?, name = ?, revision = revision + 1, updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(?, '$.assets') refs
              LEFT JOIN assets
                ON assets.id = json_extract(refs.value, '$.assetId')
                AND assets.presentation_id = ?
                AND assets.status = 'ready'
              WHERE assets.id IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM presentation_sessions
              WHERE presentation_id = ? AND state != 'Ended'
            )
          RETURNING id
        `,
      )
      .bind(
        JSON.stringify(definition),
        definition.metadata.title,
        updatedAt,
        id,
        expectedRevision,
        JSON.stringify(definition),
        id,
        id,
      )
      .all<{ id: string }>();
    return result.results.length === 1 ? this.findById(id) : null;
  }

  async delete(id: string, expectedRevision: number) {
    const activeRooms = this.db
      .select({ id: presentationSessions.id })
      .from(presentationSessions)
      .where(
        and(
          eq(presentationSessions.presentationId, presentations.id),
          ne(presentationSessions.state, "Ended"),
        ),
      );
    const target = this.db
      .select({ id: presentations.id })
      .from(presentations)
      .where(
        and(
          eq(presentations.id, id),
          eq(presentations.revision, expectedRevision),
          notExists(activeRooms),
        ),
      );
    const targetRooms = this.db
      .select({ id: presentationSessions.id })
      .from(presentationSessions)
      .where(inArray(presentationSessions.presentationId, target));

    // Every statement shares the guard because a stale revision must leave all children intact.
    const [, , , , , , deleted] = await this.db.batch([
      this.db.insert(presentationBuildCleanup).select(sql`
        SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours') FROM (${target})
      `),
      deletedRoomViewerCleanup(this.database, targetRooms),
      this.db.delete(presentationSessions).where(inArray(presentationSessions.id, targetRooms)),
      this.db
        .delete(presentationPublications)
        .where(inArray(presentationPublications.presentationId, target)),
      this.db.delete(presentationBuilds).where(inArray(presentationBuilds.presentationId, target)),
      this.db
        .delete(presentationAssetRefs)
        .where(inArray(presentationAssetRefs.presentationId, target)),
      this.db
        .delete(presentations)
        .where(inArray(presentations.id, target))
        .returning({ id: presentations.id }),
    ]);
    return deleted.length === 1;
  }
}
