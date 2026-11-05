import { env } from "cloudflare:test";
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
  readonly sourceIds = new Map<string, string>();
  async create(record: PresentationRecord, sourcePresentationId = record.id) {
    this.records.set(record.id, record);
    this.sourceIds.set(record.id, sourcePresentationId);
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
  async findByOwnerAndSource(ownerId: string, sourcePresentationId: string) {
    return (
      [...this.records.values()].find(
        (record) =>
          record.ownerId === ownerId &&
          (this.sourceIds.get(record.id) ?? record.id) === sourcePresentationId,
      ) ?? null
    );
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
  it("registers a separate publication target per owner and reuses it across concurrent requests", async () => {
    const suffix = crypto.randomUUID();
    const sourcePresentationId = `demo/source:${suffix}`;
    const sourceQuery = `/presentations?sourcePresentationId=${encodeURIComponent(sourcePresentationId)}`;
    const ownerId = `owner-${suffix}`;
    const otherId = `other-${suffix}`;
    for (const userId of [ownerId, otherId]) {
      await env.DB.prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, '2026', '2026')",
      )
        .bind(userId, `${userId}@example.test`)
        .run();
    }
    const owner = createApp({
      identityProvider: async () => ({ userId: ownerId, globalRole: "user" }),
    });
    const other = createApp({
      identityProvider: async () => ({ userId: otherId, globalRole: "admin" }),
    });
    const register = (app: ReturnType<typeof createApp>) =>
      request(app, "/presentations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourcePresentationId, name: "Demo" }),
      });

    const [first, retry] = await Promise.all([register(owner), register(owner)]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    const firstTarget = await first.json<{ id: string }>();
    expect(firstTarget.id).toEqual(expect.any(String));
    expect(firstTarget.id).not.toBe(sourcePresentationId);
    await expect(retry.json()).resolves.toEqual(firstTarget);
    const otherLookup = await request(other, sourceQuery);
    expect(otherLookup.status).toBe(200);
    await expect(otherLookup.json()).resolves.toEqual({ presentations: [] });

    const second = await register(other);
    expect(second.status).toBe(201);
    const secondTarget = await second.json<{ id: string }>();
    expect(secondTarget.id).toEqual(expect.any(String));
    expect(secondTarget.id).not.toBe(firstTarget.id);
    await expect((await request(owner, sourceQuery)).json()).resolves.toEqual({
      presentations: [firstTarget],
    });
    await expect((await request(other, sourceQuery)).json()).resolves.toEqual({
      presentations: [secondTarget],
    });
  });
  it("registers a local immutable ID without a Definition and reuses it only with permission", async () => {
    const repository = new Repository();
    const identity = { userId: "owner", globalRole: "user" as const };
    const app = createApp({ repository, identityProvider: async () => identity });
    const registration = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "local-id", name: "Local presentation" }),
    });
    const created = await request(app, "/presentations", registration());
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      id: "local-id",
      name: "Local presentation",
      revision: 1,
      definition: null,
    });
    expect((await request(app, "/presentations", registration())).status).toBe(201);
    const stranger = createApp({
      repository,
      identityProvider: async () => ({ userId: "stranger", globalRole: "user" }),
    });
    expect((await request(stranger, "/presentations", registration())).status).toBe(403);
    expect(repository.records.get("local-id")?.ownerId).toBe("owner");
  });
  it("creates, reads, updates, and deletes a resource envelope", async () => {
    const repository = new Repository();
    const app = createApp({
      repository,
      identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const create = await request(app, "/presentations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "presentation-1", name: "Demo" }),
    });
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toMatchObject({
      id: "presentation-1",
      revision: 1,
      name: "Demo",
      definition: null,
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
      body: JSON.stringify({ id: "presentation-1", name: "Demo" }),
    });
    const unknownField = await request(app, "/presentations/presentation-1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, unexpected: true }),
    });

    expect(missingContentType.status).toBe(400);
    expect(unknownField.status).toBe(400);
  });
  it.each([
    "application/json",
    "application/json; charset=utf-8",
    'application/json; charset="utf-8"',
    "application/example+json",
    'application/json; charset="utf-8"; profile="demo"',
  ])("accepts JSON registration with %s", async (contentType) => {
    const app = createApp({
      repository: new Repository(),
      identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
    });
    const response = await request(app, "/presentations", {
      method: "POST",
      headers: { "content-type": contentType },
      body: JSON.stringify({ id: "presentation-1", name: "Demo" }),
    });
    expect(response.status).toBe(201);
  });
  it("rejects Definition payloads at the metadata registration boundary", async () => {
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
      name: "Demo",
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
