import { Hono } from "hono";

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
    console.error(
      JSON.stringify({
        event: "unhandled_error",
        method: context.req.method,
        path: new URL(context.req.url).pathname,
      }),
    );
    return context.json(internalError, 500);
  });

  app.notFound((context) => context.json(notFound, 404));

  app.get("/health", (context) => context.json({ status: "ok" }));

  return app;
}
