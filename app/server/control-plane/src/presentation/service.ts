import type { PresentationDefinition } from "./schema";
import type { PresentationRecord, PresentationRepository } from "./repository";

export type Identity = { userId: string; globalRole: "admin" | "user" };
export type PresentationResource = Omit<PresentationRecord, "ownerId">;
export class PresentationError extends Error {
  constructor(readonly code: "not_found" | "forbidden" | "conflict" | "invalid_asset_reference") {
    super(code);
  }
}

export class PresentationService {
  constructor(
    private readonly repository: PresentationRepository,
    private readonly now: () => string,
    private readonly id: () => string,
  ) {}
  async create(
    identity: Identity,
    definition: PresentationDefinition,
  ): Promise<PresentationResource> {
    const timestamp = this.now();
    const record: PresentationRecord = {
      id: this.id(),
      ownerId: identity.userId,
      revision: 1,
      definition,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.create(record);
    return resource(record);
  }
  async list(identity: Identity) {
    return (
      identity.globalRole === "admin"
        ? await this.repository.listAll()
        : await this.repository.listByUser(identity.userId)
    ).map(resource);
  }
  async get(identity: Identity, id: string) {
    const record = await this.requireRead(identity, id);
    return resource(record);
  }
  async replace(
    identity: Identity,
    id: string,
    expectedRevision: number,
    definition: PresentationDefinition,
  ) {
    await this.requireWrite(identity, id);
    if (
      !(await this.repository.hasValidAssetReferences(
        id,
        definition.assets.map((asset) => asset.assetId),
      ))
    ) {
      throw new PresentationError("invalid_asset_reference");
    }
    const record = await this.repository.replace(id, expectedRevision, definition, this.now());
    if (!record) throw new PresentationError("conflict");
    return resource(record);
  }
  async delete(identity: Identity, id: string, expectedRevision: number) {
    await this.requireOwner(identity, id);
    if (!(await this.repository.delete(id, expectedRevision)))
      throw new PresentationError("conflict");
  }
  private async requireRead(identity: Identity, id: string) {
    const record = await this.repository.findById(id);
    if (!record) throw new PresentationError("not_found");
    if (identity.globalRole === "admin" || (await this.repository.roleFor(id, identity.userId)))
      return record;
    throw new PresentationError("forbidden");
  }
  private async requireWrite(identity: Identity, id: string) {
    const record = await this.repository.findById(id);
    if (!record) throw new PresentationError("not_found");
    if (identity.globalRole === "admin" || (await this.repository.roleFor(id, identity.userId)))
      return record;
    throw new PresentationError("forbidden");
  }
  private async requireOwner(identity: Identity, id: string) {
    const record = await this.repository.findById(id);
    if (!record) throw new PresentationError("not_found");
    if (
      identity.globalRole === "admin" ||
      (await this.repository.roleFor(id, identity.userId)) === "owner"
    )
      return record;
    throw new PresentationError("forbidden");
  }
}
const resource = ({ ownerId: _ownerId, ...record }: PresentationRecord): PresentationResource =>
  record;
