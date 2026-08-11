import type { Context, Hono } from "hono";
import type { AppEnvironment } from "../../config";
import { D1PersistenceCallbackRepository } from "./repository";
import { checkpointInputSchema, completionInputSchema } from "./schema";
import { PersistenceCallbackError, PersistenceCallbackService } from "./service";
import { ServiceIdentity } from "./service-identity";

type AppContext = Context<AppEnvironment>;

export function registerPersistenceCallbackRoutes(app: Hono<AppEnvironment>) {
  const handle = async (context: AppContext, operation: "checkpoint" | "complete") => {
    const config = context.get("config");
    if (
      !(await new ServiceIdentity(config.SERVICE_IDENTITY_SECRET).authenticate(context.req.raw))
    ) {
      return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    let value: unknown;
    try {
      value = await context.req.json();
    } catch {
      return context.json(
        { error: { code: "validation_error", message: "Invalid callback" } },
        400,
      );
    }
    const service = new PersistenceCallbackService(new D1PersistenceCallbackRepository(config.DB));
    try {
      if (operation === "checkpoint") {
        const parsed = checkpointInputSchema.safeParse(value);
        if (!parsed.success)
          return context.json(
            { error: { code: "validation_error", message: "Invalid callback" } },
            400,
          );
        return context.json(await service.checkpoint(parsed.data));
      }
      const parsed = completionInputSchema.safeParse(value);
      if (!parsed.success)
        return context.json(
          { error: { code: "validation_error", message: "Invalid callback" } },
          400,
        );
      return context.json(await service.complete(parsed.data));
    } catch (error) {
      if (error instanceof PersistenceCallbackError) {
        return context.json({ error: { code: "not_found", message: "Not found" } }, 404);
      }
      throw error;
    }
  };
  app.post("/callbacks/checkpoints", (context) => handle(context, "checkpoint"));
  app.post("/callbacks/completions", (context) => handle(context, "complete"));
}
