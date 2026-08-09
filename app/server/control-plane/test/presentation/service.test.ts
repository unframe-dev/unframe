import { describe, expect, it } from "vitest";
import type { PresentationRecord, PresentationRepository } from "../../src/presentation/repository";
import { PresentationError, PresentationService } from "../../src/presentation/service";
import { definition } from "./schema.test";
import type { PresentationDefinition } from "../../src/presentation/schema";

const validDefinition = definition as unknown as PresentationDefinition;
const record: PresentationRecord = {
  id: "presentation",
  ownerId: "owner",
  revision: 1,
  definition: validDefinition,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
class FakeRepository implements PresentationRepository {
  readonly records = new Map([[record.id, record]]);
  readonly roles = new Map([
    ["presentation:owner", "owner" as const],
    ["presentation:editor", "editor" as const],
  ]);
  async create(value: PresentationRecord) {
    this.records.set(value.id, value);
  }
  async listAll() {
    return [...this.records.values()];
  }
  async listByUser(userId: string) {
    return [...this.records.values()].filter((value) => this.roles.has(`${value.id}:${userId}`));
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async roleFor(id: string, userId: string) {
    return this.roles.get(`${id}:${userId}`) ?? null;
  }
  async hasValidAssetReferences(_id: string, assetIds: readonly string[]) {
    return !assetIds.includes("invalid-asset");
  }
  async replace(
    id: string,
    expectedRevision: number,
    next: PresentationDefinition,
    updatedAt: string,
  ) {
    const value = this.records.get(id);
    if (!value || value.revision !== expectedRevision) return null;
    const replacement = { ...value, definition: next, revision: value.revision + 1, updatedAt };
    this.records.set(id, replacement);
    return replacement;
  }
  async delete(id: string, expectedRevision: number) {
    const value = this.records.get(id);
    if (!value || value.revision !== expectedRevision) return false;
    this.records.delete(id);
    return true;
  }
}
const service = () =>
  new PresentationService(
    new FakeRepository(),
    () => "2026-01-02T00:00:00.000Z",
    () => "new",
  );

describe("PresentationService authorization", () => {
  it("allows owners and editors to update", async () => {
    await expect(
      service().get({ userId: "editor", globalRole: "user" }, "presentation"),
    ).resolves.toMatchObject({ id: "presentation" });
    await expect(
      service().replace(
        { userId: "owner", globalRole: "user" },
        "presentation",
        1,
        validDefinition,
      ),
    ).resolves.toMatchObject({ revision: 2 });
    await expect(
      service().replace(
        { userId: "editor", globalRole: "user" },
        "presentation",
        1,
        validDefinition,
      ),
    ).resolves.toMatchObject({ revision: 2 });
  });
  it("denies unrelated reads and writes", async () => {
    await expect(
      service().get({ userId: "other", globalRole: "user" }, "presentation"),
    ).rejects.toMatchObject({ code: "forbidden" } satisfies Partial<PresentationError>);
    await expect(
      service().replace(
        { userId: "other", globalRole: "user" },
        "presentation",
        1,
        validDefinition,
      ),
    ).rejects.toMatchObject({ code: "forbidden" } satisfies Partial<PresentationError>);
  });
  it("reserves presentation deletion for owners and administrators", async () => {
    await expect(
      service().delete({ userId: "editor", globalRole: "user" }, "presentation", 1),
    ).rejects.toMatchObject({ code: "forbidden" } satisfies Partial<PresentationError>);
    await expect(
      service().delete({ userId: "owner", globalRole: "user" }, "presentation", 1),
    ).resolves.toBeUndefined();
    await expect(
      service().delete({ userId: "other", globalRole: "admin" }, "presentation", 1),
    ).resolves.toBeUndefined();
  });
  it("enforces expected revision", async () => {
    await expect(
      service().replace(
        { userId: "owner", globalRole: "user" },
        "presentation",
        2,
        validDefinition,
      ),
    ).rejects.toMatchObject({ code: "conflict" } satisfies Partial<PresentationError>);
  });
  it("rejects assets that are not ready and local to the presentation", async () => {
    const invalid = { ...validDefinition, assets: [{ assetId: "invalid-asset" }] };
    await expect(
      service().replace({ userId: "owner", globalRole: "user" }, "presentation", 1, invalid),
    ).rejects.toMatchObject({
      code: "invalid_asset_reference",
    } satisfies Partial<PresentationError>);
  });
});
