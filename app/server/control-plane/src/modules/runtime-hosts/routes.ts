import { eq } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import { presentationSessions } from "../../adapters/d1/schema";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnvironment } from "../../config";
import {
  getRuntimePreparationRoute,
  prepareRuntimeRoute,
  runtimeHostHeartbeatRoute,
} from "../../openapi";
import type { RuntimeAssignmentRouteOptions } from "../runtime-assignments/routes";
import { ServiceIdentity } from "../persistence-callback/service-identity";
import { RuntimeHostRepository } from "./repository";

type AppContext = Context<AppEnvironment>;
function fail(
  context: AppContext,
  status: 401 | 403 | 404 | 409,
  code: string,
  message: string,
): never {
  throw new HTTPException(status, { res: context.json({ error: { code, message } }, status) });
}

export function createRuntimeHostRoutes(options: RuntimeAssignmentRouteOptions) {
  const app = new OpenAPIHono<AppEnvironment>();
  const now = options.now ?? (() => new Date());
  const repository = (context: AppContext) => new RuntimeHostRepository(context.get("config").DB);
  const authorize = async (context: AppContext, sessionId: string) => {
    const identity = await options.identityProvider(context);
    if (!identity) fail(context, 401, "unauthorized", "Unauthorized");
    const session = await createD1Database(context.get("config").DB)
      .select({ presenterId: presentationSessions.presenterId })
      .from(presentationSessions)
      .where(eq(presentationSessions.id, sessionId))
      .get();
    if (!session) fail(context, 404, "not_found", "Session not found");
    if (identity.globalRole !== "admin" && identity.userId !== session.presenterId)
      fail(context, 403, "forbidden", "Forbidden");
  };
  return app
    .openapi(runtimeHostHeartbeatRoute, async (context) => {
      if (
        !(await new ServiceIdentity(context.get("config").SERVICE_IDENTITY_SECRET).authenticate(
          context.req.raw,
        ))
      )
        fail(context, 401, "unauthorized", "Unauthorized");
      const result = await repository(context).heartbeat(
        context.req.valid("param").runtimeId,
        context.req.valid("json"),
        now(),
      );
      if (!result) fail(context, 409, "conflict", "Runtime identity or endpoint conflict");
      return context.json(result, 200);
    })
    .openapi(getRuntimePreparationRoute, async (context) => {
      const id = context.req.valid("param").id;
      await authorize(context, id);
      return context.json(await repository(context).status(id, now()), 200);
    })
    .openapi(prepareRuntimeRoute, async (context) => {
      const id = context.req.valid("param").id;
      await authorize(context, id);
      const result = await repository(context).prepare(id, now());
      if (result.state === "ended") fail(context, 409, "session_ended", "Session ended");
      if (result.state === "unassigned")
        fail(context, 409, "runtime_unavailable", "Runtime unavailable");
      return context.json(result, 200);
    });
}
