import { matchesMagicBytes } from "./magic";
import type { AssetInitInput, AssetMediaType } from "./schema";
import type { Identity } from "../../presentation/service";

export type AssetStatus = "pending" | "ready" | "failed" | "deleting";
export type AssetRecord = {
  id: string;
  ownerId: string;
  presentationId: string;
  name: string;
  mediaType: AssetMediaType;
  sizeBytes: number;
  sha256Hex: string;
  objectKey: string;
  status: AssetStatus;
  expiresAt: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AssetRepository = {
  create(record: AssetRecord): Promise<void>;
  findById(id: string): Promise<AssetRecord | null>;
  findByObjectKey(objectKey: string): Promise<AssetRecord | null>;
  save(record: AssetRecord): Promise<boolean>;
  deleteClaimed(id: string): Promise<void>;
  claimDeletion(id: string, statuses: readonly AssetStatus[]): Promise<AssetRecord | null>;
  isReferenced(id: string): Promise<boolean>;
  findExpiredUnfinalized(before: Date): Promise<AssetRecord[]>;
};

export type PresentationPermission = {
  canEdit(identity: Identity, presentationId: string): Promise<boolean>;
  canRead(identity: Identity, presentationId: string): Promise<boolean>;
};
export type ObjectStorage = {
  head(
    objectKey: string,
  ): Promise<{ sizeBytes: number; mediaType: string; sha256Hex: string } | null>;
  prefix(objectKey: string): Promise<Uint8Array | null>;
  delete(objectKey: string): Promise<void>;
  list(prefix: string): Promise<{ objectKey: string; uploadedAt: Date }[]>;
};
export type PutAccess = {
  method: "PUT";
  url: string;
  expiresAt: Date;
  headers: {
    "content-type": AssetMediaType;
    "content-length": string;
    "x-amz-checksum-sha256": string;
  };
};
export type DownloadAccess = { method: "GET"; url: string; expiresAt: Date };
export type SignedAccess = {
  issuePut(input: {
    objectKey: string;
    mediaType: AssetMediaType;
    sizeBytes: number;
    sha256Hex: string;
    expiresAt: Date;
  }): Promise<PutAccess>;
  issueDownload(input: { objectKey: string; expiresAt: Date }): Promise<DownloadAccess>;
};
export type Clock = { now(): Date };
export type AssetId = { next(): string; random(): string };
export type AssetServices = {
  repository: AssetRepository;
  permission: PresentationPermission;
  storage: ObjectStorage;
  signedAccess: SignedAccess;
  clock: Clock;
  id: AssetId;
  audit?: (entry: Record<string, string>) => void;
};
export class AssetError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "forbidden"
      | "referenced"
      | "verification_failed"
      | "access_unavailable",
  ) {
    super(code);
  }
}

const putAccessDurationMs = 10 * 60 * 1000;
const orphanAgeMs = 24 * 60 * 60 * 1000;

export class AssetService {
  constructor(private readonly services: AssetServices) {}

  async init(identity: Identity, input: AssetInitInput) {
    if (!(await this.services.permission.canEdit(identity, input.presentationId)))
      throw new AssetError("forbidden");
    const createdAt = this.services.clock.now();
    const expiresAt = new Date(createdAt.getTime() + putAccessDurationMs);
    const id = this.services.id.next();
    const record: AssetRecord = {
      id,
      ownerId: identity.userId,
      presentationId: input.presentationId,
      name: input.name,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      sha256Hex: input.sha256Hex,
      objectKey: `assets/${id}/${this.services.id.random()}`,
      status: "pending",
      expiresAt: expiresAt.toISOString(),
      createdAt,
      updatedAt: createdAt,
    };
    await this.services.repository.create(record);
    let putAccess: PutAccess;
    try {
      putAccess = await this.services.signedAccess.issuePut({
        objectKey: record.objectKey,
        mediaType: record.mediaType,
        sizeBytes: record.sizeBytes,
        sha256Hex: record.sha256Hex,
        expiresAt,
      });
    } catch {
      throw new AssetError("access_unavailable");
    }
    return { asset: record, putAccess };
  }

  async finalize(identity: Identity, id: string): Promise<AssetRecord> {
    const record = await this.requireEditable(identity, id);
    if (record.status === "ready") return record;
    if (this.services.clock.now() >= new Date(record.expiresAt)) {
      const ready = await this.failVerification(record);
      if (ready) return ready;
      throw new AssetError("verification_failed");
    }
    const stored = await this.services.storage.head(record.objectKey);
    const prefix = stored ? await this.services.storage.prefix(record.objectKey) : null;
    if (
      !stored ||
      !prefix ||
      stored.sizeBytes !== record.sizeBytes ||
      stored.mediaType !== record.mediaType ||
      stored.sha256Hex !== record.sha256Hex ||
      !matchesMagicBytes(record.mediaType, prefix)
    ) {
      const ready = await this.failVerification(record);
      if (ready) return ready;
      throw new AssetError("verification_failed");
    }
    const ready = { ...record, status: "ready" as const, updatedAt: this.services.clock.now() };
    if (await this.services.repository.save(ready)) return ready;
    const current = await this.services.repository.findById(id);
    if (current?.status === "ready") return current;
    throw new AssetError("verification_failed");
  }

  async get(identity: Identity, id: string): Promise<AssetRecord> {
    const record = await this.services.repository.findById(id);
    if (!record) throw new AssetError("not_found");
    if (!(await this.services.permission.canRead(identity, record.presentationId)))
      throw new AssetError("forbidden");
    return record;
  }

  async download(identity: Identity, id: string): Promise<DownloadAccess> {
    const record = await this.services.repository.findById(id);
    if (!record) throw new AssetError("not_found");
    if (!(await this.services.permission.canRead(identity, record.presentationId)))
      throw new AssetError("forbidden");
    if (record.status !== "ready" || !(await this.services.repository.isReferenced(id)))
      throw new AssetError("access_unavailable");
    try {
      return await this.services.signedAccess.issueDownload({
        objectKey: record.objectKey,
        expiresAt: new Date(this.services.clock.now().getTime() + putAccessDurationMs),
      });
    } catch {
      throw new AssetError("access_unavailable");
    }
  }

  async delete(identity: Identity, id: string): Promise<void> {
    const record = await this.services.repository.findById(id);
    if (!record) return;
    if (!(await this.services.permission.canEdit(identity, record.presentationId)))
      throw new AssetError("forbidden");
    const claimed = await this.services.repository.claimDeletion(id, [
      "pending",
      "ready",
      "failed",
      "deleting",
    ]);
    if (!claimed) {
      if (await this.services.repository.isReferenced(id)) throw new AssetError("referenced");
      return;
    }
    await this.services.storage.delete(claimed.objectKey);
    await this.services.repository.deleteClaimed(id);
    this.audit({ event: "asset_delete", actorId: identity.userId, assetId: id, result: "deleted" });
  }

  async collectOrphans(): Promise<{
    deleted: number;
    deletedMetadataLess: number;
    skippedReferenced: number;
  }> {
    const before = new Date(this.services.clock.now().getTime() - orphanAgeMs);
    let deleted = 0;
    let deletedMetadataLess = 0;
    let skippedReferenced = 0;
    for (const record of await this.services.repository.findExpiredUnfinalized(before)) {
      const claimed = await this.services.repository.claimDeletion(record.id, [
        "pending",
        "failed",
        "deleting",
      ]);
      if (!claimed) {
        if (await this.services.repository.isReferenced(record.id)) skippedReferenced += 1;
        continue;
      }
      await this.services.storage.delete(claimed.objectKey);
      await this.services.repository.deleteClaimed(record.id);
      this.audit({ event: "asset_gc", assetId: record.id, result: "deleted" });
      deleted += 1;
    }
    for (const object of await this.services.storage.list("assets/")) {
      if (
        object.uploadedAt >= before ||
        (await this.services.repository.findByObjectKey(object.objectKey))
      )
        continue;
      await this.services.storage.delete(object.objectKey);
      this.audit({
        event: "asset_gc",
        objectKey: object.objectKey,
        result: "deleted_metadata_less",
      });
      deletedMetadataLess += 1;
    }
    return { deleted, deletedMetadataLess, skippedReferenced };
  }

  private async requireEditable(identity: Identity, id: string) {
    const record = await this.services.repository.findById(id);
    if (!record) throw new AssetError("not_found");
    if (!(await this.services.permission.canEdit(identity, record.presentationId)))
      throw new AssetError("forbidden");
    return record;
  }

  private async failVerification(record: AssetRecord): Promise<AssetRecord | null> {
    const failed = { ...record, status: "failed" as const, updatedAt: this.services.clock.now() };
    if (await this.services.repository.save(failed)) return null;
    const current = await this.services.repository.findById(record.id);
    return current?.status === "ready" ? current : null;
  }

  private audit(entry: Record<string, string>) {
    this.services.audit?.(entry);
  }
}
