import { and, eq, gt, isNotNull } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import { venueEdges } from "../../adapters/d1/schema";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppEnvironment } from "../../config";
import { assignRuntimeRoute, getRuntimeAssignmentRoute } from "../../openapi";
import type { Identity } from "../../presentation/service";
import { D1RuntimeAssignmentRepository } from "./repository";
import { RuntimeAssignmentError, RuntimeAssignmentService } from "./service";

type AppContext = Context<AppEnvironment>;
export type RuntimeAssignmentRouteOptions = {
  identityProvider: (context: AppContext) => Promise<Identity | undefined>;
  now?: () => Date;
};

export function createRuntimeAssignmentRoutes(options: RuntimeAssignmentRouteOptions) {
  const app = new OpenAPIHono<AppEnvironment>();
  const service = (context: AppContext) =>
    new RuntimeAssignmentService(
      new D1RuntimeAssignmentRepository(context.get("config").DB),
      options.now ?? (() => new Date()),
    );
  const admin = async (context: AppContext) => {
    const identity = await options.identityProvider(context);
    if (!identity) {
      throw new HTTPException(401, {
        res: context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401),
      });
    }
    if (identity.globalRole !== "admin") {
      throw new HTTPException(403, {
        res: context.json({ error: { code: "forbidden", message: "Forbidden" } }, 403),
      });
    }
  };
  const execute = async <T>(
    context: AppContext,
    action: (value: RuntimeAssignmentService) => Promise<T>,
  ) => {
    try {
      return await action(service(context));
    } catch (error) {
      if (error instanceof RuntimeAssignmentError) {
        throw new HTTPException(409, {
          res: context.json({ error: { code: "conflict", message: "conflict" } }, 409),
        });
      }
      throw error;
    }
  };
  return app
    .openapi(assignRuntimeRoute, async (context) => {
      const { sessionId } = context.req.valid("param");
      const input = context.req.valid("json");
      await admin(context);
      const config = context.get("config");
      let endpoint = input.endpoint;
      let certificateFingerprint: string | null = null;
      let provisioningEdgeId: string | null = null;
      if (input.runtimeKind === "VenueEdge") {
        const edge = await createD1Database(config.DB)
          .select({
            id: venueEdges.id,
            endpoint: venueEdges.localEndpoint,
            certificateFingerprint: venueEdges.certificateFingerprint,
          })
          .from(venueEdges)
          .where(
            and(
              eq(venueEdges.runtimeId, input.runtimeId),
              eq(venueEdges.status, "active"),
              eq(venueEdges.protocolVersion, "v3"),
              eq(venueEdges.health, "healthy"),
              isNotNull(venueEdges.registeredAt),
              gt(venueEdges.capacity, 0),
              isNotNull(venueEdges.localEndpoint),
              isNotNull(venueEdges.certificateFingerprint),
            ),
          )
          .get();
        if (!edge || edge.endpoint === null || edge.certificateFingerprint === null) {
          throw new HTTPException(409, {
            res: context.json({ error: { code: "conflict", message: "conflict" } }, 409),
          });
        }
        endpoint = edge.endpoint;
        certificateFingerprint = edge.certificateFingerprint;
        provisioningEdgeId = edge.id;
      }
      if (!endpoint) {
        throw new HTTPException(400, {
          res: context.json(
            { error: { code: "validation_error", message: "Invalid request" } },
            400,
          ),
        });
      }
      return context.json(
        await execute(context, (value) =>
          value.assign({
            sessionId,
            runtimeId: input.runtimeId,
            runtimeKind: input.runtimeKind,
            endpoint,
            certificateFingerprint,
            provisioningEdgeId,
            presentationRevision: input.presentationRevision,
            leaseExpiresAt: input.leaseExpiresAt,
          }),
        ),
        201,
      );
    })
    .openapi(getRuntimeAssignmentRoute, async (context) => {
      await admin(context);
      return context.json(
        await execute(context, (value) => value.active(context.req.valid("param").sessionId)),
        200,
      );
    });
}
