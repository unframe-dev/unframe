import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppEnvironment } from "../../config";
import {
  provisionVenueEdgeRoute,
  registerVenueEdgeRoute,
  releaseVenueEdgeLeaseRoute,
  renewVenueEdgeLeaseRoute,
  revokeVenueEdgeRoute,
  rotateVenueEdgeRoute,
} from "../../openapi";
import type { Identity } from "../../presentation/service";
import { D1VenueEdgeRepository, type VenueEdgeRepository } from "./repository";
import { VenueEdgeError, VenueEdgeService } from "./service";
import { D1RuntimeAssignmentRepository } from "../runtime-assignments/repository";
import { RuntimeAssignmentError, RuntimeAssignmentService } from "../runtime-assignments/service";

type AppContext = Context<AppEnvironment>;
type RouteDependencies = { service: VenueEdgeService };
export type VenueEdgeRouteOptions = {
  identityProvider: (context: AppContext) => Promise<Identity | undefined>;
  repository?: VenueEdgeRepository;
  now?: () => Date;
  edgeId?: () => string;
  credential?: () => { tokenId: string; secret: Uint8Array };
};

const errors = { not_found: 404, conflict: 409, unauthorized: 401, forbidden: 403 } as const;
const randomCredential = () => ({
  tokenId: crypto.randomUUID(),
  secret: crypto.getRandomValues(new Uint8Array(32)),
});

export function createVenueEdgeRoutes(options: VenueEdgeRouteOptions) {
  const app = new OpenAPIHono<AppEnvironment>();
  const dependencies = (context: AppContext): RouteDependencies => {
    const config = context.get("config");
    return {
      service: new VenueEdgeService(
        options.repository ?? new D1VenueEdgeRepository(config.DB),
        options.now ?? (() => new Date()),
        options.edgeId ?? (() => crypto.randomUUID()),
        options.credential ?? randomCredential,
      ),
    };
  };
  const identity = async (context: AppContext) => {
    const value = await options.identityProvider(context);
    if (!value) throw httpError(context, "unauthorized");
    return value;
  };
  const requireAdmin = async (context: AppContext) => {
    const value = await identity(context);
    if (value.globalRole !== "admin") throw httpError(context, "forbidden");
  };
  const edgeToken = async (context: AppContext, edgeId: string) => {
    const authorization = context.req.header("authorization");
    const token = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!token) throw httpError(context, "unauthorized");
    try {
      await dependencies(context).service.authenticate(edgeId, token);
    } catch (error) {
      if (error instanceof VenueEdgeError) throw httpError(context, error.code);
      throw error;
    }
  };
  const admin = async <T>(
    context: AppContext,
    operation: (service: VenueEdgeService) => Promise<T>,
  ) => {
    await requireAdmin(context);
    try {
      return await operation(dependencies(context).service);
    } catch (error) {
      if (error instanceof VenueEdgeError) throw httpError(context, error.code);
      throw error;
    }
  };
  const edge = async <T>(
    context: AppContext,
    edgeId: string,
    operation: (service: VenueEdgeService) => Promise<T>,
  ) => {
    await edgeToken(context, edgeId);
    try {
      return await operation(dependencies(context).service);
    } catch (error) {
      if (error instanceof VenueEdgeError) throw httpError(context, error.code);
      throw error;
    }
  };
  const assignments = (context: AppContext) =>
    new RuntimeAssignmentService(
      new D1RuntimeAssignmentRepository(context.get("config").DB),
      options.now ?? (() => new Date()),
    );
  return app
    .openapi(provisionVenueEdgeRoute, async (context) => {
      const provisioned = await admin(context, (service) =>
        service.provision(new Date(context.req.valid("json").expiresAt)),
      );
      return context.json(
        {
          edge: { id: provisioned.edge.id, status: provisioned.edge.status },
          token: provisioned.token,
        },
        201,
      );
    })
    .openapi(rotateVenueEdgeRoute, async (context) => {
      const { edgeId } = context.req.valid("param");
      const input = context.req.valid("json");
      return context.json(
        await admin(context, (service) =>
          service.rotate(edgeId, new Date(input.expiresAt), new Date(input.overlapExpiresAt)),
        ),
        200,
      );
    })
    .openapi(revokeVenueEdgeRoute, async (context) => {
      const { edgeId } = context.req.valid("param");
      await admin(context, (service) => service.revoke(edgeId));
      return context.body(null, 204);
    })
    .openapi(registerVenueEdgeRoute, async (context) => {
      const { edgeId } = context.req.valid("param");
      await edge(context, edgeId, (service) => service.register(edgeId, context.req.valid("json")));
      return context.body(null, 204);
    })
    .openapi(renewVenueEdgeLeaseRoute, async (context) => {
      const { edgeId, sessionId, assignmentEpoch } = context.req.valid("param");
      await edgeToken(context, edgeId);
      try {
        return context.json(
          await assignments(context).renew({
            provisioningEdgeId: edgeId,
            sessionId,
            assignmentEpoch,
            leaseExpiresAt: context.req.valid("json").leaseExpiresAt,
          }),
          200,
        );
      } catch (error) {
        if (error instanceof RuntimeAssignmentError) throw httpError(context, "conflict");
        throw error;
      }
    })
    .openapi(releaseVenueEdgeLeaseRoute, async (context) => {
      const { edgeId, sessionId, assignmentEpoch } = context.req.valid("param");
      await edgeToken(context, edgeId);
      try {
        await assignments(context).release({
          provisioningEdgeId: edgeId,
          sessionId,
          assignmentEpoch,
        });
      } catch (error) {
        if (error instanceof RuntimeAssignmentError) throw httpError(context, "conflict");
        throw error;
      }
      return context.body(null, 204);
    });
}

const httpError = (
  context: AppContext,
  code: VenueEdgeError["code"],
  status: 401 | 403 | 404 | 409 = errors[code],
) =>
  new HTTPException(status, {
    res: context.json({ error: { code, message: code.replaceAll("_", " ") } }, status),
  });
