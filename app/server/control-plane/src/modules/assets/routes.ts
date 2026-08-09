import type { Context, Hono } from "hono";
import { z } from "zod";
import { D1AssetRepository } from "../../adapters/assets/d1-repository";
import { D1PresentationPermission } from "../../adapters/assets/presentation-permission";
import { R2Presigner } from "../../adapters/assets/r2-presigner";
import { R2ObjectStorage } from "../../adapters/assets/r2-storage";
import type { AppEnvironment } from "../../config";
import type { Identity } from "../../presentation/service";
import { assetInitInputSchema } from "./schema";
import { AssetError, AssetService, type AssetServices } from "./service";

export type AssetIdentityProvider = (
  context: Context<AppEnvironment>,
) => Promise<Identity | undefined>;
export type AssetRouteOptions = {
  identityProvider: AssetIdentityProvider;
  services?: ((context: Context<AppEnvironment>) => AssetServices) | undefined;
};

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const assetErrorStatus = {
  not_found: 404,
  forbidden: 403,
  referenced: 409,
  verification_failed: 422,
  access_unavailable: 503,
} as const satisfies Record<AssetError["code"], 403 | 404 | 409 | 422 | 503>;

const resource = (asset: Awaited<ReturnType<AssetService["finalize"]>>) => ({
  id: asset.id,
  presentationId: asset.presentationId,
  name: asset.name,
  mediaType: asset.mediaType,
  sizeBytes: asset.sizeBytes,
  sha256Hex: asset.sha256Hex,
  status: asset.status,
  createdAt: asset.createdAt.toISOString(),
  updatedAt: asset.updatedAt.toISOString(),
});

const defaultServices = (context: Context<AppEnvironment>): AssetServices => {
  const config = context.get("config");
  return {
    repository: new D1AssetRepository(config.DB),
    permission: new D1PresentationPermission(config.DB),
    storage: new R2ObjectStorage(config.ASSETS),
    signedAccess: new R2Presigner(config),
    clock: { now: () => new Date() },
    id: { next: crypto.randomUUID, random: crypto.randomUUID },
    audit: (entry) => console.log(JSON.stringify(entry)),
  };
};

export function registerAssetRoutes(
  app: Hono<AppEnvironment>,
  options: AssetRouteOptions,
) {
  const execute = async <T>(
    context: Context<AppEnvironment>,
    operation: (identity: Identity, service: AssetService) => Promise<T>,
  ) => {
    const identity = await options.identityProvider(context);
    if (!identity) {
      return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    try {
      return await operation(
        identity,
        new AssetService(options.services?.(context) ?? defaultServices(context)),
      );
    } catch (error) {
      if (error instanceof AssetError) {
        return context.json(
          { error: { code: error.code, message: error.code.replace("_", " ") } },
          assetErrorStatus[error.code],
        );
      }
      throw error;
    }
  };
  app.post("/assets/uploads", async (context) => {
    const result = await execute(context, async (identity, service) => {
      let body: unknown;
      try {
        body = await context.req.json();
      } catch {
        return context.json(
          { error: { code: "validation_error", message: "Invalid asset upload" } },
          400,
        );
      }
      const parsed = assetInitInputSchema.safeParse(body);
      if (!parsed.success) {
        return context.json(
          { error: { code: "validation_error", message: "Invalid asset upload" } },
          400,
        );
      }
      return service.init(identity, parsed.data);
    });
    return result instanceof Response
      ? result
      : context.json(
          {
            asset: resource(result.asset),
            upload: { ...result.putAccess, expiresAt: result.putAccess.expiresAt.toISOString() },
          },
          201,
        );
  });
  app.get("/assets/:id", async (context) => {
    const parsed = id.safeParse(context.req.param("id"));
    if (!parsed.success) {
      return context.json(
        { error: { code: "validation_error", message: "Invalid asset id" } },
        400,
      );
    }
    const result = await execute(context, async (identity, service) => {
      const asset = await service.get(identity, parsed.data);
      return resource(asset);
    });
    return result instanceof Response ? result : context.json(result);
  });
  app.post("/assets/:id/finalize", async (context) => {
    const parsed = id.safeParse(context.req.param("id"));
    if (!parsed.success) {
      return context.json(
        { error: { code: "validation_error", message: "Invalid asset id" } },
        400,
      );
    }
    const result = await execute(context, (identity, service) =>
      service.finalize(identity, parsed.data),
    );
    return result instanceof Response ? result : context.json(resource(result));
  });
  app.get("/assets/:id/download", async (context) => {
    const parsed = id.safeParse(context.req.param("id"));
    if (!parsed.success) {
      return context.json(
        { error: { code: "validation_error", message: "Invalid asset id" } },
        400,
      );
    }
    const result = await execute(context, (identity, service) =>
      service.download(identity, parsed.data),
    );
    return result instanceof Response
      ? result
      : context.json({ download: { ...result, expiresAt: result.expiresAt.toISOString() } });
  });
  app.delete("/assets/:id", async (context) => {
    const parsed = id.safeParse(context.req.param("id"));
    if (!parsed.success) {
      return context.json(
        { error: { code: "validation_error", message: "Invalid asset id" } },
        400,
      );
    }
    const result = await execute(context, (identity, service) =>
      service.delete(identity, parsed.data),
    );
    return result instanceof Response ? result : context.body(null, 204);
  });
}
