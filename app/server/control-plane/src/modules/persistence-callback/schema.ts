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
  runtimeId: runtimeIdentifier,
  runtimeKind: z.enum(["Cloud", "VenueEdge"]),
  assignmentEpoch: z.number().int().positive(),
  presentationRevision: z.number().int().positive(),
};
const participant = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(["presenter", "viewer"]),
});

export const checkpointInputSchema = z.object({
  sessionId: z.string().uuid(),
  ...assignment,
  version: z.number().int().nonnegative(),
  lastSequence: z.number().int().nonnegative(),
  idempotencyKey,
  payload: opaqueSnapshot,
});

export const completionInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    ...assignment,
    checkpointVersion: z.number().int().nonnegative(),
    lastSequence: z.number().int().nonnegative(),
    idempotencyKey,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    participantCount: z.number().int().min(1).max(50),
    participants: z.array(participant).min(1).max(50),
    finalCheckpoint: opaqueSnapshot,
  })
  .refine((value) => value.participantCount === value.participants.length, {
    path: ["participantCount"],
    message: "participantCount must match participants",
  })
  .refine((value) => Date.parse(value.endedAt) >= Date.parse(value.startedAt), {
    path: ["endedAt"],
    message: "endedAt must not precede startedAt",
  });

export type CheckpointInput = z.infer<typeof checkpointInputSchema>;
export type CompletionInput = z.infer<typeof completionInputSchema>;
