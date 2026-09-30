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
  assignmentEpoch: 1,
  certificateFingerprint: null,
  endpoint: "https://runtime.example.com",
  issuedAt: now.toISOString(),
  leaseExpiresAt: "2026-08-21T00:00:00.000Z",
  presentationRevision: 1,
  provisioningEdgeId: null,
  releasedAt: null,
  runtimeId: "runtime",
  runtimeKind: "Cloud",
  sessionId: "session",
};

const createRepository = (): RuntimeAssignmentRepository => ({
  assign: vi.fn(async () => assignment),
  findActive: vi.fn(async () => assignment),
  release: vi.fn(async () => true),
  releaseSession: vi.fn(async () => {}),
  renew: vi.fn(async () => assignment),
});

describe("RuntimeAssignmentService", () => {
  it("adds the current issuance time and returns repository results", async () => {
    const repository = createRepository();
    const service = new RuntimeAssignmentService(repository, () => now);

    await expect(
      service.assign({
        certificateFingerprint: null,
        endpoint: "https://runtime.example.com",
        leaseExpiresAt: "2026-08-20T00:01:00+00:00",
        presentationRevision: 1,
        provisioningEdgeId: null,
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        sessionId: "session",
      }),
    ).resolves.toEqual(assignment);
    expect(repository.assign).toHaveBeenCalledWith({
      certificateFingerprint: null,
      edgeHealthyAfter: "2026-08-19T23:59:00.000Z",
      endpoint: "https://runtime.example.com",
      issuedAt: now.toISOString(),
      leaseExpiresAt: "2026-08-20T00:01:00.000Z",
      presentationRevision: 1,
      provisioningEdgeId: null,
      runtimeId: "runtime",
      runtimeKind: "Cloud",
      sessionId: "session",
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
        certificateFingerprint: null,
        endpoint: "https://runtime.example.com",
        leaseExpiresAt: now.toISOString(),
        presentationRevision: 1,
        provisioningEdgeId: null,
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        sessionId: "session",
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    await expect(
      service.renew({
        assignmentEpoch: 1,
        leaseExpiresAt: now.toISOString(),
        provisioningEdgeId: "edge",
        sessionId: "session",
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
        assignmentEpoch: 1,
        leaseExpiresAt: "2026-08-20T00:05:00+00:00",
        provisioningEdgeId: "edge",
        sessionId: "session",
      }),
    ).resolves.toEqual(assignment);
    expect(repository.renew).toHaveBeenCalledWith({
      assignmentEpoch: 1,
      leaseExpiresAt: "2026-08-20T00:05:00.000Z",
      now: now.toISOString(),
      provisioningEdgeId: "edge",
      sessionId: "session",
    });
    await expect(
      service.renew({
        assignmentEpoch: 1,
        leaseExpiresAt: "2026-08-20T00:05:00.001Z",
        provisioningEdgeId: "edge",
        sessionId: "session",
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));

    await service.release({
      assignmentEpoch: 1,
      provisioningEdgeId: "edge",
      sessionId: "session",
    });
    expect(repository.release).toHaveBeenCalledWith({
      assignmentEpoch: 1,
      now: now.toISOString(),
      provisioningEdgeId: "edge",
      sessionId: "session",
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
        certificateFingerprint: null,
        endpoint: "https://runtime.example.com",
        leaseExpiresAt: assignment.leaseExpiresAt,
        presentationRevision: 1,
        provisioningEdgeId: null,
        runtimeId: "runtime",
        runtimeKind: "Cloud",
        sessionId: "session",
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    await expect(service.active("session")).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    await expect(
      service.renew({
        assignmentEpoch: 1,
        leaseExpiresAt: "2026-08-20T00:05:00.000Z",
        provisioningEdgeId: "edge",
        sessionId: "session",
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
    await expect(
      service.release({
        assignmentEpoch: 1,
        provisioningEdgeId: "edge",
        sessionId: "session",
      }),
    ).rejects.toEqual(new RuntimeAssignmentError("conflict"));
  });
});
