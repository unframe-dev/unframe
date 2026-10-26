import { OpenAPIHono } from "@hono/zod-openapi";
import {
  capabilityProfileSchema,
  publishedPresentationSchema,
} from "@unframe/contracts/presentation";
import {
  buildProjectionProfile,
  hashCanonicalJsonPayload,
  selectDeliveryArtifacts,
} from "@unframe/unframe-core";
import type { AppEnvironment } from "../../config";
import {
  internalRuntimeBootstrapRoute,
  internalRuntimeAssetRoute,
  internalRuntimeLeaseRoute,
  internalRuntimeProjectionRoute,
} from "../../openapi";
import { ServiceIdentity } from "../persistence-callback/service-identity";
import { parseCheckpointJson } from "../persistence-callback/checkpoint";
import { R2Presigner } from "../../adapters/assets/r2-presigner";
import { RuntimeAssignmentService, RuntimeAssignmentError } from "../runtime-assignments/service";
import { D1RuntimeAssignmentRepository } from "../runtime-assignments/repository";
import { normalizedCapability } from "./capability";
import { PublicationError, PublicationService } from "./service";

export function createRuntimePublicationRoutes() {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json({ error: { code: "validation_error", message: "Invalid request" } }, 400),
  });
  app.use("/internal/runtime/*", async (context, next) => {
    if (
      !(await new ServiceIdentity(context.get("config").SERVICE_IDENTITY_SECRET).authenticate(
        context.req.raw,
      ))
    )
      return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    await next();
  });
  return app
    .openapi(internalRuntimeAssetRoute, async (context) => {
      const query = context.req.valid("query");
      const config = context.get("config");
      const assignments = new RuntimeAssignmentService(
        new D1RuntimeAssignmentRepository(config.DB),
        () => new Date(),
      );
      const conflict = () =>
        context.json({ error: { code: "conflict", message: "Runtime fence unavailable" } }, 409);
      const forbidden = () =>
        context.json(
          { error: { code: "forbidden", message: "Asset not selected for participant" } },
          403,
        );
      try {
        const assignment = await assignments.active(query.sessionId);
        if (
          assignment.runtimeKind !== "VenueEdge" ||
          assignment.runtimeId !== query.runtimeId ||
          assignment.assignmentEpoch !== query.assignmentEpoch
        )
          return conflict();
        const participant = await config.DB.prepare(
          `SELECT session.presentation_id AS presentationId, session.publication_epoch AS publicationEpoch,
                  participant.role, selection.capability_profile_id AS capabilityProfileId
           FROM presentation_sessions AS session
           JOIN session_participants AS participant ON participant.session_id = session.id
           JOIN session_participant_capabilities AS selection ON selection.session_id = session.id AND selection.user_id = participant.user_id
           WHERE session.id = ? AND participant.user_id = ? AND session.state != 'Ended'`,
        )
          .bind(query.sessionId, query.participantId)
          .first<{
            presentationId: string;
            publicationEpoch: number | null;
            role: "presenter" | "viewer";
            capabilityProfileId: string;
          }>();
        if (!participant || participant.publicationEpoch === null) return forbidden();
        const artifacts = await new PublicationService(config.DB, config.ASSETS).publishedArtifacts(
          participant.presentationId,
          participant.publicationEpoch,
        );
        const selection = selectDeliveryArtifacts(
          { ...artifacts, capability: normalizedCapability(participant.capabilityProfileId) },
          participant.role,
        );
        const asset = selection.assets.find((candidate) => candidate.assetId === query.assetId);
        if (!asset) return forbidden();
        const current = await assignments.active(query.sessionId);
        if (
          current.runtimeId !== assignment.runtimeId ||
          current.assignmentEpoch !== assignment.assignmentEpoch
        )
          return conflict();
        const present = await config.DB.prepare(
          `SELECT 1 FROM presentation_sessions AS session JOIN session_participants AS participant ON participant.session_id = session.id
           JOIN session_participant_capabilities AS selection ON selection.session_id = session.id AND selection.user_id = participant.user_id
           WHERE session.id = ? AND participant.user_id = ? AND participant.role = ? AND session.publication_epoch = ? AND session.state != 'Ended' AND selection.capability_profile_id = ?`,
        )
          .bind(
            query.sessionId,
            query.participantId,
            participant.role,
            participant.publicationEpoch,
            participant.capabilityProfileId,
          )
          .first();
        if (!present) return forbidden();
        const expiresAt = new Date(
          Math.min(Date.now() + 60_000, new Date(current.leaseExpiresAt).getTime()),
        );
        if (expiresAt.getTime() <= Date.now()) return conflict();
        const { url } = await new R2Presigner(config).issueDownload({
          objectKey: `publication-builds/${participant.presentationId}/${artifacts.buildManifest.buildId}/${asset.assetId}`,
          expiresAt,
        });
        const publication = artifacts.publishedPresentation;
        return context.json(
          {
            assignment: {
              sessionId: current.sessionId,
              runtimeId: current.runtimeId,
              runtimeKind: current.runtimeKind,
              assignmentEpoch: current.assignmentEpoch,
              presentationRevision: current.presentationRevision,
              leaseExpiresAt: current.leaseExpiresAt,
            },
            publication: {
              presentationId: publication.presentationId,
              publicationEpoch: publication.publicationEpoch,
              publicationManifestHash: publication.publicationManifestHash,
              definitionHash: publication.definitionHash,
              renderBundleHash: publication.renderBundleHash,
            },
            url,
            checksum: asset.descriptor.checksum,
            size: asset.descriptor.encodedSizeBytes,
            mediaType: asset.descriptor.mediaType,
          },
          200,
        );
      } catch (error) {
        if (error instanceof RuntimeAssignmentError || error instanceof PublicationError)
          return conflict();
        throw error;
      }
    })
    .openapi(internalRuntimeBootstrapRoute, async (context) => {
      const { sessionId, runtimeId, assignmentEpoch } = context.req.valid("query");
      const { DB, ASSETS } = context.get("config");
      const now = new Date().toISOString();
      const row = await DB.prepare(
        `SELECT session.presentation_id AS presentationId,
                session.publication_epoch AS publicationEpoch,
                assignment.runtime_kind AS runtimeKind,
                assignment.revision AS presentationRevision,
                assignment.lease_expires_at AS leaseExpiresAt
         FROM presentation_sessions AS session
         JOIN runtime_assignments AS assignment ON assignment.session_id = session.id
         WHERE session.id = ? AND session.state != 'Ended'
           AND assignment.runtime_id = ? AND assignment.epoch = ?
           AND assignment.released_at IS NULL AND assignment.lease_expires_at > ?`,
      )
        .bind(sessionId, runtimeId, assignmentEpoch, now)
        .first<{
          presentationId: string;
          publicationEpoch: number | null;
          runtimeKind: "Cloud" | "VenueEdge";
          presentationRevision: number;
          leaseExpiresAt: string;
        }>();
      if (!row || row.publicationEpoch === null)
        return context.json(
          { error: { code: "conflict", message: "Runtime fence unavailable" } },
          409,
        );
      const artifacts = await new PublicationService(DB, ASSETS).publishedArtifacts(
        row.presentationId,
        row.publicationEpoch,
      );
      const publication = artifacts.publishedPresentation;
      const checkpoint = await DB.prepare(
        "SELECT payload FROM session_checkpoints WHERE session_id = ? ORDER BY version DESC LIMIT 1",
      )
        .bind(sessionId)
        .first<{ payload: string }>();
      let restoredCheckpoint: Record<string, unknown> | null = null;
      if (checkpoint) {
        restoredCheckpoint = await parseCheckpointJson(checkpoint.payload);
      }
      const result = {
        assignment: {
          sessionId,
          runtimeId,
          runtimeKind: row.runtimeKind,
          assignmentEpoch,
          presentationRevision: row.presentationRevision,
          leaseExpiresAt: row.leaseExpiresAt,
        },
        publication: {
          presentationId: publication.presentationId,
          publicationEpoch: publication.publicationEpoch,
          publicationManifestHash: publication.publicationManifestHash,
          definitionHash: publication.definitionHash,
          renderBundleHash: publication.renderBundleHash,
        },
        definition: artifacts.definition,
        renderBundle: artifacts.renderBundle,
        checkpoint: restoredCheckpoint,
      };
      const current = await DB.prepare(
        `SELECT 1 FROM presentation_sessions AS session
         JOIN runtime_assignments AS assignment ON assignment.session_id = session.id
         WHERE session.id = ? AND session.state != 'Ended' AND session.publication_epoch = ?
           AND assignment.runtime_id = ? AND assignment.epoch = ?
           AND assignment.released_at IS NULL AND assignment.lease_expires_at > ?`,
      )
        .bind(sessionId, row.publicationEpoch, runtimeId, assignmentEpoch, new Date().toISOString())
        .first();
      if (!current)
        return context.json({ error: { code: "conflict", message: "Runtime fence changed" } }, 409);
      return context.json(result, 200);
    })
    .openapi(internalRuntimeLeaseRoute, async (context) => {
      const { sessionId, runtimeId, assignmentEpoch } = context.req.valid("query");
      const { DB } = context.get("config");
      const row = await DB.prepare(
        `SELECT session.presentation_id AS presentationId,
                session.publication_epoch AS publicationEpoch,
                assignment.runtime_kind AS runtimeKind,
                assignment.revision AS presentationRevision,
                assignment.lease_expires_at AS leaseExpiresAt,
                publication.manifest AS manifest
         FROM presentation_sessions AS session
         JOIN runtime_assignments AS assignment ON assignment.session_id = session.id
         JOIN presentation_publications AS publication
           ON publication.presentation_id = session.presentation_id
           AND publication.epoch = session.publication_epoch
         WHERE session.id = ? AND session.state != 'Ended'
           AND assignment.runtime_id = ? AND assignment.epoch = ?
           AND assignment.released_at IS NULL AND assignment.lease_expires_at > ?`,
      )
        .bind(sessionId, runtimeId, assignmentEpoch, new Date().toISOString())
        .first<{
          presentationId: string;
          publicationEpoch: number;
          runtimeKind: "Cloud" | "VenueEdge";
          presentationRevision: number;
          leaseExpiresAt: string;
          manifest: string;
        }>();
      const conflict = () =>
        context.json({ error: { code: "conflict", message: "Runtime fence unavailable" } }, 409);
      if (!row) return conflict();
      let manifest: unknown;
      try {
        manifest = JSON.parse(row.manifest);
      } catch {
        return conflict();
      }
      const parsed = publishedPresentationSchema.safeParse(manifest);
      if (!parsed.success) return conflict();
      const { publicationManifestHash, ...payload } = parsed.data;
      if (
        parsed.data.presentationId !== row.presentationId ||
        parsed.data.publicationEpoch !== row.publicationEpoch ||
        hashCanonicalJsonPayload(payload) !== publicationManifestHash
      )
        return conflict();
      return context.json(
        {
          assignment: {
            sessionId,
            runtimeId,
            runtimeKind: row.runtimeKind,
            assignmentEpoch,
            presentationRevision: row.presentationRevision,
            leaseExpiresAt: row.leaseExpiresAt,
          },
          publication: {
            presentationId: row.presentationId,
            publicationEpoch: row.publicationEpoch,
            publicationManifestHash,
            definitionHash: parsed.data.definitionHash,
            renderBundleHash: parsed.data.renderBundleHash,
          },
        },
        200,
      );
    })
    .openapi(internalRuntimeProjectionRoute, async (context) => {
      const { sessionId, participantId } = context.req.valid("query");
      const { DB, ASSETS } = context.get("config");
      const row = await DB.prepare(
        `SELECT session.presentation_id AS presentationId,
                session.publication_epoch AS publicationEpoch,
                participant.role AS role,
                selection.capability_json AS capabilityJson,
                selection.projection_profile_id AS projectionProfileId
         FROM presentation_sessions AS session
         JOIN session_participants AS participant ON participant.session_id = session.id
         JOIN session_participant_capabilities AS selection
           ON selection.session_id = participant.session_id AND selection.user_id = participant.user_id
         WHERE session.id = ? AND participant.user_id = ? AND session.state != 'Ended'`,
      )
        .bind(sessionId, participantId)
        .first<{
          presentationId: string;
          publicationEpoch: number | null;
          role: "presenter" | "viewer";
          capabilityJson: string;
          projectionProfileId: string;
        }>();
      if (!row || row.publicationEpoch === null)
        return context.json(
          { error: { code: "not_found", message: "Participant projection unavailable" } },
          404,
        );
      const artifacts = await new PublicationService(DB, ASSETS).publishedArtifacts(
        row.presentationId,
        row.publicationEpoch,
      );
      const capability = capabilityProfileSchema.parse(JSON.parse(row.capabilityJson));
      const { profile } = buildProjectionProfile({ ...artifacts, capability }, row.role);
      if (profile.projectionProfileId !== row.projectionProfileId)
        return context.json(
          { error: { code: "conflict", message: "Projection profile changed" } },
          409,
        );
      const current = await DB.prepare(
        `SELECT 1 FROM presentation_sessions AS session
         JOIN session_participants AS participant ON participant.session_id = session.id
         JOIN session_participant_capabilities AS selection
           ON selection.session_id = participant.session_id AND selection.user_id = participant.user_id
         WHERE session.id = ? AND participant.user_id = ? AND session.state != 'Ended'
           AND session.presentation_id = ? AND session.publication_epoch = ?
           AND participant.role = ? AND selection.capability_json = ?
           AND selection.projection_profile_id = ?`,
      )
        .bind(
          sessionId,
          participantId,
          row.presentationId,
          row.publicationEpoch,
          row.role,
          row.capabilityJson,
          row.projectionProfileId,
        )
        .first();
      if (!current)
        return context.json(
          { error: { code: "conflict", message: "Participant projection changed" } },
          409,
        );
      return context.json({ role: row.role, profile }, 200);
    });
}
