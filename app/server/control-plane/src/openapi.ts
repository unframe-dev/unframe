import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { assetInitInputSchema, assetMediaTypeSchema } from "./modules/assets/schema";
import {
  presentationCreateDefinitionSchema,
  presentationDefinitionSchema,
} from "./presentation/schema";

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const security = [{ bearerAuth: [] }, { cookieSession: [] }];

const presentationResourceSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  definition: presentationDefinitionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
const assetResourceSchema = z.object({
  id: z.string(),
  presentationId: z.string(),
  name: z.string(),
  mediaType: assetMediaTypeSchema,
  sizeBytes: z.number().int(),
  sha256Hex: z.string(),
  status: z.enum(["pending", "ready", "failed", "deleting"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const uploadSchema = z.object({
  asset: assetResourceSchema,
  upload: z.object({
    method: z.literal("PUT"),
    url: z.string().url(),
    expiresAt: z.string(),
    headers: z.object({
      "content-type": assetMediaTypeSchema,
      "content-length": z.string(),
      "x-amz-checksum-sha256": z.string(),
    }),
  }),
});
const idParameter = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const publicRoutes = [
  createRoute({
    method: "post",
    path: "/presentations",
    security,
    request: {
      body: { content: { "application/json": { schema: presentationCreateDefinitionSchema } } },
    },
    responses: {
      201: {
        description: "Created",
        content: { "application/json": { schema: presentationResourceSchema } },
      },
      400: errorResponse("Invalid definition"),
      401: errorResponse("Unauthorized"),
    },
  }),
  createRoute({
    method: "get",
    path: "/presentations",
    security,
    responses: {
      200: {
        description: "Collection",
        content: {
          "application/json": {
            schema: z.object({ presentations: z.array(presentationResourceSchema) }),
          },
        },
      },
      401: errorResponse("Unauthorized"),
    },
  }),
  createRoute({
    method: "get",
    path: "/presentations/{id}",
    security,
    request: { params: idParameter },
    responses: {
      200: {
        description: "Presentation",
        content: { "application/json": { schema: presentationResourceSchema } },
      },
      400: errorResponse("Invalid presentation id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
    },
  }),
  createRoute({
    method: "put",
    path: "/presentations/{id}",
    security,
    request: {
      params: idParameter,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              expectedRevision: z.number().int().positive(),
              definition: presentationDefinitionSchema,
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated",
        content: { "application/json": { schema: presentationResourceSchema } },
      },
      400: errorResponse("Invalid presentation update"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Revision conflict"),
      422: errorResponse("Asset reference is not ready or does not belong to this presentation"),
    },
  }),
  createRoute({
    method: "delete",
    path: "/presentations/{id}",
    security,
    request: {
      params: idParameter,
      body: {
        content: {
          "application/json": {
            schema: z.object({ expectedRevision: z.number().int().positive() }),
          },
        },
      },
    },
    responses: {
      204: { description: "Deleted" },
      400: errorResponse("Invalid delete request"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Revision conflict or presentation assets must be deleted first"),
    },
  }),
  createRoute({
    method: "post",
    path: "/assets/uploads",
    security,
    request: { body: { content: { "application/json": { schema: assetInitInputSchema } } } },
    responses: {
      201: {
        description: "Upload initialized",
        content: { "application/json": { schema: uploadSchema } },
      },
      400: errorResponse("Invalid upload"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      503: errorResponse("Signing unavailable"),
    },
  }),
  createRoute({
    method: "get",
    path: "/assets/{id}",
    security,
    request: { params: idParameter },
    responses: {
      200: {
        description: "Asset",
        content: { "application/json": { schema: assetResourceSchema } },
      },
      400: errorResponse("Invalid asset id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
    },
  }),
  createRoute({
    method: "post",
    path: "/assets/{id}/finalize",
    security,
    request: { params: idParameter },
    responses: {
      200: {
        description: "Finalized",
        content: { "application/json": { schema: assetResourceSchema } },
      },
      400: errorResponse("Invalid asset id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      422: errorResponse("Verification failed"),
    },
  }),
  createRoute({
    method: "get",
    path: "/assets/{id}/download",
    security,
    request: { params: idParameter },
    responses: {
      200: {
        description: "Download access",
        content: {
          "application/json": {
            schema: z.object({
              download: z.object({
                method: z.literal("GET"),
                url: z.string().url(),
                expiresAt: z.string(),
              }),
            }),
          },
        },
      },
      400: errorResponse("Invalid asset id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      503: errorResponse("Access unavailable"),
    },
  }),
  createRoute({
    method: "delete",
    path: "/assets/{id}",
    security,
    request: { params: idParameter },
    responses: {
      204: { description: "Deleted" },
      400: errorResponse("Invalid asset id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Referenced"),
    },
  }),
] as const;

export const createOpenAPIDocument = () => {
  const app = new OpenAPIHono();
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieSession", {
    type: "apiKey",
    in: "cookie",
    name: "__Secure-better-auth.session_token",
  });
  publicRoutes.forEach((route) => app.openapi(route, (context) => context.body(null)));
  return app.getOpenAPIDocument({
    openapi: "3.0.3",
    info: { title: "Unframe Control Plane", version: "1.0.0" },
  });
};
