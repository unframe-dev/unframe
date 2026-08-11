import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const realtimeParticipantRoleSchema = z.enum(["presenter", "viewer"]);

export const realtimeBootstrapCredentialInputSchema = z
  .object({
    sessionId: identifier,
    userId: identifier,
    role: realtimeParticipantRoleSchema,
  })
  .strict();

export type RealtimeBootstrapCredentialInput = z.infer<
  typeof realtimeBootstrapCredentialInputSchema
>;
