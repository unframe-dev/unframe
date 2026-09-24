import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { D1AssetRepository } from "../../adapters/assets/d1-repository";
import { D1PresentationPermission } from "../../adapters/assets/presentation-permission";
import { R2Presigner } from "../../adapters/assets/r2-presigner";
import { R2ObjectStorage } from "../../adapters/assets/r2-storage";
import type { AppEnvironment } from "../../config";
import {
  deleteAssetRoute,
  downloadAssetRoute,
  finalizeAssetRoute,
  getAssetRoute,
  initAssetUploadRoute,
} from "../../openapi";
import type { Identity } from "../../presentation/service";
import { AssetError, AssetService, type AssetServices } from "./service";

export type AssetIdentityProvider = (
  context: Context<AppEnvironment>,
) => Promise<Identity | undefined>;
export type AssetRouteOptions = {
  identityProvider: AssetIdentityProvider;
  services?: ((context: Context<AppEnvironment>) => AssetServices) | undefined;
};

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

export function createAssetRoutes(options: AssetRouteOptions) {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json({ error: { code: "validation_error", message: "Invalid request" } }, 400),
  });
  const execute = async <T>(
    context: Context<AppEnvironment>,
    operation: (identity: Identity, service: AssetService) => Promise<T>,
  ) => {
    try {
      const identity = context.get("identity");
      if (!identity) throw new Error("Authenticated asset identity is missing");
      return await operation(
        identity,
        new AssetService(options.services?.(context) ?? defaultServices(context)),
      );
    } catch (error) {
      if (error instanceof AssetError) {
        const status = assetErrorStatus[error.code];
        throw new HTTPException(status, {
          res: context.json(
            { error: { code: error.code, message: error.code.replace("_", " ") } },
            status,
          ),
        });
      }
      throw error;
    }
  };
  app.use("/assets/*", async (context, next) => {
    const identity = await options.identityProvider(context);
    if (!identity) {
      return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    context.set("identity", identity);
    await next();
  });
  return app
    .openapi(initAssetUploadRoute, async (context) => {
      const result = await execute(context, (identity, service) =>
        service.init(identity, context.req.valid("json")),
      );
      return context.json(
        {
          asset: resource(result.asset),
          upload: { ...result.putAccess, expiresAt: result.putAccess.expiresAt.toISOString() },
        },
        201,
      );
    })
    .openapi(getAssetRoute, async (context) => {
      const result = await execute(context, async (identity, service) =>
        resource(await service.get(identity, context.req.valid("param").id)),
      );
      return context.json(result, 200);
    })
    .openapi(finalizeAssetRoute, async (context) => {
      const result = await execute(context, async (identity, service) =>
        resource(await service.finalize(identity, context.req.valid("param").id)),
      );
      return context.json(result, 200);
    })
    .openapi(downloadAssetRoute, async (context) => {
      const result = await execute(context, (identity, service) =>
        service.download(identity, context.req.valid("param").id),
      );
      return context.json(
        { download: { ...result, expiresAt: result.expiresAt.toISOString() } },
        200,
      );
    })
    .openapi(deleteAssetRoute, async (context) => {
      await execute(context, (identity, service) =>
        service.delete(identity, context.req.valid("param").id),
      );
      return context.body(null, 204);
    });
}
