import { describe, expect, it } from "vitest";
import {
  AssetError,
  AssetService,
  type AssetRepository,
  type AssetRecord,
  type AssetServices,
  type ObjectStorage,
} from "../../../src/modules/assets/service";

const now = new Date("2026-01-01T00:00:00.000Z");
const editor = { userId: "editor", globalRole: "user" as const };
const input = {
  presentationId: "presentation",
  name: "image.png",
  mediaType: "image/png" as const,
  sizeBytes: 8,
  sha256Hex: "a".repeat(64),
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class Repository implements AssetRepository {
  readonly records = new Map<string, AssetRecord>();
  readonly references = new Set<string>();
  async create(record: AssetRecord) {
    this.records.set(record.id, record);
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async save(record: AssetRecord) {
    if (this.records.get(record.id)?.status !== "pending") return false;
    this.records.set(record.id, record);
    return true;
  }
  async deleteClaimed(id: string) {
    if (this.records.get(id)?.status === "deleting") this.records.delete(id);
  }
  async claimDeletion(id: string, statuses: AssetRecord["status"][]) {
    const value = this.records.get(id);
    if (!value || !statuses.includes(value.status) || this.references.has(id)) return null;
    const claimed = { ...value, status: "deleting" as const, updatedAt: now };
    this.records.set(id, claimed);
    return claimed;
  }
  async isReferenced(id: string) {
    return this.references.has(id);
  }
  async findExpiredUnfinalized(before: Date) {
    return [...this.records.values()].filter(
      (record) =>
        (record.status === "pending" ||
          record.status === "failed" ||
          record.status === "deleting") &&
        record.createdAt < before,
    );
  }
}
class Storage implements ObjectStorage {
  readonly objects = new Map<
    string,
    { sizeBytes: number; mediaType: string; sha256Hex: string; prefix: Uint8Array }
  >();
  readonly deleted: string[] = [];
  async head(objectKey: string) {
    const object = this.objects.get(objectKey);
    return object
      ? { sizeBytes: object.sizeBytes, mediaType: object.mediaType, sha256Hex: object.sha256Hex }
      : null;
  }
  async prefix(objectKey: string) {
    return this.objects.get(objectKey)?.prefix ?? null;
  }
  async delete(objectKey: string) {
    this.deleted.push(objectKey);
    this.objects.delete(objectKey);
  }
}
const setup = () => {
  const repository = new Repository();
  const storage = new Storage();
  const signed = {
    issuePut: async () => ({
      method: "PUT" as const,
      url: "https://signed.example/secret",
      expiresAt: new Date("2026-01-01T00:10:00.000Z"),
      headers: {
        "content-type": input.mediaType,
        "content-length": String(input.sizeBytes),
        "x-amz-checksum-sha256": input.sha256Hex,
      },
    }),
    issueDownload: async () => ({
      method: "GET" as const,
      url: "https://signed.example/secret",
      expiresAt: new Date("2026-01-01T00:10:00.000Z"),
    }),
  };
  const services: AssetServices = {
    repository,
    permission: {
      canEdit: async (identity, presentationId) =>
        identity.userId === "editor" && presentationId === "presentation",
      canRead: async (identity, presentationId) =>
        identity.userId === "editor" && presentationId === "presentation",
    },
    storage,
    signedAccess: signed,
    clock: { now: () => now },
    id: { next: () => "asset-1", random: () => "random-value" },
  };
  return { repository, services, storage, service: new AssetService(services) };
};

describe("AssetService", () => {
  it("initializes an immutable object key for an editor and grants a ten minute PUT", async () => {
    const { repository, service } = setup();
    const result = await service.init(editor, input);
    expect(result.asset).toMatchObject({
      id: "asset-1",
      ownerId: "editor",
      status: "pending",
      objectKey: "assets/asset-1/random-value",
      expiresAt: "2026-01-01T00:10:00.000Z",
    });
    expect(result.putAccess.expiresAt.toISOString()).toBe("2026-01-01T00:10:00.000Z");
    expect(repository.records.get("asset-1")?.objectKey).toBe("assets/asset-1/random-value");
  });

  it("denies initialization without editor permission", async () => {
    const { service } = setup();
    await expect(
      service.init({ userId: "other", globalRole: "user" }, input),
    ).rejects.toMatchObject({ code: "forbidden" } satisfies Partial<AssetError>);
  });

  it("does not expose a signed access failure", async () => {
    const { services } = setup();
    services.signedAccess = {
      issuePut: async () => {
        throw new Error("https://signed.example/secret");
      },
      issueDownload: async () => ({ method: "GET", url: "", expiresAt: now }),
    };
    const service = new AssetService(services);
    await expect(service.init(editor, input)).rejects.toMatchObject({
      code: "access_unavailable",
      message: "access_unavailable",
    } satisfies Partial<AssetError>);
  });

  it("finalizes only matching stored objects and makes ready finalization idempotent", async () => {
    const { storage, service } = setup();
    const initialized = await service.init(editor, input);
    storage.objects.set(initialized.asset.objectKey, { ...input, prefix: png });
    await expect(service.finalize(editor, "asset-1")).resolves.toMatchObject({ status: "ready" });
    await expect(service.finalize(editor, "asset-1")).resolves.toMatchObject({ status: "ready" });
  });

  it.each([
    ["missing object", undefined],
    [
      "different size",
      { sizeBytes: 7, mediaType: input.mediaType, sha256Hex: input.sha256Hex, prefix: png },
    ],
    [
      "different MIME",
      {
        sizeBytes: input.sizeBytes,
        mediaType: "image/jpeg",
        sha256Hex: input.sha256Hex,
        prefix: png,
      },
    ],
    [
      "different checksum",
      {
        sizeBytes: input.sizeBytes,
        mediaType: input.mediaType,
        sha256Hex: "b".repeat(64),
        prefix: png,
      },
    ],
    [
      "wrong magic bytes",
      {
        sizeBytes: input.sizeBytes,
        mediaType: input.mediaType,
        sha256Hex: input.sha256Hex,
        prefix: new Uint8Array([0xff, 0xd8, 0xff]),
      },
    ],
  ])("marks an asset failed for %s", async (_name, object) => {
    const { repository, storage, service } = setup();
    const initialized = await service.init(editor, input);
    if (object) storage.objects.set(initialized.asset.objectKey, object);
    await expect(service.finalize(editor, "asset-1")).rejects.toMatchObject({
      code: "verification_failed",
    } satisfies Partial<AssetError>);
    expect(repository.records.get("asset-1")?.status).toBe("failed");
  });

  it("rejects referenced asset deletion and otherwise removes object and metadata idempotently", async () => {
    const { repository, storage, service } = setup();
    const initialized = await service.init(editor, input);
    repository.references.add("asset-1");
    await expect(service.delete(editor, "asset-1")).rejects.toMatchObject({
      code: "referenced",
    } satisfies Partial<AssetError>);
    repository.references.delete("asset-1");
    await service.delete(editor, "asset-1");
    await service.delete(editor, "asset-1");
    expect(storage.deleted).toEqual([initialized.asset.objectKey]);
    expect(repository.records.has("asset-1")).toBe(false);
  });

  it("does not delete an object when a reference is added before deletion is claimed", async () => {
    const { repository, storage, service } = setup();
    const initialized = await service.init(editor, input);
    const originalFind = repository.findById.bind(repository);
    repository.findById = async (id) => {
      const value = await originalFind(id);
      repository.references.add(id);
      return value;
    };
    await expect(service.delete(editor, initialized.asset.id)).rejects.toMatchObject({
      code: "referenced",
    } satisfies Partial<AssetError>);
    expect(storage.deleted).toEqual([]);
    expect(repository.records.get(initialized.asset.id)?.status).toBe("pending");
  });

  it("makes concurrent deletion idempotent", async () => {
    const { repository, storage, service } = setup();
    const initialized = await service.init(editor, input);
    await Promise.all([
      service.delete(editor, initialized.asset.id),
      service.delete(editor, initialized.asset.id),
    ]);
    expect(storage.deleted).toEqual([initialized.asset.objectKey, initialized.asset.objectKey]);
    expect(repository.records.has(initialized.asset.id)).toBe(false);
  });

  it("keeps a claimed deletion for retry after object storage fails", async () => {
    const { repository, storage, service } = setup();
    const initialized = await service.init(editor, input);
    let fail = true;
    storage.delete = async (objectKey) => {
      if (fail) {
        fail = false;
        throw new Error("temporary failure");
      }
      storage.deleted.push(objectKey);
      storage.objects.delete(objectKey);
    };
    await expect(service.delete(editor, initialized.asset.id)).rejects.toThrow("temporary failure");
    expect(repository.records.get(initialized.asset.id)?.status).toBe("deleting");
    await service.delete(editor, initialized.asset.id);
    expect(storage.deleted).toEqual([initialized.asset.objectKey]);
    expect(repository.records.has(initialized.asset.id)).toBe(false);
  });

  it("issues downloads only for ready assets referenced by their presentation", async () => {
    const { repository, storage, service } = setup();
    const initialized = await service.init(editor, input);
    storage.objects.set(initialized.asset.objectKey, { ...input, prefix: png });
    await service.finalize(editor, initialized.asset.id);
    await expect(service.download(editor, initialized.asset.id)).rejects.toMatchObject({
      code: "access_unavailable",
    } satisfies Partial<AssetError>);
    repository.references.add(initialized.asset.id);
    await expect(service.download(editor, initialized.asset.id)).resolves.toMatchObject({
      method: "GET",
    });
  });

  it("collects unreferenced pending or failed assets older than 24 hours", async () => {
    const { repository, storage, service } = setup();
    repository.records.set("old-pending", {
      id: "old-pending",
      ownerId: "owner",
      presentationId: "presentation",
      name: "old",
      mediaType: "image/png",
      sizeBytes: 1,
      sha256Hex: "a".repeat(64),
      objectKey: "assets/old",
      status: "pending",
      expiresAt: now.toISOString(),
      createdAt: new Date("2025-12-30T23:59:59.999Z"),
      updatedAt: now,
    });
    repository.records.set("old-failed", {
      ...repository.records.get("old-pending")!,
      id: "old-failed",
      objectKey: "assets/failed",
      status: "failed",
    });
    repository.records.set("recent", {
      ...repository.records.get("old-pending")!,
      id: "recent",
      objectKey: "assets/recent",
      createdAt: now,
    });
    repository.references.add("old-failed");
    await expect(service.collectOrphans()).resolves.toEqual({ deleted: 1, skippedReferenced: 1 });
    expect(storage.deleted).toEqual(["assets/old"]);
  });

  it("skips an orphan candidate finalized before deletion is claimed", async () => {
    const { repository, storage, service } = setup();
    const candidate = {
      id: "old",
      ownerId: "owner",
      presentationId: "presentation",
      name: "old",
      mediaType: "image/png" as const,
      sizeBytes: 1,
      sha256Hex: "a".repeat(64),
      objectKey: "assets/old",
      status: "pending" as const,
      expiresAt: now.toISOString(),
      createdAt: new Date("2025-12-30T23:59:59.999Z"),
      updatedAt: now,
    };
    repository.records.set(candidate.id, candidate);
    const originalClaim = repository.claimDeletion.bind(repository);
    repository.claimDeletion = async (id, statuses) => {
      repository.records.set(id, { ...candidate, status: "ready" });
      return originalClaim(id, statuses);
    };
    await expect(service.collectOrphans()).resolves.toEqual({ deleted: 0, skippedReferenced: 0 });
    expect(storage.deleted).toEqual([]);
    expect(repository.records.get(candidate.id)?.status).toBe("ready");
  });
});
