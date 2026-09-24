import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnvironment } from "../config";
import {
  createPresentationRoute,
  deletePresentationRoute,
  getPresentationRoute,
  listPresentationsRoute,
  replacePresentationRoute,
} from "../openapi";
import { D1PresentationRepository, type PresentationRepository } from "./repository";
import { type Identity, PresentationError, PresentationService } from "./service";

type AppContext = Context<AppEnvironment>;

export type IdentityProvider = (context: AppContext) => Promise<Identity | undefined>;
export type PresentationRouteOptions = {
  identityProvider: IdentityProvider;
  repository?: PresentationRepository | undefined;
  now?: (() => string) | undefined;
  id?: (() => string) | undefined;
};

const presentationError = {
  not_found: { message: "Not found", status: 404 },
  forbidden: { message: "Forbidden", status: 403 },
  invalid_asset_reference: {
    message: "Asset reference is not ready or does not belong to this presentation",
    status: 422,
  },
  conflict: {
    message: "Revision conflict or presentation assets must be deleted first",
    status: 409,
  },
} as const satisfies Record<
  PresentationError["code"],
  { message: string; status: 403 | 404 | 409 | 422 }
>;

export function createPresentationRoutes(options: PresentationRouteOptions) {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json({ error: { code: "validation_error", message: "Invalid request" } }, 400),
  });
  const serviceFor = (context: AppContext) =>
    new PresentationService(
      options.repository ?? new D1PresentationRepository(context.get("config").DB),
      options.now ?? (() => new Date().toISOString()),
      options.id ?? crypto.randomUUID,
    );
  const execute = async <T>(
    context: AppContext,
    operation: (identity: Identity, service: PresentationService) => Promise<T>,
  ) => {
    const identity = await options.identityProvider(context);
    if (!identity) {
      throw new HTTPException(401, {
        res: context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401),
      });
    }
    try {
      return await operation(identity, serviceFor(context));
    } catch (error) {
      if (error instanceof PresentationError) {
        const response = presentationError[error.code];
        throw new HTTPException(response.status, {
          res: context.json(
            { error: { code: error.code, message: response.message } },
            response.status,
          ),
        });
      }
      throw error;
    }
  };
  return app
    .openapi(createPresentationRoute, async (context) => {
      const result = await execute(context, (identity, service) =>
        service.create(identity, context.req.valid("json")),
      );
      return context.json(result, 201);
    })
    .openapi(listPresentationsRoute, async (context) => {
      const result = await execute(context, (identity, service) => service.list(identity));
      return context.json({ presentations: result }, 200);
    })
    .openapi(getPresentationRoute, async (context) => {
      const result = await execute(context, (identity, service) =>
        service.get(identity, context.req.valid("param").id),
      );
      return context.json(result, 200);
    })
    .openapi(replacePresentationRoute, async (context) => {
      const { expectedRevision, definition } = context.req.valid("json");
      const result = await execute(context, (identity, service) =>
        service.replace(identity, context.req.valid("param").id, expectedRevision, definition),
      );
      return context.json(result, 200);
    })
    .openapi(deletePresentationRoute, async (context) => {
      await execute(context, (identity, service) =>
        service.delete(
          identity,
          context.req.valid("param").id,
          context.req.valid("json").expectedRevision,
        ),
      );
      return context.body(null, 204);
    });
}
