import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment, RuntimeConfig } from "../../config";
import {
  D1PresentationRepository,
  type PresentationRepository,
} from "../../presentation/repository";
import type { Identity } from "../../presentation/service";
import { RealtimeBootstrapCredentials } from "../realtime-bootstrap/credential";
import { D1SessionRepository, type SessionRepository } from "./repository";
import { SessionError, SessionService, sha256JoinCode } from "./service";

type AppContext = Context<AppEnvironment>;
type CredentialIssuer = Pick<RealtimeBootstrapCredentials, "issue">;
type RouteDependencies = {
  config: RuntimeConfig;
  service: SessionService;
  credentials: CredentialIssuer;
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

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const createInput = z.object({ presentationId: identifier }).strict();
const joinInput = z.object({ joinCode: z.string() }).strict();
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

export function registerSessionRoutes(app: Hono<AppEnvironment>, options: SessionRouteOptions) {
  const dependencies = (context: AppContext): RouteDependencies => {
    const config = context.get("config");
    const repository = options.sessionRepository ?? new D1SessionRepository(config.DB);
    return {
      config,
      service: new SessionService(
        repository,
        options.presentationRepository ?? new D1PresentationRepository(config.DB),
        options.now ?? (() => new Date()),
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
    };
  };
  const execute = async <T>(
    context: AppContext,
    operation: (identity: Identity, dependencies: RouteDependencies) => Promise<T>,
  ) => {
    const identity = await options.identityProvider(context);
    if (!identity)
      return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    try {
      return await operation(identity, dependencies(context));
    } catch (error) {
      if (error instanceof SessionError) {
        return context.json(
          { error: { code: error.code, message: error.code.replaceAll("_", " ") } },
          errorStatuses[error.code],
        );
      }
      throw error;
    }
  };
  const parseBody = async <T>(context: AppContext, schema: z.ZodType<T>) => {
    try {
      return schema.safeParse(await context.req.json());
    } catch {
      return { success: false } as const;
    }
  };

  app.post("/sessions", async (context) => {
    const body = await parseBody(context, createInput);
    if (!body.success)
      return context.json({ error: { code: "validation_error", message: "Invalid session" } }, 400);
    const result = await execute(context, (identity, { service }) =>
      service.create(identity, body.data.presentationId),
    );
    return result instanceof Response ? result : context.json(result, 201);
  });
  app.post("/sessions/join", async (context) => {
    const body = await parseBody(context, joinInput);
    if (!body.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid join request" } },
        400,
      );
    const result = await execute(context, (identity, { service }) =>
      service.join(
        identity,
        body.data.joinCode,
        context.req.header("cf-connecting-ip") ?? "unknown",
      ),
    );
    return result instanceof Response ? result : context.json(result);
  });
  app.get("/sessions/:id", async (context) => {
    const id = identifier.safeParse(context.req.param("id"));
    if (!id.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid session id" } },
        400,
      );
    const result = await execute(context, (identity, { service }) =>
      service.get(identity, id.data),
    );
    return result instanceof Response ? result : context.json(result);
  });
  for (const action of ["start", "end"] as const) {
    app.post(`/sessions/:id/${action}`, async (context) => {
      const id = identifier.safeParse(context.req.param("id"));
      if (!id.success)
        return context.json(
          { error: { code: "validation_error", message: "Invalid session id" } },
          400,
        );
      const result = await execute(context, (identity, { service }) =>
        service[action](identity, id.data),
      );
      return result instanceof Response ? result : context.json(result);
    });
  }
  app.post("/sessions/:id/bootstrap", async (context) => {
    const id = identifier.safeParse(context.req.param("id"));
    if (!id.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid session id" } },
        400,
      );
    const result = await execute(context, async (identity, { config, credentials, service }) => {
      const { participant } = await service.bootstrap(identity, id.data);
      const credential = await credentials.issue({
        sessionId: id.data,
        userId: identity.userId,
        role: participant.role,
      });
      return {
        endpoint: config.REALTIME_ENDPOINT,
        credential: credential.token,
        expiresAt: new Date(credential.expiresAt).toISOString(),
      };
    });
    return result instanceof Response ? result : context.json(result);
  });
}
