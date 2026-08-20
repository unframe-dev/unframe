import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { type AppEnvironment, validateConfig } from "./config";
import { identityFromSession } from "./auth/identity";
import { createAuth } from "./auth/options";
import { createPresentationRoutes, type PresentationRouteOptions } from "./presentation/routes";
import { createAssetRoutes, type AssetRouteOptions } from "./modules/assets/routes";
import { createPersistenceCallbackRoutes } from "./modules/persistence-callback/routes";
import { RealtimeBootstrapCredentials } from "./modules/realtime-bootstrap/credential";
import { createSessionRoutes, type SessionRouteOptions } from "./modules/sessions/routes";
import { createVenueEdgeRoutes, type VenueEdgeRouteOptions } from "./modules/venue-edges/routes";
import { jwksRoute } from "./openapi";

const internalError = {
  error: {
    code: "internal_error",
    message: "Internal Server Error",
  },
} as const;

const notFound = {
  error: {
    code: "not_found",
    message: "Not found",
  },
} as const;

const forbidden = {
  error: {
    code: "forbidden",
    message: "Forbidden",
  },
} as const;

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const productRoutePrefixes = [
  "/presentations",
  "/assets",
  "/sessions",
  "/venue-edges",
  "/callbacks",
];

type AppOptions = Partial<PresentationRouteOptions & AssetRouteOptions> &
  Partial<Omit<SessionRouteOptions, "identityProvider" | "now" | "id">> & {
    sessionNow?: () => Date;
    sessionId?: () => string;
  } & {
    venueEdgeRepository?: VenueEdgeRouteOptions["repository"];
    venueEdgeCredential?: VenueEdgeRouteOptions["credential"];
  };

export function createProductApi(options: AppOptions = {}) {
  const identityProvider = options.identityProvider ?? identityFromSession;
  const presentations = createPresentationRoutes({
    identityProvider,
    repository: options.repository,
    now: options.now,
    id: options.id,
  });
  const assets = presentations.route(
    "/",
    createAssetRoutes({ identityProvider, services: options.services }),
  );
  const sessions = assets.route(
    "/",
    createSessionRoutes({
      identityProvider,
      ...(options.sessionRepository ? { sessionRepository: options.sessionRepository } : {}),
      ...(options.presentationRepository
        ? { presentationRepository: options.presentationRepository }
        : {}),
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.sessionNow ? { now: options.sessionNow } : {}),
      ...(options.sessionId ? { id: options.sessionId } : {}),
      ...(options.joinCode ? { joinCode: options.joinCode } : {}),
      ...(options.venueEdgeRepository ? { venueEdgeRepository: options.venueEdgeRepository } : {}),
    }),
  );
  const venueEdges = sessions.route(
    "/",
    createVenueEdgeRoutes({
      identityProvider,
      ...(options.venueEdgeRepository ? { repository: options.venueEdgeRepository } : {}),
      ...(options.sessionNow ? { now: options.sessionNow } : {}),
      ...(options.venueEdgeCredential ? { credential: options.venueEdgeCredential } : {}),
    }),
  );
  const callbacks = venueEdges.route("/", createPersistenceCallbackRoutes());
  return callbacks.openapi(jwksRoute, async (context) => {
    const config = context.get("config");
    return context.json(
      await new RealtimeBootstrapCredentials(config.REALTIME_SIGNING_JWK, {
        issuer: config.REALTIME_ISSUER,
        keyId: config.REALTIME_SIGNING_KID,
      }).jwks(),
      200,
    );
  });
}

export type AppType = ReturnType<typeof createProductApi>;

export const createOpenAPIDocument = () => {
  const app = createProductApi();
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieSession", {
    type: "apiKey",
    in: "cookie",
    name: "__Secure-better-auth.session_token",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "serviceBearer", {
    type: "http",
    scheme: "bearer",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "edgeBearer", {
    type: "http",
    scheme: "bearer",
  });
  return app.getOpenAPIDocument({
    openapi: "3.0.3",
    info: { title: "Unframe Control Plane", version: "1.0.0" },
  });
};

export function createApp(options: AppOptions = {}) {
  const app = new OpenAPIHono<AppEnvironment>();

  app.onError((error, context) => {
    if (error instanceof HTTPException) return error.getResponse();
    const incidentId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        event: "unhandled_error",
        errorName: error.name,
        incidentId,
        method: context.req.method,
        route: routePath(context),
      }),
    );
    context.header("x-unframe-incident-id", incidentId);
    return context.json(internalError, 500);
  });

  app.notFound((context) => context.json(notFound, 404));

  app.use("*", async (context, next) => {
    await next();
    if (
      context.res.status === 400 &&
      context.res.headers.get("content-type")?.startsWith("text/plain") &&
      productRoutePrefixes.some((prefix) => context.req.path.startsWith(prefix)) &&
      (await context.res.clone().text()).startsWith("Malformed JSON")
    ) {
      context.res = context.json(
        { error: { code: "validation_error", message: "Invalid JSON body" } },
        400,
      );
    }
  });

  app.use("*", async (context, next) => {
    context.set("config", validateConfig(context.env));
    const config = context.get("config");
    const origin = context.req.header("origin");
    if (
      unsafeMethods.has(context.req.method) &&
      context.req.header("cookie") &&
      origin !== config.WEB_ORIGIN
    ) {
      return context.json(forbidden, 403);
    }
    if (origin && origin === config.WEB_ORIGIN) {
      return cors({
        origin: config.WEB_ORIGIN,
        credentials: true,
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        exposeHeaders: ["set-auth-token"],
      })(context, next);
    }
    await next();
  });
  app.get("/health", (context) => context.json({ status: "ok" }));
  const requireEstablishedDeviceApprover = async (
    context: Parameters<typeof identityFromSession>[0],
    next: () => Promise<void>,
  ) => {
    if (!(await identityFromSession(context))) {
      return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    await next();
  };
  app.use("/api/auth/device", requireEstablishedDeviceApprover);
  app.use("/api/auth/device/approve", requireEstablishedDeviceApprover);
  app.use("/api/auth/device/deny", requireEstablishedDeviceApprover);
  app.all("/api/auth/*", (context) =>
    createAuth(context.get("config"), {
      backgroundTaskHandler: (task) => context.executionCtx.waitUntil(task),
    }).handler(context.req.raw),
  );
  app.route("/", createProductApi(options));

  return app;
}
