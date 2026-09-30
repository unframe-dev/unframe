import { describe, expect, it } from "vitest";

import {
  completionInputSchema,
  checkpointInputSchema,
} from "../../../src/modules/persistence-callback/schema";

describe("persistence callback schemas", () => {
  it("accepts bounded checkpoint metadata", () => {
    expect(
      checkpointInputSchema.parse({
        assignmentEpoch: 1,
        idempotencyKey: "checkpoint-2",
        lastSequence: 10,
        payload: { page: 3 },
        presentationRevision: 1,
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        sessionId: crypto.randomUUID(),
        version: 2,
      }),
    ).toMatchObject({ lastSequence: 10, version: 2 });
  });

  it("requires an opaque JSON snapshot without defining its object shape", () => {
    const checkpoint = {
      assignmentEpoch: 1,
      idempotencyKey: "checkpoint-2",
      lastSequence: 10,
      presentationRevision: 1,
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      sessionId: crypto.randomUUID(),
      version: 2,
    } as const;

    expect(checkpointInputSchema.safeParse(checkpoint).success).toBe(false);
    expect(checkpointInputSchema.safeParse({ ...checkpoint, payload: ["opaque", 1] }).success).toBe(
      true,
    );
  });

  it("rejects inconsistent completion summaries", () => {
    const completion = {
      assignmentEpoch: 1,
      checkpointVersion: 2,
      endedAt: "2026-08-10T00:00:00.000Z",
      finalCheckpoint: {},
      idempotencyKey: "completion-2",
      lastSequence: 10,
      participantCount: 2,
      participants: [{ role: "viewer", userId: "viewer" }],
      presentationRevision: 1,
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      sessionId: crypto.randomUUID(),
      startedAt: "2026-08-11T00:00:00.000Z",
    };

    expect(completionInputSchema.safeParse(completion).success).toBe(false);
    expect(
      completionInputSchema.safeParse({
        ...completion,
        endedAt: "2026-08-12T00:00:00.000Z",
        participantCount: 51,
        participants: Array.from({ length: 51 }, (_, index) => ({
          role: "viewer",
          userId: `viewer-${index}`,
        })),
      }).success,
    ).toBe(false);
    const { finalCheckpoint: _, ...withoutFinalCheckpoint } = completion;
    expect(completionInputSchema.safeParse(withoutFinalCheckpoint).success).toBe(false);
  });

  it("requires the assignment identity used to fence completion", () => {
    const completion = {
      checkpointVersion: 2,
      endedAt: "2026-08-11T00:01:00.000Z",
      finalCheckpoint: {},
      idempotencyKey: "completion-2",
      lastSequence: 10,
      participantCount: 1,
      participants: [{ role: "presenter", userId: "presenter" }],
      sessionId: crypto.randomUUID(),
      startedAt: "2026-08-11T00:00:00.000Z",
    };

    expect(completionInputSchema.safeParse(completion).success).toBe(false);
    expect(
      completionInputSchema.safeParse({
        ...completion,
        assignmentEpoch: 1,
        presentationRevision: 1,
        runtimeId: "runtime",
        runtimeKind: "Cloud",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid runtime identifiers at the callback boundary", () => {
    const input = {
      assignmentEpoch: 1,
      idempotencyKey: "checkpoint-1",
      lastSequence: 1,
      payload: {},
      presentationRevision: 1,
      runtimeId: "invalid runtime id",
      runtimeKind: "Cloud",
      sessionId: crypto.randomUUID(),
      version: 1,
    };

    expect(checkpointInputSchema.safeParse(input).success).toBe(false);
    expect(checkpointInputSchema.safeParse({ ...input, runtimeId: "a".repeat(129) }).success).toBe(
      false,
    );
  });
});
