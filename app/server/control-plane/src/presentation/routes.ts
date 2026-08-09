import type { Context, Hono } from "hono";
import { z } from "zod";
import { D1PresentationRepository, type PresentationRepository } from "./repository";
import { presentationCreateDefinitionSchema, presentationDefinitionSchema } from "./schema";
import { type Identity, PresentationError, PresentationService } from "./service";

export type IdentityProvider = (
  context: Context<{ Bindings: CloudflareBindings }>,
) => Promise<Identity | undefined>;
export type PresentationRouteOptions = {
  identityProvider: IdentityProvider;
  repository?: PresentationRepository | undefined;
  now?: (() => string) | undefined;
  id?: (() => string) | undefined;
};

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const expectedRevisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
const invalidJson = { error: { code: "validation_error", message: "Invalid JSON body" } } as const;

const readJson = async (context: Context<{ Bindings: CloudflareBindings }>) => {
  try {
    return { ok: true as const, value: await context.req.json() };
  } catch {
    return { ok: false as const };
  }
};

export function registerPresentationRoutes(
  app: Hono<{ Bindings: CloudflareBindings }>,
  options: PresentationRouteOptions,
) {
  const serviceFor = (context: Context<{ Bindings: CloudflareBindings }>) =>
    new PresentationService(
      options.repository ?? new D1PresentationRepository(context.env.DB),
      options.now ?? (() => new Date().toISOString()),
      options.id ?? crypto.randomUUID,
    );
  const identityFor = async (context: Context<{ Bindings: CloudflareBindings }>) => {
    const identity = await options.identityProvider(context);
    if (!identity)
      return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    return identity;
  };
  const execute = async <T>(
    context: Context<{ Bindings: CloudflareBindings }>,
    operation: (identity: Identity, service: PresentationService) => Promise<T>,
  ) => {
    const identity = await identityFor(context);
    if (identity instanceof Response) return identity;
    try {
      return await operation(identity, serviceFor(context));
    } catch (error) {
      if (error instanceof PresentationError)
        return context.json(
          {
            error: {
              code: error.code,
              message:
                error.code === "not_found"
                  ? "Not found"
                  : error.code === "forbidden"
                    ? "Forbidden"
                    : error.code === "invalid_asset_reference"
                      ? "Asset reference is not ready or does not belong to this presentation"
                      : "Revision conflict or presentation assets must be deleted first",
            },
          },
          error.code === "not_found"
            ? 404
            : error.code === "forbidden"
              ? 403
              : error.code === "invalid_asset_reference"
                ? 422
                : 409,
        );
      throw error;
    }
  };
  app.post("/presentations", async (context) => {
    const body = await readJson(context);
    if (!body.ok) return context.json(invalidJson, 400);
    const parsed = presentationCreateDefinitionSchema.safeParse(body.value);
    if (!parsed.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid presentation definition" } },
        400,
      );
    const result = await execute(context, (identity, service) =>
      service.create(identity, parsed.data),
    );
    return result instanceof Response ? result : context.json(result, 201);
  });
  app.get("/presentations", async (context) => {
    const result = await execute(context, (identity, service) => service.list(identity));
    return result instanceof Response ? result : context.json({ presentations: result });
  });
  app.get("/presentations/:id", async (context) => {
    const id = identifier.safeParse(context.req.param("id"));
    if (!id.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid presentation id" } },
        400,
      );
    const result = await execute(context, (identity, service) => service.get(identity, id.data));
    return result instanceof Response ? result : context.json(result);
  });
  app.put("/presentations/:id", async (context) => {
    const id = identifier.safeParse(context.req.param("id"));
    if (!id.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid presentation id" } },
        400,
      );
    const body = await readJson(context);
    if (!body.ok) return context.json(invalidJson, 400);
    const parsed = z
      .object({
        expectedRevision: z.number().int().positive(),
        definition: presentationDefinitionSchema,
      })
      .strict()
      .safeParse(body.value);
    if (!parsed.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid presentation update" } },
        400,
      );
    const result = await execute(context, (identity, service) =>
      service.replace(identity, id.data, parsed.data.expectedRevision, parsed.data.definition),
    );
    return result instanceof Response ? result : context.json(result);
  });
  app.delete("/presentations/:id", async (context) => {
    const id = identifier.safeParse(context.req.param("id"));
    if (!id.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid presentation id" } },
        400,
      );
    const body = await readJson(context);
    if (!body.ok) return context.json(invalidJson, 400);
    const parsed = expectedRevisionSchema.safeParse(body.value);
    if (!parsed.success)
      return context.json(
        { error: { code: "validation_error", message: "Invalid delete request" } },
        400,
      );
    const result = await execute(context, (identity, service) =>
      service.delete(identity, id.data, parsed.data.expectedRevision),
    );
    return result instanceof Response ? result : context.body(null, 204);
  });
}
