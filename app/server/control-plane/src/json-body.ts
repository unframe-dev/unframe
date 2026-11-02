import { createMiddleware } from "hono/factory";

const jsonContentType = /^application\/(?:[a-z.-]+\+)?json(?:;\s*[a-zA-Z0-9-]+=[^;]+)*$/i;

export const requireJsonContentType = createMiddleware(async (context, next) => {
  if (!jsonContentType.test(context.req.header("content-type") ?? "")) {
    return context.json(
      { error: { code: "validation_error", message: "JSON content type required" } },
      400,
    );
  }
  await next();
});
