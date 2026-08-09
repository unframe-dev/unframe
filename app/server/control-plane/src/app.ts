import { Hono } from "hono";
import { routePath } from "hono/route";

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

export function createApp() {
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

  app.get("/health", (context) => context.json({ status: "ok" }));

  return app;
}
