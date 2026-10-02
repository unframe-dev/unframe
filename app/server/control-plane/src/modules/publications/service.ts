import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrityV2,
  verifyPublicationIntegrityV2,
  validatePresentationArtifacts,
  type BuildArtifactsV2,
} from "@unframe/unframe-core";
import type { PublishedPresentationV2 } from "@unframe/contracts/presentation/v2";
import type { Identity } from "../../presentation/service";

export class PublicationError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "conflict" | "invalid_build" | "invalid_asset",
  ) {
    super(code);
  }
}

export type BuildUpload = {
  definitionJson: string;
  renderBundleJson: string;
  assetSetJson: string;
  buildManifestJson: string;
};

const parseCanonical = (value: string) => {
  try {
    if (new TextEncoder().encode(value).byteLength > 8 * 1024 * 1024)
      throw new PublicationError("invalid_build");
    const parsed = JSON.parse(value) as unknown;
    if (canonicalizeJsonPayload(parsed) !== value) throw new PublicationError("invalid_build");
    return parsed;
  } catch {
    throw new PublicationError("invalid_build");
  }
};

const assetKey = (presentationId: string, buildId: string, assetId: string) =>
  `publication-builds/${presentationId}/${buildId}/${assetId}`;
const sha256 = async (bytes: ArrayBuffer) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

export class PublicationService {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private async authorize(identity: Identity, presentationId: string, write: boolean) {
    const record = await this.db
      .prepare("SELECT revision FROM presentations WHERE id = ?")
      .bind(presentationId)
      .first<{ revision: number }>();
    if (!record) throw new PublicationError("not_found");
    if (identity.globalRole !== "admin") {
      const member = await this.db
        .prepare("SELECT role FROM presentation_members WHERE presentation_id = ? AND user_id = ?")
        .bind(presentationId, identity.userId)
        .first<{ role: string }>();
      if (!member || (write && member.role !== "owner" && member.role !== "editor"))
        throw new PublicationError("forbidden");
    }
    return record;
  }

  async authorizeBuildUpload(identity: Identity, presentationId: string): Promise<void> {
    await this.authorize(identity, presentationId, true);
  }

  async createBuild(identity: Identity, presentationId: string, input: BuildUpload) {
    const record = await this.authorize(identity, presentationId, true);
    const parsed = verifyBuildIntegrityV2({
      definition: parseCanonical(input.definitionJson),
      renderBundle: parseCanonical(input.renderBundleJson),
      assetSet: parseCanonical(input.assetSetJson),
      buildManifest: parseCanonical(input.buildManifestJson),
    });
    if (!parsed.valid) throw new PublicationError("invalid_build");
    const artifacts = parsed.value;
    if (
      artifacts.buildManifest.presentationId !== presentationId ||
      !validatePresentationArtifacts(artifacts.definition, artifacts.renderBundle, {
        fullDelivery: true,
      }).valid
    )
      throw new PublicationError("invalid_build");
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO presentation_builds
       (presentation_id, build_id, target_revision, artifacts, created_at)
       SELECT ?, ?, ?, ?, ? WHERE EXISTS
       (SELECT 1 FROM presentations WHERE id = ? AND revision = ?)`,
      )
      .bind(
        presentationId,
        artifacts.buildManifest.buildId,
        record.revision,
        JSON.stringify(artifacts),
        this.now(),
        presentationId,
        record.revision,
      )
      .run();
    if (result.meta.changes !== 1) throw new PublicationError("conflict");
    return {
      buildId: artifacts.buildManifest.buildId,
      assetIds: Object.keys(artifacts.assetSet.assets),
    };
  }

  private async build(identity: Identity, presentationId: string, buildId: string, write: boolean) {
    await this.authorize(identity, presentationId, write);
    const row = await this.db
      .prepare(
        "SELECT artifacts FROM presentation_builds WHERE presentation_id = ? AND build_id = ?",
      )
      .bind(presentationId, buildId)
      .first<{ artifacts: string }>();
    if (!row) throw new PublicationError("not_found");
    const parsed = verifyBuildIntegrityV2(JSON.parse(row.artifacts));
    if (!parsed.valid) throw new PublicationError("invalid_build");
    return parsed.value;
  }

  async expectedAsset(
    identity: Identity,
    presentationId: string,
    buildId: string,
    assetId: string,
  ) {
    const artifacts = await this.build(identity, presentationId, buildId, true);
    const descriptor = artifacts.assetSet.assets[assetId];
    if (!descriptor) throw new PublicationError("invalid_asset");
    return descriptor;
  }

  async uploadAsset(
    identity: Identity,
    presentationId: string,
    buildId: string,
    assetId: string,
    bytes: ArrayBuffer,
    mediaType: string,
  ) {
    const artifacts = await this.build(identity, presentationId, buildId, true);
    const descriptor = artifacts.assetSet.assets[assetId];
    if (
      !descriptor ||
      descriptor.mediaType !== mediaType ||
      descriptor.encodedSizeBytes !== bytes.byteLength ||
      descriptor.checksum !== (await sha256(bytes))
    )
      throw new PublicationError("invalid_asset");
    await this.bucket.put(assetKey(presentationId, buildId, assetId), bytes, {
      httpMetadata: { contentType: mediaType },
      sha256: descriptor.checksum.slice(7),
    });
  }

  async publish(
    identity: Identity,
    presentationId: string,
    buildId: string,
    expectedPublicationEpoch: number,
  ) {
    const record = await this.authorize(identity, presentationId, true);
    const artifacts = await this.build(identity, presentationId, buildId, true);
    const build = await this.db
      .prepare(
        "SELECT target_revision AS targetRevision FROM presentation_builds WHERE presentation_id = ? AND build_id = ?",
      )
      .bind(presentationId, buildId)
      .first<{ targetRevision: number }>();
    if (build?.targetRevision !== record.revision) throw new PublicationError("conflict");
    for (const [assetId, descriptor] of Object.entries(artifacts.assetSet.assets)) {
      const object = await this.bucket.get(assetKey(presentationId, buildId, assetId));
      if (
        !object ||
        object.httpMetadata?.contentType !== descriptor.mediaType ||
        object.size !== descriptor.encodedSizeBytes ||
        (await sha256(await object.arrayBuffer())) !== descriptor.checksum
      )
        throw new PublicationError("invalid_asset");
    }
    const payload = {
      ...artifacts.buildManifest,
      publicationEpoch: expectedPublicationEpoch + 1,
    };
    const manifest: PublishedPresentationV2 = {
      ...payload,
      publicationManifestHash: hashCanonicalJsonPayload(payload),
    };
    if (!verifyPublicationIntegrityV2({ ...artifacts, publishedPresentation: manifest }).valid)
      throw new PublicationError("invalid_build");
    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO presentation_publications
       (presentation_id, epoch, build_id, manifest, published_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM presentations WHERE id = ? AND revision = ?)
         AND EXISTS (SELECT 1 FROM presentation_builds WHERE presentation_id = ? AND build_id = ? AND target_revision = ?)
         AND (SELECT COALESCE(MAX(epoch), 0) FROM presentation_publications WHERE presentation_id = ?) = ?
         AND NOT EXISTS (
           SELECT 1 FROM presentation_sessions
           WHERE presentation_id = ? AND state != 'Ended'
         )`,
      )
      .bind(
        presentationId,
        manifest.publicationEpoch,
        buildId,
        JSON.stringify(manifest),
        this.now(),
        presentationId,
        record.revision,
        presentationId,
        buildId,
        record.revision,
        presentationId,
        expectedPublicationEpoch,
        presentationId,
      )
      .run();
    if (inserted.meta.changes !== 1) throw new PublicationError("conflict");
    return manifest;
  }

  async latest(identity: Identity, presentationId: string) {
    await this.authorize(identity, presentationId, false);
    const row = await this.db
      .prepare(
        "SELECT manifest FROM presentation_publications WHERE presentation_id = ? ORDER BY epoch DESC LIMIT 1",
      )
      .bind(presentationId)
      .first<{ manifest: string }>();
    if (!row) throw new PublicationError("not_found");
    return JSON.parse(row.manifest) as PublishedPresentationV2;
  }

  async publishedArtifacts(
    presentationId: string,
    epoch?: number,
  ): Promise<BuildArtifactsV2 & { publishedPresentation: PublishedPresentationV2 }> {
    const row = await this.db
      .prepare(
        `SELECT build.artifacts AS artifacts, publication.manifest AS manifest
       FROM presentation_publications AS publication
       JOIN presentation_builds AS build
         ON build.presentation_id = publication.presentation_id AND build.build_id = publication.build_id
       WHERE publication.presentation_id = ? AND (? IS NULL OR publication.epoch = ?)
       ORDER BY publication.epoch DESC LIMIT 1`,
      )
      .bind(presentationId, epoch ?? null, epoch ?? null)
      .first<{ artifacts: string; manifest: string }>();
    if (!row) throw new PublicationError("not_found");
    const parsed = verifyPublicationIntegrityV2({
      ...JSON.parse(row.artifacts),
      publishedPresentation: JSON.parse(row.manifest),
    });
    if (
      !parsed.valid ||
      !validatePresentationArtifacts(parsed.value.definition, parsed.value.renderBundle, {
        fullDelivery: true,
      }).valid
    )
      throw new PublicationError("invalid_build");
    return parsed.value;
  }
}
