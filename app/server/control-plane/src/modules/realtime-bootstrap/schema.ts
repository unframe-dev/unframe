import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const realtimeParticipantRoleSchema = z.enum(["presenter", "viewer"]);
export const venueEdgeScopeSchema = z.enum(["realtime:connect", "assets:read"]);

export const realtimeBootstrapCredentialInputSchema = z
  .object({
    sessionId: identifier,
    userId: identifier,
    role: realtimeParticipantRoleSchema,
    edgeId: identifier,
    assignmentEpoch: z.number().int().positive(),
    presentationId: identifier,
    presentationRevision: z.number().int().positive(),
    scopes: z
      .array(venueEdgeScopeSchema)
      .min(1)
      .max(2)
      .refine((scopes) => new Set(scopes).size === scopes.length),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type RealtimeBootstrapCredentialInput = z.infer<
  typeof realtimeBootstrapCredentialInputSchema
>;
