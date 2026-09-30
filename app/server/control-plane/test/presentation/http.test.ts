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
    content: { text: "Demo" },
    id: "text",
    initialState: validDefinition.groups[0]!.elements[0]!.initialState,
    type: "text",
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
  async hasValidAssetReferences(_id: string, assetIds: ReadonlyArray<string>) {
    return !assetIds.includes("missing-asset");
  }
  async replace(
    id: string,
    expectedRevision: number,
    next: PresentationDefinition,
    updatedAt: string,
  ) {
    const record = this.records.get(id);
    if (!record || record.revision !== expectedRevision) {
      return null;
    }
    const replacement = { ...record, definition: next, revision: record.revision + 1, updatedAt };
    this.records.set(id, replacement);
    return replacement;
  }
  async delete(id: string, expectedRevision: number) {
    const record = this.records.get(id);
    if (!record || record.revision !== expectedRevision) {
      return false;
    }
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
      id: () => "presentation-1",
      identityProvider: async () => ({ globalRole: "user", userId: "owner" }),
      now: () => "2026-01-01T00:00:00.000Z",
      repository,
    });
    const create = await request(app, "/presentations", {
      body: JSON.stringify(createDefinition),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toMatchObject({
      createdAt: "2026-01-01T00:00:00.000Z",
      definition: createDefinition,
      id: "presentation-1",
      revision: 1,
    });
    expect((await request(app, "/presentations/presentation-1")).status).toBe(200);
    const update = await request(app, "/presentations/presentation-1", {
      body: JSON.stringify({
        definition: { ...createDefinition, metadata: { title: "Updated" } },
        expectedRevision: 1,
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      definition: { metadata: { title: "Updated" } },
      revision: 2,
    });
    expect(
      (
        await request(app, "/presentations/presentation-1", {
          body: JSON.stringify({ expectedRevision: 2 }),
          headers: { "content-type": "application/json" },
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
  });
  it("rejects malformed JSON at every presentation write boundary", async () => {
    const app = createApp({
      identityProvider: async () => ({ globalRole: "user", userId: "owner" }),
      repository: new Repository(),
    });
    for (const [method, path] of [
      ["POST", "/presentations"],
      ["PUT", "/presentations/presentation-1"],
      ["DELETE", "/presentations/presentation-1"],
    ] as const) {
      const response = await request(app, path, {
        body: "{",
        headers: { "content-type": "application/json" },
        method,
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_error" } });
    }
  });
  it("requires JSON content type and rejects unknown write fields", async () => {
    const app = createApp({
      identityProvider: async () => ({ globalRole: "user", userId: "owner" }),
      repository: new Repository(),
    });
    const missingContentType = await request(app, "/presentations", {
      body: JSON.stringify(createDefinition),
      method: "POST",
    });
    const unknownField = await request(app, "/presentations/presentation-1", {
      body: JSON.stringify({ expectedRevision: 1, unexpected: true }),
      headers: { "content-type": "application/json" },
      method: "DELETE",
    });

    expect(missingContentType.status).toBe(400);
    expect(unknownField.status).toBe(400);
  });
  it("requires an empty asset list when creating a presentation", async () => {
    const app = createApp({
      identityProvider: async () => ({ globalRole: "user", userId: "owner" }),
      repository: new Repository(),
    });
    const response = await request(app, "/presentations", {
      body: JSON.stringify({ ...validDefinition, assets: [{ assetId: "asset-1" }] }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
  });
  it("returns 422 for an asset that is not ready and local to the presentation", async () => {
    const repository = new Repository();
    repository.records.set("presentation-1", {
      createdAt: "2026-01-01",
      definition: createDefinition,
      id: "presentation-1",
      ownerId: "owner",
      revision: 1,
      updatedAt: "2026-01-01",
    });
    const invalid = structuredClone(validDefinition);
    invalid.assets = [{ assetId: "missing-asset" }];
    if (invalid.groups[0]!.elements[0]!.type !== "image") {
      throw new Error("Expected image");
    }
    invalid.groups[0]!.elements[0]!.content.assetId = "missing-asset";
    const app = createApp({
      identityProvider: async () => ({ globalRole: "user", userId: "owner" }),
      repository,
    });
    const response = await request(app, "/presentations/presentation-1", {
      body: JSON.stringify({ definition: invalid, expectedRevision: 1 }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_asset_reference" },
    });
  });
});
