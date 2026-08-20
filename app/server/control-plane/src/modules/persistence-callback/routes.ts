import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnvironment } from "../../config";
import { checkpointRoute, completionRoute } from "../../openapi";
import { D1PersistenceCallbackRepository } from "./repository";
import { PersistenceCallbackError, PersistenceCallbackService } from "./service";
import { ServiceIdentity } from "./service-identity";

export function createPersistenceCallbackRoutes() {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json({ error: { code: "validation_error", message: "Invalid callback" } }, 400),
  });
  app.use("/callbacks/*", async (context: Context<AppEnvironment>, next) => {
    const config = context.get("config");
    if (
      !(await new ServiceIdentity(config.SERVICE_IDENTITY_SECRET).authenticate(context.req.raw))
    ) {
      return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    await next();
  });
  return app
    .openapi(checkpointRoute, async (context) => {
      try {
        return context.json(
          await new PersistenceCallbackService(
            new D1PersistenceCallbackRepository(context.get("config").DB),
          ).checkpoint(context.req.valid("json")),
          200,
        );
      } catch (error) {
        if (error instanceof PersistenceCallbackError) {
          throw new HTTPException(404, {
            res: context.json({ error: { code: "not_found", message: "Not found" } }, 404),
          });
        }
        throw error;
      }
    })
    .openapi(completionRoute, async (context) => {
      try {
        return context.json(
          await new PersistenceCallbackService(
            new D1PersistenceCallbackRepository(context.get("config").DB),
          ).complete(context.req.valid("json")),
          200,
        );
      } catch (error) {
        if (error instanceof PersistenceCallbackError) {
          if (error.code === "conflict") {
            throw new HTTPException(409, {
              res: context.json(
                { error: { code: "conflict", message: "Assignment is not active" } },
                409,
              ),
            });
          }
          throw new HTTPException(404, {
            res: context.json({ error: { code: "not_found", message: "Not found" } }, 404),
          });
        }
        throw error;
      }
    });
}
