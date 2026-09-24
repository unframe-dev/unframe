import { describe, expect, it } from "vitest";

import {
  PersistenceCallbackError,
  PersistenceCallbackService,
  type PersistenceCallbackRepository,
} from "../../../src/modules/persistence-callback/service";

const checkpoint = {
  sessionId: "session",
  runtimeId: "runtime",
  runtimeKind: "Cloud" as const,
  assignmentEpoch: 1,
  presentationRevision: 1,
  version: 1,
  lastSequence: 10,
  payload: { page: 1 },
  idempotencyKey: "shared-key",
};
const completion = {
  sessionId: "session",
  runtimeId: "runtime",
  runtimeKind: "Cloud" as const,
  assignmentEpoch: 1,
  presentationRevision: 1,
  checkpointVersion: 1,
  lastSequence: 10,
  idempotencyKey: "shared-key",
  startedAt: "2026-08-11T00:00:00.000Z",
  endedAt: "2026-08-11T00:10:00.000Z",
  participantCount: 1,
  participants: [{ userId: "presenter", role: "presenter" as const }],
  finalCheckpoint: { page: 1 },
};

describe("PersistenceCallbackService", () => {
  it("keeps checkpoint and completion idempotency independent", async () => {
    const applied = new Set<string>();
    const repository: PersistenceCallbackRepository = {
      applyCheckpoint: async (value) => {
        const key = `checkpoint:${value.idempotencyKey}`;
        if (applied.has(key)) return "duplicate";
        applied.add(key);
        return "applied";
      },
      applyCompletion: async (value) => {
        const key = `completion:${value.idempotencyKey}`;
        if (applied.has(key)) return "duplicate";
        applied.add(key);
        return "applied";
      },
    };
    const service = new PersistenceCallbackService(repository);

    await expect(service.checkpoint(checkpoint)).resolves.toEqual({ applied: true });
    await expect(service.checkpoint(checkpoint)).resolves.toEqual({ applied: false });
    await expect(service.complete(completion)).resolves.toEqual({ applied: true });
    await expect(service.complete(completion)).resolves.toEqual({ applied: false });
  });

  it("maps an unknown session to not_found", async () => {
    const repository: PersistenceCallbackRepository = {
      applyCheckpoint: async () => "not_found",
      applyCompletion: async () => "not_found",
    };
    const service = new PersistenceCallbackService(repository);

    await expect(service.checkpoint(checkpoint)).rejects.toEqual(
      new PersistenceCallbackError("not_found"),
    );
  });

  it("maps a superseded completion assignment to conflict", async () => {
    const repository: PersistenceCallbackRepository = {
      applyCheckpoint: async () => "applied",
      applyCompletion: async () => "conflict",
    };

    await expect(new PersistenceCallbackService(repository).complete(completion)).rejects.toEqual(
      new PersistenceCallbackError("conflict"),
    );
  });
});
