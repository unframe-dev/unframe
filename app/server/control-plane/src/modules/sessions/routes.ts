import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnvironment, RuntimeConfig } from "../../config";
import {
  bootstrapSessionRoute,
  createSessionRoute,
  endSessionRoute,
  getSessionRoute,
  joinSessionRoute,
  startSessionRoute,
} from "../../openapi";
import {
  D1PresentationRepository,
  type PresentationRepository,
} from "../../presentation/repository";
import type { Identity } from "../../presentation/service";
import { RealtimeBootstrapCredentials } from "../realtime-bootstrap/credential";
import { D1RuntimeAssignmentRepository } from "../runtime-assignments/repository";
import { RuntimeAssignmentError, RuntimeAssignmentService } from "../runtime-assignments/service";
import { D1SessionRepository, type SessionRepository } from "./repository";
import { SessionError, SessionService, sha256JoinCode } from "./service";

type AppContext = Context<AppEnvironment>;
type CredentialIssuer = Pick<RealtimeBootstrapCredentials, "issue">;
type RouteDependencies = {
  config: RuntimeConfig;
  service: SessionService;
  credentials: CredentialIssuer;
  assignments: RuntimeAssignmentService;
};
export type SessionRouteOptions = {
  identityProvider: (context: AppContext) => Promise<Identity | undefined>;
  sessionRepository?: SessionRepository;
  presentationRepository?: PresentationRepository;
  credentials?: CredentialIssuer;
  now?: () => Date;
  id?: () => string;
  joinCode?: () => string;
};
const errorStatuses = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  invalid_join_code: 400,
  rate_limited: 429,
} as const satisfies Record<SessionError["code"], 400 | 403 | 404 | 409 | 429>;
const randomJoinCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const value = [...crypto.getRandomValues(new Uint8Array(8))]
    .map((byte) => alphabet[byte & 31])
    .join("");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
};

export function createSessionRoutes(options: SessionRouteOptions) {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json({ error: { code: "validation_error", message: "Invalid request" } }, 400),
  });
  const now = options.now ?? (() => new Date());
  const dependencies = (context: AppContext): RouteDependencies => {
    const config = context.get("config");
    return {
      config,
      service: new SessionService(
        options.sessionRepository ?? new D1SessionRepository(config.DB),
        options.presentationRepository ?? new D1PresentationRepository(config.DB),
        now,
        options.id ?? (() => crypto.randomUUID()),
        options.joinCode ?? randomJoinCode,
        sha256JoinCode,
      ),
      credentials:
        options.credentials ??
        new RealtimeBootstrapCredentials(config.REALTIME_SIGNING_JWK, {
          issuer: config.REALTIME_ISSUER,
          keyId: config.REALTIME_SIGNING_KID,
          audience: config.REALTIME_AUDIENCE,
        }),
      assignments: new RuntimeAssignmentService(new D1RuntimeAssignmentRepository(config.DB), now),
    };
  };
  const execute = async <T>(
    context: AppContext,
    operation: (identity: Identity, dependencies: RouteDependencies) => Promise<T>,
  ) => {
    const identity = await options.identityProvider(context);
    if (!identity) {
      throw new HTTPException(401, {
        res: context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401),
      });
    }
    try {
      return await operation(identity, dependencies(context));
    } catch (error) {
      if (error instanceof SessionError || error instanceof RuntimeAssignmentError) {
        const status = errorStatuses[error.code as SessionError["code"]] ?? 409;
        throw new HTTPException(status, {
          res: context.json(
            { error: { code: error.code, message: error.code.replaceAll("_", " ") } },
            status,
          ),
        });
      }
      throw error;
    }
  };
  return app
    .openapi(createSessionRoute, async (context) => {
      const result = await execute(context, (identity, { service }) =>
        service.create(identity, context.req.valid("json").presentationId),
      );
      return context.json(result, 201);
    })
    .openapi(joinSessionRoute, async (context) => {
      const result = await execute(context, (identity, { service }) =>
        service.join(
          identity,
          context.req.valid("json").joinCode,
          context.req.header("cf-connecting-ip") ?? "unknown",
        ),
      );
      return context.json(result, 200);
    })
    .openapi(getSessionRoute, async (context) => {
      const result = await execute(context, (identity, { service }) =>
        service.get(identity, context.req.valid("param").id),
      );
      return context.json(result, 200);
    })
    .openapi(startSessionRoute, async (context) => {
      const result = await execute(context, (identity, { service }) =>
        service.start(identity, context.req.valid("param").id),
      );
      return context.json(result, 200);
    })
    .openapi(endSessionRoute, async (context) => {
      const result = await execute(context, (identity, { service }) =>
        service.end(identity, context.req.valid("param").id),
      );
      return context.json(result, 200);
    })
    .openapi(bootstrapSessionRoute, async (context) => {
      const result = await execute(
        context,
        async (identity, { credentials, assignments, service }) => {
          const id = context.req.valid("param").id;
          const { participant, session } = await service.bootstrap(identity, id);
          const assignment = await assignments.active(id);
          const publication = await context
            .get("config")
            .DB.prepare(
              `SELECT publication.epoch AS publicationEpoch,
                    publication.manifest AS manifest,
                    capability.projection_profile_id AS projectionProfileId
             FROM presentation_sessions AS session
             LEFT JOIN presentation_publications AS publication
               ON publication.presentation_id = session.presentation_id
              AND publication.epoch = session.publication_epoch
             LEFT JOIN session_participant_capabilities AS capability
               ON capability.session_id = session.id AND capability.user_id = ?
             WHERE session.id = ?`,
            )
            .bind(identity.userId, id)
            .first<{
              publicationEpoch: number | null;
              manifest: string | null;
              projectionProfileId: string | null;
            }>();
          if (!publication) throw new SessionError("conflict");
          if (
            publication.publicationEpoch !== null &&
            (!publication.manifest || !publication.projectionProfileId)
          )
            throw new SessionError("conflict");
          const expiresAt = Math.floor(new Date(assignment.leaseExpiresAt).getTime() / 1_000);
          if (expiresAt <= Math.floor(now().getTime() / 1_000)) {
            throw new SessionError("conflict");
          }
          let credential;
          try {
            credential = await credentials.issue({
              sessionId: id,
              userId: identity.userId,
              role: participant.role,
              runtimeId: assignment.runtimeId,
              runtimeKind: assignment.runtimeKind,
              assignmentEpoch: assignment.assignmentEpoch,
              presentationId: session.presentationId,
              presentationRevision: assignment.presentationRevision,
              ...(publication.publicationEpoch !== null ? { protocolVersion: 2 as const } : {}),
              scopes:
                assignment.runtimeKind === "VenueEdge"
                  ? ["realtime:connect", "assets:read"]
                  : ["realtime:connect"],
              expiresAt,
            });
          } catch (error) {
            if (error instanceof RangeError) throw new SessionError("conflict");
            throw error;
          }
          const current = await service.bootstrap(identity, id);
          const currentAssignment = await assignments.active(id);
          const currentPublication = await context
            .get("config")
            .DB.prepare(
              `SELECT session.publication_epoch AS publicationEpoch,
                    capability.projection_profile_id AS projectionProfileId
             FROM presentation_sessions AS session
             LEFT JOIN session_participant_capabilities AS capability
               ON capability.session_id = session.id AND capability.user_id = ?
             WHERE session.id = ?`,
            )
            .bind(identity.userId, id)
            .first<{
              publicationEpoch: number | null;
              projectionProfileId: string | null;
            }>();
          if (
            current.session.presentationId !== session.presentationId ||
            current.participant.userId !== participant.userId ||
            current.participant.role !== participant.role ||
            currentAssignment.runtimeId !== assignment.runtimeId ||
            currentAssignment.runtimeKind !== assignment.runtimeKind ||
            currentAssignment.assignmentEpoch !== assignment.assignmentEpoch ||
            currentAssignment.presentationRevision !== assignment.presentationRevision ||
            currentAssignment.endpoint !== assignment.endpoint ||
            currentAssignment.certificateFingerprint !== assignment.certificateFingerprint ||
            currentPublication?.publicationEpoch !== publication.publicationEpoch ||
            currentPublication?.projectionProfileId !== publication.projectionProfileId
          ) {
            throw new SessionError("conflict");
          }
          return {
            endpoint: currentAssignment.endpoint,
            fingerprint: currentAssignment.certificateFingerprint,
            runtimeId: currentAssignment.runtimeId,
            runtimeKind: currentAssignment.runtimeKind,
            assignmentEpoch: currentAssignment.assignmentEpoch,
            presentationId: current.session.presentationId,
            presentationRevision: currentAssignment.presentationRevision,
            credential: credential.token,
            expiresAt: new Date(credential.expiresAt).toISOString(),
            ...(publication.manifest
              ? {
                  publicationFence: (({
                    presentationId,
                    publicationEpoch,
                    publicationManifestHash,
                  }) => ({ presentationId, publicationEpoch, publicationManifestHash }))(
                    JSON.parse(publication.manifest) as {
                      presentationId: string;
                      publicationEpoch: number;
                      publicationManifestHash: string;
                    },
                  ),
                  projectionProfileId: publication.projectionProfileId!,
                }
              : {}),
          };
        },
      );
      return context.json(result, 200);
    });
}
