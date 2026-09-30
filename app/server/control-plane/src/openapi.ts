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
  content: { "application/json": { schema: errorSchema } },
  description,
});
const security = [{ bearerAuth: [] }, { cookieSession: [] }];
const serviceSecurity = [{ serviceBearer: [] }];

const presentationResourceSchema = z.object({
  createdAt: z.string(),
  definition: presentationDefinitionSchema,
  id: z.string(),
  revision: z.number().int(),
  updatedAt: z.string(),
});
const assetResourceSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  mediaType: assetMediaTypeSchema,
  name: z.string(),
  presentationId: z.string(),
  sha256Hex: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(["pending", "ready", "failed", "deleting"]),
  updatedAt: z.string(),
});
const uploadSchema = z.object({
  asset: assetResourceSchema,
  upload: z.object({
    expiresAt: z.string(),
    headers: z.object({
      "content-length": z.string(),
      "content-type": assetMediaTypeSchema,
      "x-amz-checksum-sha256": z.string(),
    }),
    method: z.literal("PUT"),
    url: z.string().url(),
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
  createdAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  id: z.string(),
  maxParticipants: z.literal(50),
  participantCount: z.number().int().min(1).max(50),
  presentationId: z.string(),
  presenterId: z.string(),
  state: sessionStateSchema,
});
const sessionIdParameter = idParameter;
const realtimeConnectionSchema = z.object({
  assignmentEpoch: z.number().int().positive(),
  credential: z.string(),
  endpoint: httpsUrlSchema,
  expiresAt: z.string().datetime(),
  fingerprint: z.string().nullable(),
  presentationId: identifierSchema,
  presentationRevision: z.number().int().positive(),
  runtimeId: identifierSchema,
  runtimeKind: z.enum(["Cloud", "VenueEdge"]),
});
const venueEdgeResourceSchema = z.object({
  id: identifierSchema,
  status: z.enum(["active", "revoked"]),
});
const venueEdgeCredentialSchema = z.object({ edge: venueEdgeResourceSchema, token: z.string() });
const assignmentSchema = z.object({
  assignmentEpoch: z.number().int().positive(),
  certificateFingerprint: z.string().nullable(),
  endpoint: httpsUrlSchema,
  issuedAt: z.string().datetime(),
  leaseExpiresAt: z.string().datetime(),
  presentationRevision: z.number().int().positive(),
  provisioningEdgeId: identifierSchema.nullable(),
  releasedAt: z.string().datetime().nullable(),
  runtimeId: identifierSchema,
  runtimeKind: z.enum(["Cloud", "VenueEdge"]),
  sessionId: identifierSchema,
});
const edgeIdParameter = z.object({ edgeId: identifierSchema }).strict();
const sessionAssignmentParameter = z.object({ sessionId: identifierSchema }).strict();
const edgeLeaseParameter = z
  .object({
    assignmentEpoch: z.coerce.number().int().positive(),
    edgeId: identifierSchema,
    sessionId: identifierSchema,
  })
  .strict();
const adminSecurity = [{ bearerAuth: [] }, { cookieSession: [] }];
const edgeSecurity = [{ edgeBearer: [] }];

export const publicRoutes = [
  createRoute({
    method: "post",
    path: "/presentations",
    request: {
      body: {
        content: { "application/json": { schema: presentationCreateDefinitionSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: presentationResourceSchema } },
        description: "Created",
      },
      400: errorResponse("Invalid definition"),
      401: errorResponse("Unauthorized"),
    },
    security,
  }),
  createRoute({
    method: "get",
    path: "/presentations",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ presentations: z.array(presentationResourceSchema) }),
          },
        },
        description: "Collection",
      },
      401: errorResponse("Unauthorized"),
    },
    security,
  }),
  createRoute({
    method: "get",
    path: "/presentations/{id}",
    request: { params: idParameter },
    responses: {
      200: {
        content: { "application/json": { schema: presentationResourceSchema } },
        description: "Presentation",
      },
      400: errorResponse("Invalid presentation id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
    },
    security,
  }),
  createRoute({
    method: "put",
    path: "/presentations/{id}",
    request: {
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
      params: idParameter,
    },
    responses: {
      200: {
        content: { "application/json": { schema: presentationResourceSchema } },
        description: "Updated",
      },
      400: errorResponse("Invalid presentation update"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Revision conflict"),
      422: errorResponse("Asset reference is not ready or does not belong to this presentation"),
    },
    security,
  }),
  createRoute({
    method: "delete",
    path: "/presentations/{id}",
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z.object({ expectedRevision: z.number().int().positive() }).strict(),
          },
        },
      },
      params: idParameter,
    },
    responses: {
      204: { description: "Deleted" },
      400: errorResponse("Invalid delete request"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Revision conflict or presentation assets must be deleted first"),
    },
    security,
  }),
  createRoute({
    method: "post",
    path: "/assets/uploads",
    request: {
      body: {
        content: { "application/json": { schema: assetInitInputSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: uploadSchema } },
        description: "Upload initialized",
      },
      400: errorResponse("Invalid upload"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      503: errorResponse("Signing unavailable"),
    },
    security,
  }),
  createRoute({
    method: "get",
    path: "/assets/{id}",
    request: { params: idParameter },
    responses: {
      200: {
        content: { "application/json": { schema: assetResourceSchema } },
        description: "Asset",
      },
      400: errorResponse("Invalid asset id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
    },
    security,
  }),
  createRoute({
    method: "post",
    path: "/assets/{id}/finalize",
    request: { params: idParameter },
    responses: {
      200: {
        content: { "application/json": { schema: assetResourceSchema } },
        description: "Finalized",
      },
      400: errorResponse("Invalid asset id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      422: errorResponse("Verification failed"),
    },
    security,
  }),
  createRoute({
    method: "get",
    path: "/assets/{id}/download",
    request: { params: idParameter },
    responses: {
      200: {
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
        description: "Download access",
      },
      400: errorResponse("Invalid asset id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      503: errorResponse("Access unavailable"),
    },
    security,
  }),
  createRoute({
    method: "delete",
    path: "/assets/{id}",
    request: { params: idParameter },
    responses: {
      204: { description: "Deleted" },
      400: errorResponse("Invalid asset id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Referenced"),
    },
    security,
  }),
  createRoute({
    method: "post",
    path: "/sessions",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ presentationId: identifierSchema }).strict(),
          },
        },
        required: true,
      },
    },
    responses: {
      201: {
        content: {
          "application/json": {
            schema: z.object({ session: sessionResourceSchema, joinCode: joinCodeSchema }),
          },
        },
        description: "Created",
      },
      400: errorResponse("Invalid session"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Presentation not found"),
    },
    security,
  }),
  createRoute({
    method: "post",
    path: "/sessions/join",
    request: {
      body: {
        content: {
          "application/json": { schema: z.object({ joinCode: joinCodeSchema }).strict() },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: sessionResourceSchema } },
        description: "Joined",
      },
      400: errorResponse("Invalid join code"),
      401: errorResponse("Unauthorized"),
      404: errorResponse("Not found"),
      409: errorResponse("Session full"),
      429: errorResponse("Rate limited"),
    },
    security,
  }),
  createRoute({
    method: "get",
    path: "/sessions/{id}",
    request: { params: sessionIdParameter },
    responses: {
      200: {
        content: { "application/json": { schema: sessionResourceSchema } },
        description: "Session",
      },
      400: errorResponse("Invalid id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
    },
    security,
  }),
  createRoute({
    method: "post",
    path: "/sessions/{id}/start",
    request: { params: sessionIdParameter },
    responses: {
      200: {
        content: { "application/json": { schema: sessionResourceSchema } },
        description: "Presenting",
      },
      400: errorResponse("Invalid id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Invalid transition"),
    },
    security,
  }),
  createRoute({
    method: "post",
    path: "/sessions/{id}/end",
    request: { params: sessionIdParameter },
    responses: {
      200: {
        content: { "application/json": { schema: sessionResourceSchema } },
        description: "Ended",
      },
      400: errorResponse("Invalid id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Invalid transition"),
    },
    security,
  }),
  createRoute({
    method: "post",
    path: "/sessions/{id}/bootstrap",
    request: { params: sessionIdParameter },
    responses: {
      200: {
        content: { "application/json": { schema: realtimeConnectionSchema } },
        description: "Realtime connection",
      },
      400: errorResponse("Invalid id"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Session ended"),
    },
    security,
  }),
  createRoute({
    method: "get",
    path: "/.well-known/jwks.json",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              keys: z.array(
                z.object({
                  alg: z.literal("EdDSA"),
                  crv: z.literal("Ed25519"),
                  key_ops: z.tuple([z.literal("verify")]),
                  kid: z.string(),
                  kty: z.literal("OKP"),
                  use: z.literal("sig"),
                  x: z.string(),
                }),
              ),
            }),
          },
        },
        description: "Realtime signing keys",
      },
    },
  }),
  createRoute({
    method: "post",
    path: "/callbacks/checkpoints",
    request: {
      body: {
        content: { "application/json": { schema: checkpointInputSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ applied: z.boolean() }) } },
        description: "Persistence result",
      },
      400: errorResponse("Invalid callback"),
      401: errorResponse("Unauthorized"),
      404: errorResponse("Session not found"),
      409: errorResponse("Runtime assignment is not active"),
    },
    security: serviceSecurity,
  }),
  createRoute({
    method: "post",
    path: "/callbacks/completions",
    request: {
      body: {
        content: { "application/json": { schema: completionInputSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ applied: z.boolean() }) } },
        description: "Persistence result",
      },
      400: errorResponse("Invalid callback"),
      401: errorResponse("Unauthorized"),
      404: errorResponse("Session not found"),
      409: errorResponse("Runtime assignment is not active"),
    },
    security: serviceSecurity,
  }),
  createRoute({
    method: "post",
    path: "/venue-edges",
    request: {
      body: {
        content: {
          "application/json": { schema: z.object({ expiresAt: z.string().datetime() }).strict() },
        },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: venueEdgeCredentialSchema } },
        description: "Provisioned",
      },
      400: errorResponse("Invalid provisioning request"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      409: errorResponse("Invalid credential expiry"),
    },
    security: adminSecurity,
  }),
  createRoute({
    method: "post",
    path: "/venue-edges/{edgeId}/rotate",
    request: {
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
      params: edgeIdParameter,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ tokenId: identifierSchema, token: z.string() }),
          },
        },
        description: "Rotated",
      },
      400: errorResponse("Invalid rotation request"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
      409: errorResponse("Invalid credential expiry"),
    },
    security: adminSecurity,
  }),
  createRoute({
    method: "delete",
    path: "/venue-edges/{edgeId}",
    request: { params: edgeIdParameter },
    responses: {
      204: { description: "Revoked" },
      400: errorResponse("Invalid Edge ID"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      404: errorResponse("Not found"),
    },
    security: adminSecurity,
  }),
  createRoute({
    method: "post",
    path: "/sessions/{sessionId}/runtime-assignment",
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({
                runtimeId: identifierSchema,
                runtimeKind: z.enum(["Cloud", "VenueEdge"]),
                endpoint: httpsUrlSchema.optional(),
                presentationRevision: z.number().int().positive(),
                leaseExpiresAt: z.string().datetime(),
              })
              .strict(),
          },
        },
      },
      params: sessionAssignmentParameter,
    },
    responses: {
      201: {
        content: { "application/json": { schema: assignmentSchema } },
        description: "Assigned",
      },
      400: errorResponse("Invalid assignment request"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      409: errorResponse("Active assignment exists"),
    },
    security: adminSecurity,
  }),
  createRoute({
    method: "get",
    path: "/sessions/{sessionId}/runtime-assignment",
    request: { params: sessionAssignmentParameter },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: assignmentSchema,
          },
        },
        description: "Active assignment",
      },
      400: errorResponse("Invalid session ID"),
      401: errorResponse("Unauthorized"),
      403: errorResponse("Forbidden"),
      409: errorResponse("No active assignment"),
    },
    security: adminSecurity,
  }),
  createRoute({
    method: "post",
    path: "/venue-edges/{edgeId}/register",
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({
                runtimeId: identifierSchema,
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
      params: edgeIdParameter,
    },
    responses: {
      204: { description: "Registered" },
      400: errorResponse("Invalid registration"),
      401: errorResponse("Unauthorized"),
      404: errorResponse("Not found"),
      409: errorResponse("Runtime identity conflict"),
    },
    security: edgeSecurity,
  }),
  createRoute({
    method: "post",
    path: "/venue-edges/{edgeId}/assignments/{sessionId}/{assignmentEpoch}/renew",
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z.object({ leaseExpiresAt: z.string().datetime() }).strict(),
          },
        },
      },
      params: edgeLeaseParameter,
    },
    responses: {
      200: {
        content: { "application/json": { schema: assignmentSchema } },
        description: "Renewed",
      },
      400: errorResponse("Invalid lease renewal"),
      401: errorResponse("Unauthorized"),
      409: errorResponse("Invalid lease"),
    },
    security: edgeSecurity,
  }),
  createRoute({
    method: "post",
    path: "/venue-edges/{edgeId}/assignments/{sessionId}/{assignmentEpoch}/release",
    request: { params: edgeLeaseParameter },
    responses: {
      204: { description: "Released" },
      400: errorResponse("Invalid lease release"),
      401: errorResponse("Unauthorized"),
      409: errorResponse("Invalid lease"),
    },
    security: edgeSecurity,
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
export const assignRuntimeRoute = publicRoutes[22];
export const getRuntimeAssignmentRoute = publicRoutes[23];
export const registerVenueEdgeRoute = publicRoutes[24];
export const renewVenueEdgeLeaseRoute = publicRoutes[25];
export const releaseVenueEdgeLeaseRoute = publicRoutes[26];
