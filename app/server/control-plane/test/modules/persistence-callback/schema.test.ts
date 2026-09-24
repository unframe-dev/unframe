import { describe, expect, it } from "vitest";

import {
  completionInputSchema,
  checkpointInputSchema,
} from "../../../src/modules/persistence-callback/schema";

describe("persistence callback schemas", () => {
  it("accepts bounded checkpoint metadata", () => {
    expect(
      checkpointInputSchema.parse({
        sessionId: crypto.randomUUID(),
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        assignmentEpoch: 1,
        presentationRevision: 1,
        version: 2,
        lastSequence: 10,
        idempotencyKey: "checkpoint-2",
        payload: { page: 3 },
      }),
    ).toMatchObject({ version: 2, lastSequence: 10 });
  });

  it("requires an opaque JSON snapshot without defining its object shape", () => {
    const checkpoint = {
      sessionId: crypto.randomUUID(),
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      assignmentEpoch: 1,
      presentationRevision: 1,
      version: 2,
      lastSequence: 10,
      idempotencyKey: "checkpoint-2",
    } as const;

    expect(checkpointInputSchema.safeParse(checkpoint).success).toBe(false);
    expect(checkpointInputSchema.safeParse({ ...checkpoint, payload: ["opaque", 1] }).success).toBe(
      true,
    );
  });

  it("rejects inconsistent completion summaries", () => {
    const completion = {
      sessionId: crypto.randomUUID(),
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      assignmentEpoch: 1,
      presentationRevision: 1,
      checkpointVersion: 2,
      lastSequence: 10,
      idempotencyKey: "completion-2",
      startedAt: "2026-08-11T00:00:00.000Z",
      endedAt: "2026-08-10T00:00:00.000Z",
      participantCount: 2,
      participants: [{ userId: "viewer", role: "viewer" }],
      finalCheckpoint: {},
    };

    expect(completionInputSchema.safeParse(completion).success).toBe(false);
    expect(
      completionInputSchema.safeParse({
        ...completion,
        endedAt: "2026-08-12T00:00:00.000Z",
        participantCount: 51,
        participants: Array.from({ length: 51 }, (_, index) => ({
          userId: `viewer-${index}`,
          role: "viewer",
        })),
      }).success,
    ).toBe(false);
    const { finalCheckpoint: _, ...withoutFinalCheckpoint } = completion;
    expect(completionInputSchema.safeParse(withoutFinalCheckpoint).success).toBe(false);
  });

  it("requires the assignment identity used to fence completion", () => {
    const completion = {
      sessionId: crypto.randomUUID(),
      checkpointVersion: 2,
      lastSequence: 10,
      idempotencyKey: "completion-2",
      startedAt: "2026-08-11T00:00:00.000Z",
      endedAt: "2026-08-11T00:01:00.000Z",
      participantCount: 1,
      participants: [{ userId: "presenter", role: "presenter" }],
      finalCheckpoint: {},
    };

    expect(completionInputSchema.safeParse(completion).success).toBe(false);
    expect(
      completionInputSchema.safeParse({
        ...completion,
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        assignmentEpoch: 1,
        presentationRevision: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects invalid runtime identifiers at the callback boundary", () => {
    const input = {
      sessionId: crypto.randomUUID(),
      runtimeId: "invalid runtime id",
      runtimeKind: "Cloud",
      assignmentEpoch: 1,
      presentationRevision: 1,
      version: 1,
      lastSequence: 1,
      idempotencyKey: "checkpoint-1",
      payload: {},
    };

    expect(checkpointInputSchema.safeParse(input).success).toBe(false);
    expect(checkpointInputSchema.safeParse({ ...input, runtimeId: "a".repeat(129) }).success).toBe(
      false,
    );
  });
});
