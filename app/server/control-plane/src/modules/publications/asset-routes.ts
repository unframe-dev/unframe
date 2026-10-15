import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnvironment } from "../../config";
import { downloadPublicationAssetRoute } from "../../openapi";
import { PublicationAssetAccess } from "./asset-access";
import { PublicationError, PublicationService } from "./service";

export function createPublicationAssetRoutes() {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json(
            { error: { code: "validation_error", message: "Invalid asset capability" } },
            400,
          ),
  });
  return app.openapi(downloadPublicationAssetRoute, async (context) => {
    const config = context.get("config");
    const target = context.req.valid("param");
    const { expires, signature } = context.req.valid("query");
    if (
      !config.PUBLICATION_ASSET_ORIGIN ||
      !(await new PublicationAssetAccess(config.SERVICE_IDENTITY_SECRET).verify(
        target,
        expires,
        signature,
      ))
    )
      return context.json(
        { error: { code: "forbidden", message: "Invalid or expired asset capability" } },
        403,
      );
    try {
      const asset = await new PublicationService(config.DB, config.ASSETS).downloadPublishedAsset(
        target.presentationId,
        target.buildId,
        target.assetId,
      );
      return context.body(asset.bytes, 200, {
        "content-type": asset.mediaType,
        "content-length": String(asset.bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
    } catch (error) {
      if (!(error instanceof PublicationError)) throw error;
      return context.json(
        { error: { code: error.code, message: "Published asset unavailable" } },
        error.code === "not_found" ? 404 : 409,
      );
    }
  });
}
