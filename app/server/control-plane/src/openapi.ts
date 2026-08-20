import { createRoute, z } from "@hono/zod-openapi";
import { assetInitInputSchema, assetMediaTypeSchema } from "./modules/assets/schema";
import {
  checkpointInputSchema,
  completionInputSchema,
} from "./modules/persistence-callback/schema";
import { joinCodeSchema, sessionStateSchema } from "./modules/sessions/schema";
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
const serviceSecurity = [{ serviceBearer: [] }];

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
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value: string) => new URL(value).protocol === "https:", "HTTPS URL required");
const idParameter = z.object({ id: identifierSchema }).strict();
const sessionResourceSchema = z.object({
  id: z.string(),
  presentationId: z.string(),
  presenterId: z.string(),
  state: sessionStateSchema,
  participantCount: z.number().int().min(1).max(50),
  maxParticipants: z.literal(50),
  createdAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});
const sessionIdParameter = idParameter;
const realtimeConnectionSchema = z.object({
  endpoint: httpsUrlSchema,
  fingerprint: z.string(),
  edgeId: identifierSchema,
  assignmentEpoch: z.number().int().positive(),
  presentationId: identifierSchema,
  presentationRevision: z.number().int().positive(),
  credential: z.string(),
  expiresAt: z.string().datetime(),
});
const venueEdgeResourceSchema = z.object({
  id: identifierSchema,
  status: z.enum(["active", "revoked"]),
});
const venueEdgeCredentialSchema = z.object({ edge: venueEdgeResourceSchema, token: z.string() });
const assignmentSchema = z.object({
  sessionId: identifierSchema,
  edgeId: identifierSchema,
  assignmentEpoch: z.number().int().positive(),
  presentationRevision: z.number().int().positive(),
  issuedAt: z.string().datetime(),
  leaseExpiresAt: z.string().datetime(),
  releasedAt: z.string().datetime().nullable(),
});
const edgeIdParameter = z.object({ edgeId: identifierSchema }).strict();
const sessionAssignmentParameter = z.object({ sessionId: identifierSchema }).strict();
const edgeLeaseParameter = z
  .object({
    edgeId: identifierSchema,
    sessionId: identifierSchema,
    assignmentEpoch: z.coerce.number().int().positive(),
  })
  .strict();
const adminSecurity = [{ bearerAuth: [] }, { cookieSession: [] }];
const edgeSecurity = [{ edgeBearer: [] }];

export const publicRoutes = [
  createRoute({
    method: "post",
    path: "/presentations",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: presentationCreateDefinitionSchema } },
      },
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
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({
                expectedRevision: z.number().int().positive(),
                definition: presentationDefinitionSchema,
              })
              .strict(),
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
        required: true,
        content: {
          "application/json": {
            schema: z.object({ expectedRevision: z.number().int().positive() }).strict(),
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
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: assetInitInputSchema } },
      },
    },
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
  createRoute({
    method: "post",
    path: "/sessions",
    security,
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z.object({ presentationId: identifierSchema }).strict(),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Created",
        content: {
          "application/json": {
            schema: z.object({ session: sessionResourceSchema, joinCode: joinCodeSchema }),
          },
        },
      },
      400: errorResponse("Invalid session"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Presentation not found"),
    },
  }),
  createRoute({
    method: "post",
    path: "/sessions/join",
    security,
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: z.object({ joinCode: joinCodeSchema }).strict() },
        },
      },
    },
    responses: {
      200: {
        description: "Joined",
        content: { "application/json": { schema: sessionResourceSchema } },
      },
      400: errorResponse("Invalid join code"),
      401: errorResponse("Unauthorized"),
      404: errorResponse("Not found"),
      409: errorResponse("Session full"),
      429: errorResponse("Rate limited"),
    },
  }),
  createRoute({
    method: "get",
    path: "/sessions/{id}",
    security,
    request: { params: sessionIdParameter },
    responses: {
      200: {
        description: "Session",
        content: { "application/json": { schema: sessionResourceSchema } },
      },
      400: errorResponse("Invalid id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
    },
  }),
  createRoute({
    method: "post",
    path: "/sessions/{id}/start",
    security,
    request: { params: sessionIdParameter },
    responses: {
      200: {
        description: "Presenting",
        content: { "application/json": { schema: sessionResourceSchema } },
      },
      400: errorResponse("Invalid id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Invalid transition"),
    },
  }),
  createRoute({
    method: "post",
    path: "/sessions/{id}/end",
    security,
    request: { params: sessionIdParameter },
    responses: {
      200: {
        description: "Ended",
        content: { "application/json": { schema: sessionResourceSchema } },
      },
      400: errorResponse("Invalid id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Invalid transition"),
    },
  }),
  createRoute({
    method: "post",
    path: "/sessions/{id}/bootstrap",
    security,
    request: { params: sessionIdParameter },
    responses: {
      200: {
        description: "Realtime connection",
        content: { "application/json": { schema: realtimeConnectionSchema } },
      },
      400: errorResponse("Invalid id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Session ended"),
    },
  }),
  createRoute({
    method: "get",
    path: "/.well-known/jwks.json",
    responses: {
      200: {
        description: "Realtime signing keys",
        content: {
          "application/json": {
            schema: z.object({
              keys: z.array(
                z.object({
                  kty: z.literal("OKP"),
                  crv: z.literal("Ed25519"),
                  x: z.string(),
                  kid: z.string(),
                  alg: z.literal("EdDSA"),
                  use: z.literal("sig"),
                  key_ops: z.tuple([z.literal("verify")]),
                }),
              ),
            }),
          },
        },
      },
    },
  }),
  createRoute({
    method: "post",
    path: "/callbacks/checkpoints",
    security: serviceSecurity,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: checkpointInputSchema } },
      },
    },
    responses: {
      200: {
        description: "Persistence result",
        content: { "application/json": { schema: z.object({ applied: z.boolean() }) } },
      },
      400: errorResponse("Invalid callback"),
      401: errorResponse("Unauthorized"),
      404: errorResponse("Session not found"),
    },
  }),
  createRoute({
    method: "post",
    path: "/callbacks/completions",
    security: serviceSecurity,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: completionInputSchema } },
      },
    },
    responses: {
      200: {
        description: "Persistence result",
        content: { "application/json": { schema: z.object({ applied: z.boolean() }) } },
      },
      400: errorResponse("Invalid callback"),
      401: errorResponse("Unauthorized"),
      404: errorResponse("Session not found"),
    },
  }),
  createRoute({
    method: "post",
    path: "/venue-edges",
    security: adminSecurity,
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: z.object({ expiresAt: z.string().datetime() }).strict() },
        },
      },
    },
    responses: {
      201: {
        description: "Provisioned",
        content: { "application/json": { schema: venueEdgeCredentialSchema } },
      },
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      409: errorResponse("Invalid credential expiry"),
    },
  }),
  createRoute({
    method: "post",
    path: "/venue-edges/{edgeId}/rotate",
    security: adminSecurity,
    request: {
      params: edgeIdParameter,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({ expiresAt: z.string().datetime(), overlapExpiresAt: z.string().datetime() })
              .strict(),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Rotated",
        content: {
          "application/json": {
            schema: z.object({ tokenId: identifierSchema, token: z.string() }),
          },
        },
      },
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Invalid credential expiry"),
    },
  }),
  createRoute({
    method: "delete",
    path: "/venue-edges/{edgeId}",
    security: adminSecurity,
    request: { params: edgeIdParameter },
    responses: {
      204: { description: "Revoked" },
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
    },
  }),
  createRoute({
    method: "post",
    path: "/sessions/{sessionId}/venue-edge-assignment",
    security: adminSecurity,
    request: {
      params: sessionAssignmentParameter,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({
                edgeId: identifierSchema,
                presentationRevision: z.number().int().positive(),
                leaseExpiresAt: z.string().datetime(),
              })
              .strict(),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Assigned",
        content: { "application/json": { schema: assignmentSchema } },
      },
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      409: errorResponse("Active assignment exists"),
    },
  }),
  createRoute({
    method: "get",
    path: "/sessions/{sessionId}/venue-edge-assignment",
    security: adminSecurity,
    request: { params: sessionAssignmentParameter },
    responses: {
      200: {
        description: "Active assignment",
        content: {
          "application/json": {
            schema: assignmentSchema.extend({
              localEndpoint: httpsUrlSchema,
              certificateFingerprint: z.string(),
            }),
          },
        },
      },
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      409: errorResponse("No active assignment"),
    },
  }),
  createRoute({
    method: "post",
    path: "/venue-edges/{edgeId}/register",
    security: edgeSecurity,
    request: {
      params: edgeIdParameter,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({
                runtimeVersion: z.string().min(1),
                protocolVersion: z.literal("v1"),
                capacity: z.number().int().nonnegative(),
                localEndpoint: httpsUrlSchema,
                certificateFingerprint: z.string().min(1),
                health: z.string().min(1),
              })
              .strict(),
          },
        },
      },
    },
    responses: {
      204: { description: "Registered" },
      401: errorResponse("Unauthorized"),
      404: errorResponse("Not found"),
    },
  }),
  createRoute({
    method: "post",
    path: "/venue-edges/{edgeId}/assignments/{sessionId}/{assignmentEpoch}/renew",
    security: edgeSecurity,
    request: {
      params: edgeLeaseParameter,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z.object({ leaseExpiresAt: z.string().datetime() }).strict(),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Renewed",
        content: { "application/json": { schema: assignmentSchema } },
      },
      401: errorResponse("Unauthorized"),
      409: errorResponse("Invalid lease"),
    },
  }),
  createRoute({
    method: "post",
    path: "/venue-edges/{edgeId}/assignments/{sessionId}/{assignmentEpoch}/release",
    security: edgeSecurity,
    request: { params: edgeLeaseParameter },
    responses: {
      204: { description: "Released" },
      401: errorResponse("Unauthorized"),
      409: errorResponse("Invalid lease"),
    },
  }),
] as const;

export const createPresentationRoute = publicRoutes[0];
export const listPresentationsRoute = publicRoutes[1];
export const getPresentationRoute = publicRoutes[2];
export const replacePresentationRoute = publicRoutes[3];
export const deletePresentationRoute = publicRoutes[4];
export const initAssetUploadRoute = publicRoutes[5];
export const getAssetRoute = publicRoutes[6];
export const finalizeAssetRoute = publicRoutes[7];
export const downloadAssetRoute = publicRoutes[8];
export const deleteAssetRoute = publicRoutes[9];
export const createSessionRoute = publicRoutes[10];
export const joinSessionRoute = publicRoutes[11];
export const getSessionRoute = publicRoutes[12];
export const startSessionRoute = publicRoutes[13];
export const endSessionRoute = publicRoutes[14];
export const bootstrapSessionRoute = publicRoutes[15];
export const jwksRoute = publicRoutes[16];
export const checkpointRoute = publicRoutes[17];
export const completionRoute = publicRoutes[18];
export const provisionVenueEdgeRoute = publicRoutes[19];
export const rotateVenueEdgeRoute = publicRoutes[20];
export const revokeVenueEdgeRoute = publicRoutes[21];
export const assignVenueEdgeRoute = publicRoutes[22];
export const getVenueEdgeAssignmentRoute = publicRoutes[23];
export const registerVenueEdgeRoute = publicRoutes[24];
export const renewVenueEdgeLeaseRoute = publicRoutes[25];
export const releaseVenueEdgeLeaseRoute = publicRoutes[26];
