import { describe, expect, it, vi } from "vitest";
import { createScheduledHandler } from "../../../src/index";
import type { AssetRecord, AssetServices } from "../../../src/modules/assets/service";
import { runtimeEnvironment } from "../../runtime-environment";

const now = new Date("2026-01-02T00:00:00.000Z");
const asset = (id: string, status: AssetRecord["status"], createdAt: Date): AssetRecord => ({
  createdAt,
  expiresAt: createdAt.toISOString(),
  id,
  mediaType: "image/png",
  name: "private-name",
  objectKey: `assets/${id}/private-key`,
  ownerId: "owner",
  presentationId: "presentation",
  sha256Hex: "a".repeat(64),
  sizeBytes: 8,
  status,
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
  it("rejects invalid configuration before scheduling or constructing services", async () => {
    const services = vi.fn();
    const waitUntil = vi.fn();
    const handler = createScheduledHandler(services);

    await expect(
      handler(
        {} as ScheduledEvent,
        { ...runtimeEnvironment(), R2_BUCKET_NAME: "" } as unknown as CloudflareBindings,
        { waitUntil } as unknown as ExecutionContext,
      ),
    ).rejects.toThrow("R2_BUCKET_NAME");

    expect(services).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("collects only expired pending and failed assets and logs aggregate counts without secrets", async () => {
    const records = [
      asset("old-pending", "pending", new Date("2025-12-31T23:59:59.999Z")),
      asset("old-failed", "failed", new Date("2025-12-31T23:59:59.999Z")),
      asset("old-ready", "ready", new Date("2025-12-31T23:59:59.999Z")),
      asset("new-pending", "pending", now),
    ];
    const deleted: Array<string> = [];
    const logs: Array<string> = [];
    const services: AssetServices = {
      clock: { now: () => now },
      id: { next: () => "unused", random: () => "unused" },
      permission: { canEdit: async () => false, canRead: async () => false },
      repository: {
        claimDeletion: async (id, statuses) => {
          const value = records.find((record) => record.id === id);
          return value && statuses.includes(value.status) && id !== "old-failed"
            ? { ...value, status: "deleting" }
            : null;
        },
        create: async () => {},
        deleteClaimed: async (id) => {
          deleted.push(id);
        },
        findById: async () => null,
        findByObjectKey: async () => null,
        findExpiredUnfinalized: async (before) =>
          records.filter(
            (value) =>
              (value.status === "pending" || value.status === "failed") &&
              new Date(value.expiresAt) < before,
          ),
        isReferenced: async (id) => id === "old-failed",
        save: async () => false,
      },
      signedAccess: {
        issueDownload: async () => {
          throw new Error("unused");
        },
        issuePut: async () => {
          throw new Error("unused");
        },
      },
      storage: {
        delete: async (key) => {
          deleted.push(key);
        },
        head: async () => null,
        list: async () => [],
        prefix: async () => null,
      },
    };
    const { execution: context, wait } = execution();
    await createScheduledHandler(
      () => services,
      (entry) => logs.push(entry),
    )({} as ScheduledEvent, runtimeEnvironment(), context);
    await wait();
    expect(deleted).toEqual(["assets/old-pending/private-key", "old-pending"]);
    expect(logs).toEqual([
      JSON.stringify({
        deleted: 1,
        deletedMetadataLess: 0,
        event: "asset_orphan_collection",
        skippedReferenced: 1,
      }),
    ]);
    expect(logs.join()).not.toMatch(/private|assets\//);
  });

  it("logs a safe structured failure without the thrown message", async () => {
    const logs: Array<string> = [];
    const { execution: context, wait } = execution();
    const services: AssetServices = {
      clock: { now: () => now },
      id: { next: () => "unused", random: () => "unused" },
      permission: { canEdit: async () => false, canRead: async () => false },
      repository: {
        claimDeletion: async () => null,
        create: async () => {},
        deleteClaimed: async () => {},
        findById: async () => null,
        findByObjectKey: async () => null,
        findExpiredUnfinalized: async () => {
          throw new Error("https://signed.example/private-secret");
        },
        isReferenced: async () => false,
        save: async () => false,
      },
      signedAccess: {
        issueDownload: async () => {
          throw new Error("unused");
        },
        issuePut: async () => {
          throw new Error("unused");
        },
      },
      storage: {
        delete: async () => {},
        head: async () => null,
        list: async () => [],
        prefix: async () => null,
      },
    };
    await createScheduledHandler(
      () => services,
      (entry) => logs.push(entry),
    )({} as ScheduledEvent, runtimeEnvironment(), context);
    await wait();
    expect(logs).toEqual([
      JSON.stringify({ error: "collection_failed", event: "asset_orphan_collection_failed" }),
    ]);
    expect(logs.join()).not.toContain("private-secret");
  });
});
