import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import type { AppEnvironment } from "../../config";
import type { IdentityProvider } from "../../presentation/routes";
import { putProfileImageRoute, deleteProfileImageRoute, getProfileImageRoute } from "../../openapi";
import { isProfilePng, profileImageSizeLimit } from "./png";
import { ProfileImageConflict, ProfileImageService } from "./service";

type AppContext = Context<AppEnvironment>;
const fail = (
  context: AppContext,
  status: 400 | 401 | 409 | 413 | 415,
  code: string,
  message: string,
): never => {
  throw new HTTPException(status, { res: context.json({ error: { code, message } }, status) });
};

async function readPng(context: AppContext) {
  if (context.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "image/png")
    fail(context, 415, "unsupported_media_type", "Expected image/png");
  const length = context.req.header("content-length");
  if (length && Number(length) > profileImageSizeLimit)
    fail(context, 413, "payload_too_large", "Profile image exceeds 2 MiB");
  const reader = context.req.raw.body?.getReader();
  if (!reader) return fail(context, 400, "validation_error", "PNG body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > profileImageSizeLimit) {
      await reader.cancel();
      fail(context, 413, "payload_too_large", "Profile image exceeds 2 MiB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (!(await isProfilePng(bytes)))
    fail(context, 400, "validation_error", "Expected a 512 by 512 PNG image");
  return bytes;
}

export function createProfileImageRoutes(identityProvider: IdentityProvider) {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json({ error: { code: "validation_error", message: "Invalid request" } }, 400),
  });
  const replace = async (context: AppContext, upload: boolean) => {
    const identity = await identityProvider(context);
    if (!identity) return fail(context, 401, "unauthorized", "Unauthorized");
    const bytes = upload ? await readPng(context) : null;
    try {
      return await new ProfileImageService(context.get("config")).replace(identity.userId, bytes);
    } catch (error) {
      if (error instanceof ProfileImageConflict)
        fail(context, 409, "conflict", "Profile image changed; reload before retrying");
      throw error;
    }
  };
  return app
    .openapi(putProfileImageRoute, async (context) =>
      context.json({ image: await replace(context, true) }, 200),
    )
    .openapi(deleteProfileImageRoute, async (context) => {
      await replace(context, false);
      return context.json({ image: null }, 200);
    })
    .openapi(getProfileImageRoute, async (context) => {
      const { userId, filename } = context.req.valid("param");
      const object = await context
        .get("config")
        .ASSETS.get(`user-images/${encodeURIComponent(userId)}/${filename}`);
      if (!object)
        return context.json(
          { error: { code: "not_found", message: "Profile image not found" } },
          404,
        );
      return new Response(await object.arrayBuffer(), {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(object.size),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
}
