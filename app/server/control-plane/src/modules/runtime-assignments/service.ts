import type { AssignmentRequest, LeaseRequest, RuntimeAssignmentRepository } from "./repository";

const maximumRenewedLeaseDurationMs = 5 * 60 * 1000;
const maximumEdgeHeartbeatAgeMs = 60 * 1000;

export class RuntimeAssignmentError extends Error {
  constructor(readonly code: "conflict") {
    super(code);
  }
}

export class RuntimeAssignmentService {
  constructor(
    private readonly repository: RuntimeAssignmentRepository,
    private readonly now: () => Date,
  ) {}
  async assign(input: Omit<AssignmentRequest, "issuedAt" | "edgeHealthyAfter">) {
    const now = this.now();
    const leaseExpiresAt = canonicalFutureLeaseExpiry(input.leaseExpiresAt, now);
    const result = await this.repository.assign({
      ...input,
      issuedAt: now.toISOString(),
      leaseExpiresAt,
      edgeHealthyAfter: new Date(now.getTime() - maximumEdgeHeartbeatAgeMs).toISOString(),
    });
    if (!result) throw new RuntimeAssignmentError("conflict");
    return result;
  }
  async active(sessionId: string) {
    const now = this.now();
    const result = await this.repository.findActive(
      sessionId,
      now.toISOString(),
      new Date(now.getTime() - maximumEdgeHeartbeatAgeMs).toISOString(),
    );
    if (!result) throw new RuntimeAssignmentError("conflict");
    return result;
  }
  async renew(input: Omit<LeaseRequest, "now"> & { leaseExpiresAt: string }) {
    const now = this.now();
    const leaseExpiresAt = canonicalFutureLeaseExpiry(input.leaseExpiresAt, now);
    if (new Date(leaseExpiresAt).getTime() - now.getTime() > maximumRenewedLeaseDurationMs) {
      throw new RuntimeAssignmentError("conflict");
    }
    const result = await this.repository.renew({
      ...input,
      now: now.toISOString(),
      leaseExpiresAt,
    });
    if (!result) throw new RuntimeAssignmentError("conflict");
    return result;
  }
  async release(input: Omit<LeaseRequest, "now">) {
    if (!(await this.repository.release({ ...input, now: this.now().toISOString() })))
      throw new RuntimeAssignmentError("conflict");
  }
  async releaseSession(sessionId: string) {
    await this.repository.releaseSession(sessionId, this.now().toISOString());
  }
}

const canonicalFutureLeaseExpiry = (value: string, reference: Date) => {
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime()) || candidate <= reference) {
    throw new RuntimeAssignmentError("conflict");
  }
  return candidate.toISOString();
};
