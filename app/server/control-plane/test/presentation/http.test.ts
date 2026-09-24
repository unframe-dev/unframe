import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { runtimeEnvironment } from "../runtime-environment";
import type { PresentationRecord, PresentationRepository } from "../../src/presentation/repository";
import { definition } from "./schema.test";
import type { PresentationDefinition } from "../../src/presentation/schema";

const validDefinition = presentationDefinition(definition);
const createDefinition = structuredClone(validDefinition);
createDefinition.assets = [];
createDefinition.groups[0]!.elements = [
  {
    id: "text",
    type: "text",
    content: { text: "Demo" },
    initialState: validDefinition.groups[0]!.elements[0]!.initialState,
  },
];
createDefinition.groups[0]!.anchoredElementGroups[0]!.elementIds = ["text"];
createDefinition.groups[0]!.steps[0]!.cues[0]!.actions[0]!.targetElementId = "text";
function presentationDefinition(value: typeof definition): PresentationDefinition {
  return value as unknown as PresentationDefinition;
}
class Repository implements PresentationRepository {
  readonly records = new Map<string, PresentationRecord>();
  async create(record: PresentationRecord) {
    this.records.set(record.id, record);
  }
  async listAll() {
    return [...this.records.values()];
  }
  async listByUser(userId: string) {
    return [...this.records.values()].filter((record) => record.ownerId === userId);
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async roleFor(id: string, userId: string) {
    const record = this.records.get(id);
    return record?.ownerId === userId ? ("owner" as const) : null;
  }
  async hasValidAssetReferences(_id: string, assetIds: readonly string[]) {
    return !assetIds.includes("missing-asset");
  }
  async replace(
    id: string,
    expectedRevision: number,
    next: PresentationDefinition,
    updatedAt: string,
  ) {
    const record = this.records.get(id);
    if (!record || record.revision !== expectedRevision) return null;
    const replacement = { ...record, revision: record.revision + 1, definition: next, updatedAt };
    this.records.set(id, replacement);
    return replacement;
  }
  async delete(id: string, expectedRevision: number) {
    const record = this.records.get(id);
    if (!record || record.revision !== expectedRevision) return false;
    this.records.delete(id);
    return true;
  }
}
const request = (app: ReturnType<typeof createApp>, path: string, init?: RequestInit) =>
  app.fetch(new Request(`https://example.com${path}`, init), runtimeEnvironment());

describe("presentation HTTP API", () => {
  it("requires an injected identity instead of allowing anonymous access", async () => {
    const response = await request(createApp(), "/presentations");
    expect(response.status).toBe(401);
  });
  it("creates, reads, updates, and deletes a resource envelope", async () => {
    const repository = new Repository();
    const app = createApp({
      repository,
      identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
      id: () => "presentation-1",
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const create = await request(app, "/presentations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createDefinition),
    });
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toMatchObject({
      id: "presentation-1",
      revision: 1,
      definition: createDefinition,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect((await request(app, "/presentations/presentation-1")).status).toBe(200);
    const update = await request(app, "/presentations/presentation-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 1,
        definition: { ...createDefinition, metadata: { title: "Updated" } },
      }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      revision: 2,
      definition: { metadata: { title: "Updated" } },
    });
    expect(
      (
        await request(app, "/presentations/presentation-1", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: 2 }),
        })
      ).status,
    ).toBe(204);
  });
  it("rejects malformed JSON at every presentation write boundary", async () => {
    const app = createApp({
      repository: new Repository(),
      identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
    });
    for (const [method, path] of [
      ["POST", "/presentations"],
      ["PUT", "/presentations/presentation-1"],
      ["DELETE", "/presentations/presentation-1"],
    ] as const) {
      const response = await request(app, path, {
        method,
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_error" } });
    }
  });
  it("requires JSON content type and rejects unknown write fields", async () => {
    const app = createApp({
      repository: new Repository(),
      identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
    });
    const missingContentType = await request(app, "/presentations", {
      method: "POST",
      body: JSON.stringify(createDefinition),
    });
    const unknownField = await request(app, "/presentations/presentation-1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, unexpected: true }),
    });

    expect(missingContentType.status).toBe(400);
    expect(unknownField.status).toBe(400);
  });
  it("requires an empty asset list when creating a presentation", async () => {
    const app = createApp({
      repository: new Repository(),
      identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
    });
    const response = await request(app, "/presentations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validDefinition, assets: [{ assetId: "asset-1" }] }),
    });
    expect(response.status).toBe(400);
  });
  it("returns 422 for an asset that is not ready and local to the presentation", async () => {
    const repository = new Repository();
    repository.records.set("presentation-1", {
      id: "presentation-1",
      ownerId: "owner",
      revision: 1,
      definition: createDefinition,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    const invalid = structuredClone(validDefinition);
    invalid.assets = [{ assetId: "missing-asset" }];
    if (invalid.groups[0]!.elements[0]!.type !== "image") throw new Error("Expected image");
    invalid.groups[0]!.elements[0]!.content.assetId = "missing-asset";
    const app = createApp({
      repository,
      identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
    });
    const response = await request(app, "/presentations/presentation-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, definition: invalid }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_asset_reference" },
    });
  });
});
