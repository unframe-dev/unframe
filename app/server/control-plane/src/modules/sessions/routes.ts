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
import { D1VenueEdgeRepository, type VenueEdgeRepository } from "../venue-edges/repository";
import { VenueEdgeError, VenueEdgeService } from "../venue-edges/service";
import { D1SessionRepository, type SessionRepository } from "./repository";
import { SessionError, SessionService, sha256JoinCode } from "./service";

type AppContext = Context<AppEnvironment>;
type CredentialIssuer = Pick<RealtimeBootstrapCredentials, "issue">;
type RouteDependencies = {
  config: RuntimeConfig;
  service: SessionService;
  credentials: CredentialIssuer;
  edges: VenueEdgeService;
};
export type SessionRouteOptions = {
  identityProvider: (context: AppContext) => Promise<Identity | undefined>;
  sessionRepository?: SessionRepository;
  presentationRepository?: PresentationRepository;
  credentials?: CredentialIssuer;
  now?: () => Date;
  id?: () => string;
  joinCode?: () => string;
  venueEdgeRepository?: VenueEdgeRepository;
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
        }),
      edges: new VenueEdgeService(
        options.venueEdgeRepository ?? new D1VenueEdgeRepository(config.DB),
        now,
        () => crypto.randomUUID(),
        () => ({
          tokenId: crypto.randomUUID(),
          secret: crypto.getRandomValues(new Uint8Array(32)),
        }),
      ),
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
      if (error instanceof SessionError || error instanceof VenueEdgeError) {
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
      const result = await execute(context, async (identity, { credentials, edges, service }) => {
        const id = context.req.valid("param").id;
        const { participant, session } = await service.bootstrap(identity, id);
        const assignment = await edges.activeAssignment(id);
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
            edgeId: assignment.edgeId,
            assignmentEpoch: assignment.assignmentEpoch,
            presentationId: session.presentationId,
            presentationRevision: assignment.presentationRevision,
            scopes: ["realtime:connect", "assets:read"],
            expiresAt,
          });
        } catch (error) {
          if (error instanceof RangeError) throw new SessionError("conflict");
          throw error;
        }
        const current = await service.bootstrap(identity, id);
        const currentAssignment = await edges.activeAssignment(id);
        if (
          current.session.presentationId !== session.presentationId ||
          current.participant.userId !== participant.userId ||
          current.participant.role !== participant.role ||
          currentAssignment.edgeId !== assignment.edgeId ||
          currentAssignment.assignmentEpoch !== assignment.assignmentEpoch ||
          currentAssignment.presentationRevision !== assignment.presentationRevision ||
          currentAssignment.localEndpoint !== assignment.localEndpoint ||
          currentAssignment.certificateFingerprint !== assignment.certificateFingerprint
        ) {
          throw new SessionError("conflict");
        }
        return {
          endpoint: currentAssignment.localEndpoint,
          fingerprint: currentAssignment.certificateFingerprint,
          edgeId: currentAssignment.edgeId,
          assignmentEpoch: currentAssignment.assignmentEpoch,
          presentationId: current.session.presentationId,
          presentationRevision: currentAssignment.presentationRevision,
          credential: credential.token,
          expiresAt: new Date(credential.expiresAt).toISOString(),
        };
      });
      return context.json(result, 200);
    });
}
