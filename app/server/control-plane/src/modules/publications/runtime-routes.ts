import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import {
  presentationSessions,
  sessionParticipants,
  sessionParticipantCapabilities,
  runtimeAssignments,
  presentationPublications,
  sessionCheckpoints,
} from "../../adapters/d1/schema";
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
        const participant = await createD1Database(config.DB)
          .select({
            presentationId: presentationSessions.presentationId,
            publicationEpoch: presentationSessions.publicationEpoch,
            role: sessionParticipants.role,
            capabilityProfileId: sessionParticipantCapabilities.capabilityProfileId,
          })
          .from(presentationSessions)
          .innerJoin(
            sessionParticipants,
            eq(sessionParticipants.sessionId, presentationSessions.id),
          )
          .innerJoin(
            sessionParticipantCapabilities,
            and(
              eq(sessionParticipantCapabilities.sessionId, presentationSessions.id),
              eq(sessionParticipantCapabilities.userId, sessionParticipants.userId),
            ),
          )
          .where(
            and(
              eq(presentationSessions.id, query.sessionId),
              eq(sessionParticipants.userId, query.participantId),
              ne(presentationSessions.state, "Ended"),
            ),
          )
          .get();
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
        const present = await createD1Database(config.DB)
          .select({ id: presentationSessions.id })
          .from(presentationSessions)
          .innerJoin(
            sessionParticipants,
            eq(sessionParticipants.sessionId, presentationSessions.id),
          )
          .innerJoin(
            sessionParticipantCapabilities,
            and(
              eq(sessionParticipantCapabilities.sessionId, presentationSessions.id),
              eq(sessionParticipantCapabilities.userId, sessionParticipants.userId),
            ),
          )
          .where(
            and(
              eq(presentationSessions.id, query.sessionId),
              eq(sessionParticipants.userId, query.participantId),
              eq(sessionParticipants.role, participant.role),
              eq(presentationSessions.publicationEpoch, participant.publicationEpoch),
              ne(presentationSessions.state, "Ended"),
              eq(
                sessionParticipantCapabilities.capabilityProfileId,
                participant.capabilityProfileId,
              ),
            ),
          )
          .get();
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
      const row = await createD1Database(DB)
        .select({
          presentationId: presentationSessions.presentationId,
          publicationEpoch: presentationSessions.publicationEpoch,
          runtimeKind: runtimeAssignments.runtimeKind,
          presentationRevision: runtimeAssignments.revision,
          leaseExpiresAt: runtimeAssignments.leaseExpiresAt,
        })
        .from(presentationSessions)
        .innerJoin(runtimeAssignments, eq(runtimeAssignments.sessionId, presentationSessions.id))
        .where(
          and(
            eq(presentationSessions.id, sessionId),
            ne(presentationSessions.state, "Ended"),
            eq(runtimeAssignments.runtimeId, runtimeId),
            eq(runtimeAssignments.epoch, assignmentEpoch),
            isNull(runtimeAssignments.releasedAt),
            gt(runtimeAssignments.leaseExpiresAt, now),
          ),
        )
        .get();
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
      const checkpoint = await createD1Database(DB)
        .select({ payload: sessionCheckpoints.payload })
        .from(sessionCheckpoints)
        .where(eq(sessionCheckpoints.sessionId, sessionId))
        .orderBy(desc(sessionCheckpoints.version))
        .limit(1)
        .get();
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
      const current = await createD1Database(DB)
        .select({ id: presentationSessions.id })
        .from(presentationSessions)
        .innerJoin(runtimeAssignments, eq(runtimeAssignments.sessionId, presentationSessions.id))
        .where(
          and(
            eq(presentationSessions.id, sessionId),
            ne(presentationSessions.state, "Ended"),
            eq(presentationSessions.publicationEpoch, row.publicationEpoch),
            eq(runtimeAssignments.runtimeId, runtimeId),
            eq(runtimeAssignments.epoch, assignmentEpoch),
            isNull(runtimeAssignments.releasedAt),
            gt(runtimeAssignments.leaseExpiresAt, new Date().toISOString()),
          ),
        )
        .get();
      if (!current)
        return context.json({ error: { code: "conflict", message: "Runtime fence changed" } }, 409);
      return context.json(result, 200);
    })
    .openapi(internalRuntimeLeaseRoute, async (context) => {
      const { sessionId, runtimeId, assignmentEpoch } = context.req.valid("query");
      const { DB } = context.get("config");
      const row = await createD1Database(DB)
        .select({
          presentationId: presentationSessions.presentationId,
          publicationEpoch: presentationPublications.epoch,
          runtimeKind: runtimeAssignments.runtimeKind,
          presentationRevision: runtimeAssignments.revision,
          leaseExpiresAt: runtimeAssignments.leaseExpiresAt,
          manifest: presentationPublications.manifest,
        })
        .from(presentationSessions)
        .innerJoin(runtimeAssignments, eq(runtimeAssignments.sessionId, presentationSessions.id))
        .innerJoin(
          presentationPublications,
          and(
            eq(presentationPublications.presentationId, presentationSessions.presentationId),
            eq(presentationPublications.epoch, presentationSessions.publicationEpoch),
          ),
        )
        .where(
          and(
            eq(presentationSessions.id, sessionId),
            ne(presentationSessions.state, "Ended"),
            eq(runtimeAssignments.runtimeId, runtimeId),
            eq(runtimeAssignments.epoch, assignmentEpoch),
            isNull(runtimeAssignments.releasedAt),
            gt(runtimeAssignments.leaseExpiresAt, new Date().toISOString()),
          ),
        )
        .get();
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
      const row = await createD1Database(DB)
        .select({
          presentationId: presentationSessions.presentationId,
          publicationEpoch: presentationSessions.publicationEpoch,
          role: sessionParticipants.role,
          capabilityJson: sessionParticipantCapabilities.capabilityJson,
          projectionProfileId: sessionParticipantCapabilities.projectionProfileId,
        })
        .from(presentationSessions)
        .innerJoin(sessionParticipants, eq(sessionParticipants.sessionId, presentationSessions.id))
        .innerJoin(
          sessionParticipantCapabilities,
          and(
            eq(sessionParticipantCapabilities.sessionId, sessionParticipants.sessionId),
            eq(sessionParticipantCapabilities.userId, sessionParticipants.userId),
          ),
        )
        .where(
          and(
            eq(presentationSessions.id, sessionId),
            eq(sessionParticipants.userId, participantId),
            ne(presentationSessions.state, "Ended"),
          ),
        )
        .get();
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
      const current = await createD1Database(DB)
        .select({ id: presentationSessions.id })
        .from(presentationSessions)
        .innerJoin(sessionParticipants, eq(sessionParticipants.sessionId, presentationSessions.id))
        .innerJoin(
          sessionParticipantCapabilities,
          and(
            eq(sessionParticipantCapabilities.sessionId, sessionParticipants.sessionId),
            eq(sessionParticipantCapabilities.userId, sessionParticipants.userId),
          ),
        )
        .where(
          and(
            eq(presentationSessions.id, sessionId),
            eq(sessionParticipants.userId, participantId),
            ne(presentationSessions.state, "Ended"),
            eq(presentationSessions.presentationId, row.presentationId),
            eq(presentationSessions.publicationEpoch, row.publicationEpoch),
            eq(sessionParticipants.role, row.role),
            eq(sessionParticipantCapabilities.capabilityJson, row.capabilityJson),
            eq(sessionParticipantCapabilities.projectionProfileId, row.projectionProfileId),
          ),
        )
        .get();
      if (!current)
        return context.json(
          { error: { code: "conflict", message: "Participant projection changed" } },
          409,
        );
      return context.json({ role: row.role, profile }, 200);
    });
}
