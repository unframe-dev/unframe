import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
  verifyPublicationIntegrity,
  validatePresentationArtifacts,
  type BuildArtifacts,
} from "@unframe/core";
import {
  publicationFenceSchema,
  type PublishedPresentation,
} from "@unframe/contracts/presentation";
import type { z } from "zod";
import { and, desc, eq, exists } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import {
  presentations,
  presentationMembers,
  presentationBuilds,
  presentationPublications,
} from "../../adapters/d1/schema";

import type { Identity } from "../../presentation/service";

import { firstThumbnailTexture } from "./thumbnail";

export type PublicationFence = z.infer<typeof publicationFenceSchema>;

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
  private readonly orm;
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.orm = createD1Database(db);
  }

  private async authorize(identity: Identity, presentationId: string, write: boolean) {
    const record = await this.orm
      .select({ revision: presentations.revision })
      .from(presentations)
      .where(eq(presentations.id, presentationId))
      .get();
    if (!record) throw new PublicationError("not_found");
    if (identity.globalRole !== "admin") {
      const member = await this.orm
        .select({ role: presentationMembers.role })
        .from(presentationMembers)
        .where(
          and(
            eq(presentationMembers.presentationId, presentationId),
            eq(presentationMembers.userId, identity.userId),
          ),
        )
        .get();
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
    const parsed = verifyBuildIntegrity({
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
       (SELECT 1 FROM presentations WHERE id = ?)
       AND (? = 'admin' OR EXISTS (SELECT 1 FROM presentation_members WHERE presentation_id = ? AND user_id = ?))`,
      )
      .bind(
        presentationId,
        artifacts.buildManifest.buildId,
        record.revision,
        JSON.stringify(artifacts),
        this.now(),
        presentationId,
        identity.globalRole,
        presentationId,
        identity.userId,
      )
      .run();
    if (result.meta.changes !== 1) {
      await this.authorize(identity, presentationId, true);
      const existing = await this.orm
        .select({ artifacts: presentationBuilds.artifacts })
        .from(presentationBuilds)
        .where(
          and(
            eq(presentationBuilds.presentationId, presentationId),
            eq(presentationBuilds.buildId, artifacts.buildManifest.buildId),
          ),
        )
        .get();
      if (
        !existing ||
        canonicalizeJsonPayload(JSON.parse(existing.artifacts)) !==
          canonicalizeJsonPayload(artifacts)
      )
        throw new PublicationError("conflict");
    }
    return {
      buildId: artifacts.buildManifest.buildId,
      assetIds: Object.keys(artifacts.assetSet.assets),
    };
  }

  private async build(identity: Identity, presentationId: string, buildId: string, write: boolean) {
    await this.authorize(identity, presentationId, write);
    const row = await this.orm
      .select({ artifacts: presentationBuilds.artifacts })
      .from(presentationBuilds)
      .where(
        and(
          eq(presentationBuilds.presentationId, presentationId),
          eq(presentationBuilds.buildId, buildId),
        ),
      )
      .get();
    if (!row) throw new PublicationError("not_found");
    const parsed = verifyBuildIntegrity(JSON.parse(row.artifacts));
    if (!parsed.valid) throw new PublicationError("invalid_build");
    return parsed.value;
  }

  async thumbnail(identity: Identity, presentationId: string, buildId: string) {
    let artifacts: BuildArtifacts;
    try {
      artifacts = await this.build(identity, presentationId, buildId, false);
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        (error instanceof PublicationError && error.code === "invalid_build")
      )
        throw new PublicationError("conflict");
      throw error;
    }
    if (
      artifacts.buildManifest.presentationId !== presentationId ||
      artifacts.buildManifest.buildId !== buildId
    )
      throw new PublicationError("conflict");
    const assetId = firstThumbnailTexture(artifacts.renderBundle);
    if (!assetId) throw new PublicationError("not_found");
    const result = await this.downloadPublishedAsset(presentationId, buildId, assetId);
    if (result.mediaType !== "image/png") throw new PublicationError("conflict");
    return result.bytes;
  }

  async downloadPublishedAsset(presentationId: string, buildId: string, assetId: string) {
    const row = await this.orm
      .select({ artifacts: presentationBuilds.artifacts })
      .from(presentationBuilds)
      .where(
        and(
          eq(presentationBuilds.presentationId, presentationId),
          eq(presentationBuilds.buildId, buildId),
          exists(
            this.orm
              .select({ epoch: presentationPublications.epoch })
              .from(presentationPublications)
              .where(
                and(
                  eq(presentationPublications.presentationId, presentationBuilds.presentationId),
                  eq(presentationPublications.buildId, presentationBuilds.buildId),
                ),
              ),
          ),
        ),
      )
      .get();
    if (!row) throw new PublicationError("not_found");
    let input: unknown;
    try {
      input = JSON.parse(row.artifacts);
    } catch {
      throw new PublicationError("conflict");
    }
    const verified = verifyBuildIntegrity(input);
    if (
      !verified.valid ||
      verified.value.buildManifest.presentationId !== presentationId ||
      verified.value.buildManifest.buildId !== buildId
    )
      throw new PublicationError("conflict");
    const descriptor = verified.value.assetSet.assets[assetId];
    if (!descriptor) throw new PublicationError("not_found");
    const object = await this.bucket.get(assetKey(presentationId, buildId, assetId));
    if (!object) throw new PublicationError("not_found");
    if (
      object.size !== descriptor.encodedSizeBytes ||
      object.size > 256 * 1024 * 1024 ||
      object.httpMetadata?.contentType !== descriptor.mediaType
    )
      throw new PublicationError("conflict");
    const bytes = await object.arrayBuffer();
    if (
      bytes.byteLength !== descriptor.encodedSizeBytes ||
      (await sha256(bytes)) !== descriptor.checksum
    )
      throw new PublicationError("conflict");
    return { bytes, mediaType: descriptor.mediaType };
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
    expectedPublicationFence: PublicationFence | null,
  ) {
    await this.authorize(identity, presentationId, true);
    if (
      expectedPublicationFence !== null &&
      (!publicationFenceSchema.safeParse(expectedPublicationFence).success ||
        expectedPublicationFence.presentationId !== presentationId)
    )
      throw new PublicationError("conflict");
    const nextEpoch = (expectedPublicationFence?.publicationEpoch ?? 0) + 1;
    if (!Number.isSafeInteger(nextEpoch)) throw new PublicationError("conflict");
    const artifacts = await this.build(identity, presentationId, buildId, true);
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
      publicationEpoch: nextEpoch,
    };
    const manifest: PublishedPresentation = {
      ...payload,
      publicationManifestHash: hashCanonicalJsonPayload(payload),
    };
    if (!verifyPublicationIntegrity({ ...artifacts, publishedPresentation: manifest }).valid)
      throw new PublicationError("invalid_build");
    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO presentation_publications
       (presentation_id, epoch, build_id, manifest, published_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM presentations WHERE id = ?)
         AND EXISTS (SELECT 1 FROM presentation_builds WHERE presentation_id = ? AND build_id = ?)
         AND (? = 'admin' OR EXISTS (SELECT 1 FROM presentation_members WHERE presentation_id = ? AND user_id = ?))
         AND (
           (? = 1 AND NOT EXISTS (SELECT 1 FROM presentation_publications WHERE presentation_id = ?))
           OR (? = 0 AND EXISTS (
             SELECT 1 FROM (
               SELECT epoch, manifest FROM presentation_publications
               WHERE presentation_id = ? ORDER BY epoch DESC LIMIT 1
             ) current
             WHERE current.epoch = ?
               AND json_extract(current.manifest, '$.presentationId') = ?
               AND json_extract(current.manifest, '$.publicationManifestHash') = ?
           ))
         )
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
        presentationId,
        buildId,
        identity.globalRole,
        presentationId,
        identity.userId,
        expectedPublicationFence === null ? 1 : 0,
        presentationId,
        expectedPublicationFence === null ? 1 : 0,
        presentationId,
        expectedPublicationFence?.publicationEpoch ?? 0,
        expectedPublicationFence?.presentationId ?? "",
        expectedPublicationFence?.publicationManifestHash ?? "",
        presentationId,
      )
      .run();
    if (inserted.meta.changes !== 1) throw new PublicationError("conflict");
    return manifest;
  }

  async latest(identity: Identity, presentationId: string) {
    await this.authorize(identity, presentationId, false);
    const row = await this.orm
      .select({ manifest: presentationPublications.manifest })
      .from(presentationPublications)
      .where(eq(presentationPublications.presentationId, presentationId))
      .orderBy(desc(presentationPublications.epoch))
      .limit(1)
      .get();
    if (!row) throw new PublicationError("not_found");
    return JSON.parse(row.manifest) as PublishedPresentation;
  }

  async publishedArtifacts(
    presentationId: string,
    epoch?: number,
  ): Promise<BuildArtifacts & { publishedPresentation: PublishedPresentation }> {
    const row = await this.orm
      .select({
        artifacts: presentationBuilds.artifacts,
        manifest: presentationPublications.manifest,
      })
      .from(presentationPublications)
      .innerJoin(
        presentationBuilds,
        and(
          eq(presentationBuilds.presentationId, presentationPublications.presentationId),
          eq(presentationBuilds.buildId, presentationPublications.buildId),
        ),
      )
      .where(
        and(
          eq(presentationPublications.presentationId, presentationId),
          epoch === undefined ? undefined : eq(presentationPublications.epoch, epoch),
        ),
      )
      .orderBy(desc(presentationPublications.epoch))
      .limit(1)
      .get();
    if (!row) throw new PublicationError("not_found");
    const parsed = verifyPublicationIntegrity({
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
