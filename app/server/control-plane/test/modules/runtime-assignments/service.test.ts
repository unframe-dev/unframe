import { describe, expect, it, vi } from "vitest";

import type {
  RuntimeAssignment,
  RuntimeAssignmentRepository,
} from "../../../src/modules/runtime-assignments/repository";
import {
  RuntimeAssignmentError,
  RuntimeAssignmentService,
} from "../../../src/modules/runtime-assignments/service";

const now = new Date("2026-08-20T00:00:00.000Z");
const assignment: RuntimeAssignment = {
  sessionId: "session",
  runtimeId: "runtime",
  runtimeKind: "Cloud",
  endpoint: "https://runtime.example.com",
  certificateFingerprint: null,
  provisioningEdgeId: null,
  assignmentEpoch: 1,
  presentationRevision: 1,
  issuedAt: now.toISOString(),
  leaseExpiresAt: "2026-08-21T00:00:00.000Z",
  releasedAt: null,
};

const createRepository = (): RuntimeAssignmentRepository => ({
  assign: vi.fn(async () => assignment),
  findActive: vi.fn(async () => assignment),
  renew: vi.fn(async () => assignment),
  release: vi.fn(async () => true),
  releaseSession: vi.fn(async () => {}),
});

describe("RuntimeAssignmentService", () => {
  it("adds the current issuance time and returns repository results", async () => {
    const repository = createRepository();
    const service = new RuntimeAssignmentService(repository, () => now);

    await expect(
      service.assign({
        sessionId: "session",
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        endpoint: "https://runtime.example.com",
        certificateFingerprint: null,
        provisioningEdgeId: null,
        presentationRevision: 1,
        leaseExpiresAt: "2026-08-20T00:01:00+00:00",
      }),
    ).resolves.toEqual(assignment);
    expect(repository.assign).toHaveBeenCalledWith({
      sessionId: "session",
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      endpoint: "https://runtime.example.com",
      certificateFingerprint: null,
      provisioningEdgeId: null,
      presentationRevision: 1,
      issuedAt: now.toISOString(),
      leaseExpiresAt: "2026-08-20T00:01:00.000Z",
      edgeHealthyAfter: "2026-08-19T23:59:00.000Z",
    });

    await expect(service.active("session")).resolves.toEqual(assignment);
    expect(repository.findActive).toHaveBeenCalledWith(
      "session",
      now.toISOString(),
      "2026-08-19T23:59:00.000Z",
    );
  });

  it("rejects assignment and renewal leases that do not extend beyond now", async () => {
    const repository = createRepository();
    const service = new RuntimeAssignmentService(repository, () => now);

    await expect(
      service.assign({
        sessionId: "session",
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        endpoint: "https://runtime.example.com",
        certificateFingerprint: null,
        provisioningEdgeId: null,
        presentationRevision: 1,
        leaseExpiresAt: now.toISOString(),
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    await expect(
      service.renew({
        sessionId: "session",
        provisioningEdgeId: "edge",
        assignmentEpoch: 1,
        leaseExpiresAt: now.toISOString(),
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    expect(repository.assign).not.toHaveBeenCalled();
    expect(repository.renew).not.toHaveBeenCalled();
  });

  it("canonicalizes and bounds Venue Edge lease renewal", async () => {
    const repository = createRepository();
    const service = new RuntimeAssignmentService(repository, () => now);

    await expect(
      service.renew({
        sessionId: "session",
        provisioningEdgeId: "edge",
        assignmentEpoch: 1,
        leaseExpiresAt: "2026-08-20T00:05:00+00:00",
      }),
    ).resolves.toEqual(assignment);
    expect(repository.renew).toHaveBeenCalledWith({
      sessionId: "session",
      provisioningEdgeId: "edge",
      assignmentEpoch: 1,
      now: now.toISOString(),
      leaseExpiresAt: "2026-08-20T00:05:00.000Z",
    });
    await expect(
      service.renew({
        sessionId: "session",
        provisioningEdgeId: "edge",
        assignmentEpoch: 1,
        leaseExpiresAt: "2026-08-20T00:05:00.001Z",
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));

    await service.release({
      sessionId: "session",
      provisioningEdgeId: "edge",
      assignmentEpoch: 1,
    });
    expect(repository.release).toHaveBeenCalledWith({
      sessionId: "session",
      provisioningEdgeId: "edge",
      assignmentEpoch: 1,
      now: now.toISOString(),
    });

    await service.releaseSession("session");
    expect(repository.releaseSession).toHaveBeenCalledWith("session", now.toISOString());
  });

  it("maps repository fencing failures to conflicts", async () => {
    const repository = createRepository();
    vi.mocked(repository.assign).mockResolvedValue(null);
    vi.mocked(repository.findActive).mockResolvedValue(null);
    vi.mocked(repository.renew).mockResolvedValue(null);
    vi.mocked(repository.release).mockResolvedValue(false);
    const service = new RuntimeAssignmentService(repository, () => now);

    await expect(
      service.assign({
        sessionId: "session",
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        endpoint: "https://runtime.example.com",
        certificateFingerprint: null,
        provisioningEdgeId: null,
        presentationRevision: 1,
        leaseExpiresAt: assignment.leaseExpiresAt,
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    await expect(service.active("session")).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    await expect(
      service.renew({
        sessionId: "session",
        provisioningEdgeId: "edge",
        assignmentEpoch: 1,
        leaseExpiresAt: "2026-08-20T00:05:00.000Z",
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    await expect(
      service.release({
        sessionId: "session",
        provisioningEdgeId: "edge",
        assignmentEpoch: 1,
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
  });
});
