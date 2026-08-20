import { describe, expect, it } from "vitest";
import type {
  ActiveEdgeSessionAssignment,
  AssignmentRequest,
  EdgeRegistration,
  LeaseRequest,
  VenueEdgeCredentialRecord,
  VenueEdgeRecord,
  VenueEdgeRepository,
} from "../../../src/modules/venue-edges/repository";
import { VenueEdgeError, VenueEdgeService } from "../../../src/modules/venue-edges/service";

class FakeRepository implements VenueEdgeRepository {
  edges = new Map<string, VenueEdgeRecord>();
  credentials = new Map<string, VenueEdgeCredentialRecord>();
  assignments: AssignmentRequest[] = [];
  async createEdge(edge: VenueEdgeRecord, credential: VenueEdgeCredentialRecord) {
    this.edges.set(edge.id, edge);
    this.credentials.set(`${edge.id}:${credential.tokenId}`, credential);
  }
  async findEdge(id: string) {
    return this.edges.get(id) ?? null;
  }
  async findCredential(edgeId: string, tokenId: string) {
    return this.credentials.get(`${edgeId}:${tokenId}`) ?? null;
  }
  async touchCredential(edgeId: string, tokenId: string, usedAt: string) {
    const credential = await this.findCredential(edgeId, tokenId);
    if (credential) credential.lastUsedAt = usedAt;
  }
  async rotateCredential(input: {
    edgeId: string;
    previousExpiresAt: string;
    credential: VenueEdgeCredentialRecord;
  }) {
    if (!this.edges.has(input.edgeId)) return false;
    for (const value of this.credentials.values())
      if (value.edgeId === input.edgeId) value.expiresAt = input.previousExpiresAt;
    this.credentials.set(`${input.edgeId}:${input.credential.tokenId}`, input.credential);
    return true;
  }
  async revokeEdge(edgeId: string, revokedAt: string) {
    const edge = this.edges.get(edgeId);
    if (!edge || edge.status === "revoked") return false;
    edge.status = "revoked";
    edge.revokedAt = revokedAt;
    return true;
  }
  async register(edgeId: string, update: EdgeRegistration) {
    const edge = this.edges.get(edgeId);
    if (!edge || edge.status !== "active") return false;
    Object.assign(edge, update, { registeredAt: update.observedAt, lastSeenAt: update.observedAt });
    return true;
  }
  async assign(input: AssignmentRequest) {
    this.assignments.push(input);
    return { ...input, assignmentEpoch: this.assignments.length, releasedAt: null };
  }
  async renew(input: LeaseRequest) {
    return {
      sessionId: input.sessionId,
      edgeId: input.edgeId,
      assignmentEpoch: input.assignmentEpoch,
      presentationRevision: 1,
      issuedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt!,
      releasedAt: null,
    };
  }
  async release() {
    return true;
  }
  async findActiveAssignment(): Promise<ActiveEdgeSessionAssignment | null> {
    return null;
  }
}
const setup = () => {
  const repository = new FakeRepository();
  let edge = 0;
  let token = 0;
  const service = new VenueEdgeService(
    repository,
    () => new Date("2026-08-20T00:00:00.000Z"),
    () => `edge-${++edge}`,
    () => ({ tokenId: `token-${++token}`, secret: new Uint8Array(32).fill(token) }),
  );
  return { repository, service };
};

describe("VenueEdgeService", () => {
  it("returns a 256-bit credential once while persisting only its token ID and hash", async () => {
    const { repository, service } = setup();
    const result = await service.provision(new Date("2026-08-21T00:00:00.000Z"));
    expect(result.token).toMatch(/^token-1\./);
    expect([...repository.credentials.values()][0]).toMatchObject({ tokenId: "token-1" });
    expect([...repository.credentials.values()][0]).not.toContain(result.token);
  });
  it("rejects short credentials and rejects expired, revoked, and changed tokens", async () => {
    const { repository, service } = setup();
    const short = new VenueEdgeService(
      new FakeRepository(),
      () => new Date("2026-08-20T00:00:00.000Z"),
      () => "edge",
      () => ({ tokenId: "short", secret: new Uint8Array(31) }),
    );
    await expect(short.provision(new Date("2026-08-21T00:00:00.000Z"))).rejects.toThrow("256");
    const provisioned = await service.provision(new Date("2026-08-21T00:00:00.000Z"));
    const credential = [...repository.credentials.values()].find(
      (value) => value.edgeId === provisioned.edge.id,
    );
    expect(credential).toBeDefined();
    credential!.expiresAt = "2026-08-19T00:00:00.000Z";
    await expect(
      service.authenticate(provisioned.edge.id, provisioned.token),
    ).rejects.toMatchObject({ code: "unauthorized" } satisfies Partial<VenueEdgeError>);
    const active = await service.provision(new Date("2026-08-21T00:00:00.000Z"));
    await expect(
      service.authenticate(active.edge.id, `${active.token}changed`),
    ).rejects.toMatchObject({ code: "unauthorized" } satisfies Partial<VenueEdgeError>);
    await service.revoke(active.edge.id);
    await expect(service.authenticate(active.edge.id, active.token)).rejects.toMatchObject({
      code: "unauthorized",
    } satisfies Partial<VenueEdgeError>);
  });
  it("supports bounded rotation overlap and registration metadata", async () => {
    const { repository, service } = setup();
    const provisioned = await service.provision(new Date("2026-08-22T00:00:00.000Z"));
    const rotated = await service.rotate(
      provisioned.edge.id,
      new Date("2026-08-23T00:00:00.000Z"),
      new Date("2026-08-21T00:00:00.000Z"),
    );
    await expect(service.authenticate(provisioned.edge.id, rotated.token)).resolves.toMatchObject({
      id: provisioned.edge.id,
    });
    await service.register(provisioned.edge.id, {
      runtimeVersion: "1",
      protocolVersion: "v1",
      capacity: 50,
      localEndpoint: "https://edge.local",
      certificateFingerprint: "fingerprint",
      health: "healthy",
    });
    expect(repository.edges.get(provisioned.edge.id)).toMatchObject({
      localEndpoint: "https://edge.local",
      health: "healthy",
    });
  });
  it("rejects credentials, rotation overlap, and assignments that are already expired", async () => {
    const { service } = setup();
    await expect(service.provision(new Date("2026-08-20T00:00:00.000Z"))).rejects.toMatchObject({
      code: "conflict",
    });
    const provisioned = await service.provision(new Date("2026-08-22T00:00:00.000Z"));
    await expect(
      service.rotate(
        provisioned.edge.id,
        new Date("2026-08-21T00:00:00.000Z"),
        new Date("2026-08-22T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.assign({
        sessionId: "session-1",
        edgeId: provisioned.edge.id,
        presentationRevision: 1,
        leaseExpiresAt: "2026-08-20T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
