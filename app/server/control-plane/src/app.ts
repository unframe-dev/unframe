import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePath } from "hono/route";
import { identityFromSession } from "./auth/identity";
import { createAuth, type AuthEnvironment } from "./auth/options";
import { registerPresentationRoutes, type PresentationRouteOptions } from "./presentation/routes";
import { registerAssetRoutes, type AssetRouteOptions } from "./modules/assets/routes";

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

export function createApp(options: Partial<PresentationRouteOptions & AssetRouteOptions> = {}) {
  const app = new Hono<{ Bindings: CloudflareBindings }>();

  app.onError((error, context) => {
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
    const origin = context.req.header("origin");
    const env = context.env as unknown as AuthEnvironment;
    if (origin && origin === env?.WEB_ORIGIN) {
      return cors({
        origin: env.WEB_ORIGIN,
        credentials: true,
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        exposeHeaders: ["set-auth-token"],
      })(context, next);
    }
    await next();
  });
  app.get("/health", (context) => context.json({ status: "ok" }));
  app.all("/api/auth/*", (context) =>
    createAuth(context.env as unknown as AuthEnvironment).handler(context.req.raw),
  );
  registerPresentationRoutes(app, {
    identityProvider: options.identityProvider ?? identityFromSession,
    repository: options.repository,
    now: options.now,
    id: options.id,
  });
  registerAssetRoutes(app, {
    identityProvider: options.identityProvider ?? identityFromSession,
    services: options.services,
  });

  return app;
}
