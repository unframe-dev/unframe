import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePath } from "hono/route";
import { type AppEnvironment, validateConfig } from "./config";
import { identityFromSession } from "./auth/identity";
import { createAuth } from "./auth/options";
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

const forbidden = {
  error: {
    code: "forbidden",
    message: "Forbidden",
  },
} as const;

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createApp(options: Partial<PresentationRouteOptions & AssetRouteOptions> = {}) {
  const app = new Hono<AppEnvironment>();

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
