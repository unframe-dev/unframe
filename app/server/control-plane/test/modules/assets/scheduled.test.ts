import { describe, expect, it } from "vitest";
import { createScheduledHandler } from "../../../src/index";
import type { AssetRecord, AssetServices } from "../../../src/modules/assets/service";

const now = new Date("2026-01-02T00:00:00.000Z");
const asset = (id: string, status: AssetRecord["status"], createdAt: Date): AssetRecord => ({
  id,
  ownerId: "owner",
  presentationId: "presentation",
  name: "private-name",
  mediaType: "image/png",
  sizeBytes: 8,
  sha256Hex: "a".repeat(64),
  objectKey: `assets/${id}/private-key`,
  status,
  expiresAt: createdAt.toISOString(),
  createdAt,
  updatedAt: now,
});
const execution = () => {
  let task: Promise<unknown> | undefined;
  return {
    execution: {
      waitUntil: (value: Promise<unknown>) => {
        task = value;
      },
    } as ExecutionContext,
    wait: async () => task,
  };
};

describe("scheduled asset orphan collection", () => {
  it("collects only expired pending and failed assets and logs aggregate counts without secrets", async () => {
    const records = [
      asset("old-pending", "pending", new Date("2025-12-31T23:59:59.999Z")),
      asset("old-failed", "failed", new Date("2025-12-31T23:59:59.999Z")),
      asset("old-ready", "ready", new Date("2025-12-31T23:59:59.999Z")),
      asset("new-pending", "pending", now),
    ];
    const deleted: string[] = [];
    const logs: string[] = [];
    const services: AssetServices = {
      repository: {
        create: async () => {},
        findById: async () => null,
        findByObjectKey: async () => null,
        save: async () => false,
        deleteClaimed: async (id) => {
          deleted.push(id);
        },
        claimDeletion: async (id, statuses) => {
          const value = records.find((record) => record.id === id);
          return value && statuses.includes(value.status) && id !== "old-failed"
            ? { ...value, status: "deleting" }
            : null;
        },
        isReferenced: async (id) => id === "old-failed",
        findExpiredUnfinalized: async (before) =>
          records.filter(
            (value) =>
              (value.status === "pending" || value.status === "failed") &&
              new Date(value.expiresAt) < before,
          ),
      },
      permission: { canEdit: async () => false, canRead: async () => false },
      storage: {
        head: async () => null,
        prefix: async () => null,
        delete: async (key) => {
          deleted.push(key);
        },
        list: async () => [],
      },
      signedAccess: {
        issuePut: async () => {
          throw new Error("unused");
        },
        issueDownload: async () => {
          throw new Error("unused");
        },
      },
      clock: { now: () => now },
      id: { next: () => "unused", random: () => "unused" },
    };
    const { execution: context, wait } = execution();
    await createScheduledHandler(
      () => services,
      (entry) => logs.push(entry),
    )({} as ScheduledEvent, {} as CloudflareBindings, context);
    await wait();
    expect(deleted).toEqual(["assets/old-pending/private-key", "old-pending"]);
    expect(logs).toEqual([
      JSON.stringify({
        event: "asset_orphan_collection",
        deleted: 1,
        deletedMetadataLess: 0,
        skippedReferenced: 1,
      }),
    ]);
    expect(logs.join()).not.toMatch(/private|assets\//);
  });

  it("logs a safe structured failure without the thrown message", async () => {
    const logs: string[] = [];
    const { execution: context, wait } = execution();
    const services: AssetServices = {
      repository: {
        create: async () => {},
        findById: async () => null,
        findByObjectKey: async () => null,
        save: async () => false,
        deleteClaimed: async () => {},
        claimDeletion: async () => null,
        isReferenced: async () => false,
        findExpiredUnfinalized: async () => {
          throw new Error("https://signed.example/private-secret");
        },
      },
      permission: { canEdit: async () => false, canRead: async () => false },
      storage: {
        head: async () => null,
        prefix: async () => null,
        delete: async () => {},
        list: async () => [],
      },
      signedAccess: {
        issuePut: async () => {
          throw new Error("unused");
        },
        issueDownload: async () => {
          throw new Error("unused");
        },
      },
      clock: { now: () => now },
      id: { next: () => "unused", random: () => "unused" },
    };
    await createScheduledHandler(
      () => services,
      (entry) => logs.push(entry),
    )({} as ScheduledEvent, {} as CloudflareBindings, context);
    await wait();
    expect(logs).toEqual([
      JSON.stringify({ event: "asset_orphan_collection_failed", error: "collection_failed" }),
    ]);
    expect(logs.join()).not.toContain("private-secret");
  });
});
