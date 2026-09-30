import { matchesMagicBytes } from "./magic";
import type { AssetInitInput, AssetMediaType } from "./schema";
import type { Identity } from "../../presentation/service";

export type AssetStatus = "pending" | "ready" | "failed" | "deleting";
export type AssetRecord = {
  createdAt: Date;
  expiresAt: string;
  id: string;
  mediaType: AssetMediaType;
  name: string;
  objectKey: string;
  ownerId: string;
  presentationId: string;
  sha256Hex: string;
  sizeBytes: number;
  status: AssetStatus;
  updatedAt: Date;
};

export type AssetRepository = {
  claimDeletion(id: string, statuses: ReadonlyArray<AssetStatus>): Promise<AssetRecord | null>;
  create(record: AssetRecord): Promise<void>;
  deleteClaimed(id: string): Promise<void>;
  findById(id: string): Promise<AssetRecord | null>;
  findByObjectKey(objectKey: string): Promise<AssetRecord | null>;
  findExpiredUnfinalized(before: Date): Promise<Array<AssetRecord>>;
  isReferenced(id: string): Promise<boolean>;
  save(record: AssetRecord): Promise<boolean>;
};

export type PresentationPermission = {
  canEdit(identity: Identity, presentationId: string): Promise<boolean>;
  canRead(identity: Identity, presentationId: string): Promise<boolean>;
};

export type ObjectStorage = {
  delete(objectKey: string): Promise<void>;
  head(
    objectKey: string,
  ): Promise<{ mediaType: string; sha256Hex: string; sizeBytes: number } | null>;
  list(prefix: string): Promise<Array<{ objectKey: string; uploadedAt: Date }>>;
  prefix(objectKey: string): Promise<Uint8Array | null>;
};

export type PutAccess = {
  expiresAt: Date;
  headers: {
    "content-length": string;
    "content-type": AssetMediaType;
    "x-amz-checksum-sha256": string;
  };
  method: "PUT";
  url: string;
};

export type DownloadAccess = { expiresAt: Date; method: "GET"; url: string };

export type SignedAccess = {
  issueDownload(input: { expiresAt: Date; objectKey: string }): Promise<DownloadAccess>;
  issuePut(input: {
    expiresAt: Date;
    mediaType: AssetMediaType;
    objectKey: string;
    sha256Hex: string;
    sizeBytes: number;
  }): Promise<PutAccess>;
};

export type Clock = { now(): Date };

export type AssetId = { next(): string; random(): string };

export type AssetServices = {
  audit?: (entry: Record<string, string>) => void;
  clock: Clock;
  id: AssetId;
  permission: PresentationPermission;
  repository: AssetRepository;
  signedAccess: SignedAccess;
  storage: ObjectStorage;
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
    if (!(await this.services.permission.canEdit(identity, input.presentationId))) {
      throw new AssetError("forbidden");
    }
    const createdAt = this.services.clock.now();
    const expiresAt = new Date(createdAt.getTime() + putAccessDurationMs);
    const id = this.services.id.next();
    const record: AssetRecord = {
      createdAt,
      expiresAt: expiresAt.toISOString(),
      id,
      mediaType: input.mediaType,
      name: input.name,
      objectKey: `assets/${id}/${this.services.id.random()}`,
      ownerId: identity.userId,
      presentationId: input.presentationId,
      sha256Hex: input.sha256Hex,
      sizeBytes: input.sizeBytes,
      status: "pending",
      updatedAt: createdAt,
    };
    await this.services.repository.create(record);
    let putAccess: PutAccess;
    try {
      putAccess = await this.services.signedAccess.issuePut({
        expiresAt,
        mediaType: record.mediaType,
        objectKey: record.objectKey,
        sha256Hex: record.sha256Hex,
        sizeBytes: record.sizeBytes,
      });
    } catch {
      throw new AssetError("access_unavailable");
    }
    return { asset: record, putAccess };
  }

  async finalize(identity: Identity, id: string): Promise<AssetRecord> {
    const record = await this.requireEditable(identity, id);
    if (record.status === "ready") {
      return record;
    }
    if (this.services.clock.now() >= new Date(record.expiresAt)) {
      const ready = await this.failVerification(record);
      if (ready) {
        return ready;
      }
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
      if (ready) {
        return ready;
      }
      throw new AssetError("verification_failed");
    }
    const ready = { ...record, status: "ready" as const, updatedAt: this.services.clock.now() };
    if (await this.services.repository.save(ready)) {
      return ready;
    }
    const current = await this.services.repository.findById(id);
    if (current?.status === "ready") {
      return current;
    }
    throw new AssetError("verification_failed");
  }

  async get(identity: Identity, id: string): Promise<AssetRecord> {
    const record = await this.services.repository.findById(id);
    if (!record) {
      throw new AssetError("not_found");
    }
    if (!(await this.services.permission.canRead(identity, record.presentationId))) {
      throw new AssetError("forbidden");
    }
    return record;
  }

  async download(identity: Identity, id: string): Promise<DownloadAccess> {
    const record = await this.services.repository.findById(id);
    if (!record) {
      throw new AssetError("not_found");
    }
    if (!(await this.services.permission.canRead(identity, record.presentationId))) {
      throw new AssetError("forbidden");
    }
    if (record.status !== "ready" || !(await this.services.repository.isReferenced(id))) {
      throw new AssetError("access_unavailable");
    }
    try {
      return await this.services.signedAccess.issueDownload({
        expiresAt: new Date(this.services.clock.now().getTime() + putAccessDurationMs),
        objectKey: record.objectKey,
      });
    } catch {
      throw new AssetError("access_unavailable");
    }
  }

  async delete(identity: Identity, id: string): Promise<void> {
    const record = await this.services.repository.findById(id);
    if (!record) {
      return;
    }
    if (!(await this.services.permission.canEdit(identity, record.presentationId))) {
      throw new AssetError("forbidden");
    }
    const claimed = await this.services.repository.claimDeletion(id, [
      "pending",
      "ready",
      "failed",
      "deleting",
    ]);
    if (!claimed) {
      if (await this.services.repository.isReferenced(id)) {
        throw new AssetError("referenced");
      }
      return;
    }
    await this.services.storage.delete(claimed.objectKey);
    await this.services.repository.deleteClaimed(id);
    this.audit({ actorId: identity.userId, assetId: id, event: "asset_delete", result: "deleted" });
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
        if (await this.services.repository.isReferenced(record.id)) {
          skippedReferenced += 1;
        }
        continue;
      }
      await this.services.storage.delete(claimed.objectKey);
      await this.services.repository.deleteClaimed(record.id);
      this.audit({ assetId: record.id, event: "asset_gc", result: "deleted" });
      deleted += 1;
    }
    for (const object of await this.services.storage.list("assets/")) {
      if (
        object.uploadedAt >= before ||
        (await this.services.repository.findByObjectKey(object.objectKey))
      ) {
        continue;
      }
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
    if (!record) {
      throw new AssetError("not_found");
    }
    if (!(await this.services.permission.canEdit(identity, record.presentationId))) {
      throw new AssetError("forbidden");
    }
    return record;
  }

  private async failVerification(record: AssetRecord): Promise<AssetRecord | null> {
    const failed = { ...record, status: "failed" as const, updatedAt: this.services.clock.now() };
    if (await this.services.repository.save(failed)) {
      return null;
    }
    const current = await this.services.repository.findById(record.id);
    return current?.status === "ready" ? current : null;
  }

  private audit(entry: Record<string, string>) {
    this.services.audit?.(entry);
  }
}
