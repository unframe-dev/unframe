import { z } from "zod";
import { contentHashSchema } from "./presentation/common";
import { publicationFenceSchema } from "./presentation/publication";

export const controlPlaneIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const controlPlaneHttpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", "HTTPS URL required");
export const sessionJoinCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
export const sessionStateSchema = z.enum(["Waiting", "Presenting", "Ended"]);

export const sessionResourceSchema = z.object({
  publicationFence: publicationFenceSchema.nullable(),
  id: z.string(),
  presentationId: z.string(),
  presenterId: z.string(),
  state: sessionStateSchema,
  participantCount: z.int().min(1).max(50),
  maxParticipants: z.literal(50),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

export const realtimeConnectionSchema = z.object({
  endpoint: controlPlaneHttpsUrlSchema,
  fingerprint: z.string().nullable(),
  runtimeId: controlPlaneIdentifierSchema,
  runtimeKind: z.enum(["Cloud", "VenueEdge"]),
  assignmentEpoch: z.int().positive(),
  presentationId: controlPlaneIdentifierSchema,
  presentationRevision: z.int().positive(),
  credential: z.string(),
  expiresAt: z.iso.datetime(),
  publicationFence: z.object({
    presentationId: controlPlaneIdentifierSchema,
    publicationEpoch: z.int().positive(),
    publicationManifestHash: contentHashSchema,
  }),
  projectionProfileId: controlPlaneIdentifierSchema,
});

export const viewerCredentialSchema = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
  sessionId: z.string(),
  participantId: z.string(),
});
