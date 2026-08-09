import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import type {
  AssetRecord,
  AssetRepository,
  AssetServices,
  ObjectStorage,
} from "../../../src/modules/assets/service";

const identity = { userId: "editor", globalRole: "user" as const };
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
    const claimed = { ...value, status: "deleting" as const };
    this.records.set(id, claimed);
    return claimed;
  }
  async isReferenced(id: string) {
    return this.references.has(id);
  }
  async findExpiredUnfinalized() {
    return [];
  }
}

class Storage implements ObjectStorage {
  readonly objects = new Map<
    string,
    { sizeBytes: number; mediaType: string; sha256Hex: string; prefix: Uint8Array }
  >();
  async head(key: string) {
    const value = this.objects.get(key);
    return value
      ? { sizeBytes: value.sizeBytes, mediaType: value.mediaType, sha256Hex: value.sha256Hex }
      : null;
  }
  async prefix(key: string) {
    return this.objects.get(key)?.prefix ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const setup = () => {
  const repository = new Repository();
  const storage = new Storage();
  const services: AssetServices = {
    repository,
    storage,
    permission: { canEdit: async () => true, canRead: async () => true },
    signedAccess: {
      issuePut: async () => ({
        method: "PUT",
        url: "https://signed.example/put-secret",
        expiresAt: new Date("2026-01-01T00:10:00.000Z"),
        headers: {
          "content-type": "image/png",
          "content-length": "8",
          "x-amz-checksum-sha256": "a".repeat(64),
        },
      }),
      issueDownload: async () => ({
        method: "GET",
        url: "https://signed.example/download-secret",
        expiresAt: new Date("2026-01-01T00:10:00.000Z"),
      }),
    },
    clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    id: { next: () => "asset-1", random: () => "random" },
  };
  const app = createApp({ identityProvider: async () => identity, services: () => services });
  return { app, repository, storage };
};
const request = (app: ReturnType<typeof createApp>, path: string, init?: RequestInit) =>
  app.fetch(new Request(`https://example.test${path}`, init));

describe("asset HTTP API", () => {
  it.each([
    ["POST", "/assets/uploads"],
    ["GET", "/assets/asset-1"],
    ["POST", "/assets/asset-1/finalize"],
    ["GET", "/assets/asset-1/download"],
    ["DELETE", "/assets/asset-1"],
  ])("requires authentication for %s %s", async (method, path) => {
    expect((await request(createApp(), path, { method })).status).toBe(401);
  });

  it("rejects malformed uploads, invalid upload bodies, and invalid ids", async () => {
    const { app } = setup();
    await expect(
      request(app, "/assets/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      request(app, "/assets/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, sizeBytes: 0 }),
      }),
    ).resolves.toMatchObject({ status: 400 });
    for (const [method, path] of [
      ["GET", "/assets/invalid.id"],
      ["POST", "/assets/invalid.id/finalize"],
      ["GET", "/assets/invalid.id/download"],
      ["DELETE", "/assets/invalid.id"],
    ] as const) {
      expect((await request(app, path, { method })).status).toBe(400);
    }
  });

  it("initializes, reads, finalizes, and returns a referenced ready asset download", async () => {
    const { app, repository, storage } = setup();
    const initialized = await request(app, "/assets/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(initialized.status).toBe(201);
    const initializedBody = (await initialized.json()) as {
      asset: { id: string; status: string };
      upload: { url: string };
    };
    expect(initializedBody).toMatchObject({
      asset: { id: "asset-1", status: "pending" },
      upload: { url: "https://signed.example/put-secret" },
    });
    expect(await (await request(app, "/assets/asset-1")).json()).toMatchObject({
      id: "asset-1",
      status: "pending",
    });
    storage.objects.set("assets/asset-1/random", { ...input, prefix: png });
    expect((await request(app, "/assets/asset-1/finalize", { method: "POST" })).status).toBe(200);
    repository.references.add("asset-1");
    const downloaded = await request(app, "/assets/asset-1/download");
    expect(downloaded.status).toBe(200);
    await expect(downloaded.json()).resolves.toMatchObject({
      download: { method: "GET", url: "https://signed.example/download-secret" },
    });
  });

  it("returns 422 for failed finalization, and does not expose signed URL secrets in error responses", async () => {
    const { app } = setup();
    await request(app, "/assets/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const response = await request(app, "/assets/asset-1/finalize", { method: "POST" });
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).not.toContain("signed.example");
  });

  it("blocks referenced deletion and deletes an unreferenced asset", async () => {
    const { app, repository } = setup();
    await request(app, "/assets/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    repository.references.add("asset-1");
    expect((await request(app, "/assets/asset-1", { method: "DELETE" })).status).toBe(409);
    repository.references.clear();
    expect((await request(app, "/assets/asset-1", { method: "DELETE" })).status).toBe(204);
  });
});
