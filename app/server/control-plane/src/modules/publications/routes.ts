import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnvironment } from "../../config";
import {
  createPublicationBuildRoute,
  deliveryManifestRoute,
  getPublicationRoute,
  publishPresentationRoute,
  uploadPublicationAssetRoute,
} from "../../openapi";
import type { Identity } from "../../presentation/service";
import { PublicationError, PublicationService } from "./service";
import { DeliveryService } from "./delivery";
import { RuntimeAssignmentError } from "../runtime-assignments/service";

type AppContext = Context<AppEnvironment>;
const maximumBuildEnvelopeBytes = 64 * 1024 * 1024;
async function boundedBytes(request: Request, maximum: number): Promise<ArrayBuffer> {
  if (!request.body) throw new PublicationError("invalid_asset");
  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new PublicationError("invalid_asset");
    }
    chunks.push(value);
  }
  if (length !== maximum) throw new PublicationError("invalid_asset");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function boundedBuildEnvelope(request: Request): Promise<Request> {
  if (!request.body) throw new HTTPException(400);
  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBuildEnvelopeBytes) {
      await reader.cancel();
      throw new HTTPException(413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { method: "POST", body: bytes });
}
export type PublicationRouteOptions = {
  identityProvider: (context: AppContext) => Promise<Identity | undefined>;
};

export function createPublicationRoutes(options: PublicationRouteOptions) {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json({ error: { code: "validation_error", message: "Invalid request" } }, 400),
  });
  const execute = async <T>(
    context: AppContext,
    action: (identity: Identity, service: PublicationService) => Promise<T>,
  ) => {
    const identity = await options.identityProvider(context);
    if (!identity)
      throw new HTTPException(401, {
        res: context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401),
      });
    const { DB, ASSETS } = context.get("config");
    try {
      return await action(identity, new PublicationService(DB, ASSETS));
    } catch (error) {
      if (error instanceof PublicationError || error instanceof RuntimeAssignmentError) {
        const status = {
          not_found: 404,
          forbidden: 403,
          conflict: 409,
          invalid_build: 422,
          invalid_asset: 422,
        }[error.code] as 403 | 404 | 409 | 422;
        throw new HTTPException(status, {
          res: context.json(
            { error: { code: error.code, message: error.code.replaceAll("_", " ") } },
            status,
          ),
        });
      }
      throw error;
    }
  };
  app.use("/presentations/:presentationId/builds", async (context, next) => {
    if (context.req.method === "POST") {
      await execute(context, (identity, service) =>
        service.authorizeBuildUpload(identity, context.req.param("presentationId")),
      );
      context.req.raw = await boundedBuildEnvelope(context.req.raw);
    }
    await next();
  });
  return app
    .openapi(createPublicationBuildRoute, async (context) =>
      context.json(
        await execute(context, (identity, service) =>
          service.createBuild(
            identity,
            context.req.valid("param").presentationId,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
    )
    .openapi(uploadPublicationAssetRoute, async (context) => {
      const { presentationId, buildId, assetId } = context.req.valid("param");
      const mediaType = context.req.header("content-type") ?? "";
      await execute(context, async (identity, service) => {
        const descriptor = await service.expectedAsset(identity, presentationId, buildId, assetId);
        const bytes = await boundedBytes(context.req.raw, descriptor.encodedSizeBytes);
        await service.uploadAsset(identity, presentationId, buildId, assetId, bytes, mediaType);
      });
      return context.body(null, 204);
    })
    .openapi(publishPresentationRoute, async (context) => {
      const { buildId, expectedPublicationEpoch } = context.req.valid("json");
      return context.json(
        await execute(context, (identity, service) =>
          service.publish(
            identity,
            context.req.valid("param").presentationId,
            buildId,
            expectedPublicationEpoch,
          ),
        ),
        201,
      );
    })
    .openapi(getPublicationRoute, async (context) =>
      context.json(
        await execute(context, (identity, service) =>
          service.latest(identity, context.req.valid("param").presentationId),
        ),
        200,
      ),
    )
    .openapi(deliveryManifestRoute, async (context) => {
      const bytes = await execute(context, (identity) =>
        new DeliveryService(context.get("config")).manifest(
          identity,
          context.req.valid("param").sessionId,
          context.req.valid("json").capabilityProfileId,
        ),
      );
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      });
    });
}
