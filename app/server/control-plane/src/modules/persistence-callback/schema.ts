import { z } from "zod";

const idempotencyKey = z.string().trim().min(1).max(200);
const runtimeIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const opaqueSnapshot = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
const assignment = {
  assignmentEpoch: z.number().int().positive(),
  presentationRevision: z.number().int().positive(),
  runtimeId: runtimeIdentifier,
  runtimeKind: z.enum(["Cloud", "VenueEdge"]),
};
const participant = z.object({
  role: z.enum(["presenter", "viewer"]),
  userId: z.string().trim().min(1),
});

export const checkpointInputSchema = z.object({
  sessionId: z.string().uuid(),
  ...assignment,
  idempotencyKey,
  lastSequence: z.number().int().nonnegative(),
  payload: opaqueSnapshot,
  version: z.number().int().nonnegative(),
});

export const completionInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    ...assignment,
    checkpointVersion: z.number().int().nonnegative(),
    endedAt: z.string().datetime(),
    finalCheckpoint: opaqueSnapshot,
    idempotencyKey,
    lastSequence: z.number().int().nonnegative(),
    participantCount: z.number().int().min(1).max(50),
    participants: z.array(participant).min(1).max(50),
    startedAt: z.string().datetime(),
  })
  .refine((value) => value.participantCount === value.participants.length, {
    message: "participantCount must match participants",
    path: ["participantCount"],
  })
  .refine((value) => Date.parse(value.endedAt) >= Date.parse(value.startedAt), {
    message: "endedAt must not precede startedAt",
    path: ["endedAt"],
  });

export type CheckpointInput = z.infer<typeof checkpointInputSchema>;
export type CompletionInput = z.infer<typeof completionInputSchema>;
