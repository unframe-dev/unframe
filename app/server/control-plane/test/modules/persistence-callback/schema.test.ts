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
        version: 2,
        lastSequence: 10,
        idempotencyKey: "checkpoint-2",
        payload: { page: 3 },
      }),
    ).toMatchObject({ version: 2, lastSequence: 10 });
  });

  it("rejects inconsistent completion summaries", () => {
    const completion = {
      sessionId: crypto.randomUUID(),
      edgeId: crypto.randomUUID(),
      assignmentEpoch: 1,
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
        edgeId: crypto.randomUUID(),
        assignmentEpoch: 1,
      }).success,
    ).toBe(true);
  });
});
