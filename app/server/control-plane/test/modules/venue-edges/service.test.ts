import { describe, expect, it } from "vitest";
import type {
  EdgeRegistration,
  VenueEdgeCredentialRecord,
  VenueEdgeRecord,
  VenueEdgeRepository,
} from "../../../src/modules/venue-edges/repository";
import { VenueEdgeError, VenueEdgeService } from "../../../src/modules/venue-edges/service";

class FakeRepository implements VenueEdgeRepository {
  edges = new Map<string, VenueEdgeRecord>();
  credentials = new Map<string, VenueEdgeCredentialRecord>();
  rejectRegistration = false;
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
    const value = await this.findCredential(edgeId, tokenId);
    if (value) value.lastUsedAt = usedAt;
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
    if (this.rejectRegistration) return false;
    Object.assign(edge, update, { registeredAt: update.observedAt, lastSeenAt: update.observedAt });
    return true;
  }
}

const setup = () => {
  const repository = new FakeRepository();
  let edge = 0;
  let token = 0;
  return {
    repository,
    service: new VenueEdgeService(
      repository,
      () => new Date("2026-08-20T00:00:00.000Z"),
      () => `edge-${++edge}`,
      () => ({ tokenId: `token-${++token}`, secret: new Uint8Array(32).fill(token) }),
    ),
  };
};

describe("VenueEdgeService", () => {
  it("returns a credential once while persisting only its token ID and hash", async () => {
    const { repository, service } = setup();
    const result = await service.provision(new Date("2026-08-21T00:00:00.000Z"));
    expect(result.token).toMatch(/^token-1\./);
    expect([...repository.credentials.values()][0]).toMatchObject({ tokenId: "token-1" });
    expect([...repository.credentials.values()][0]).not.toContain(result.token);
    expect(result.edge.runtimeId).toBeNull();
  });
  it("rejects short, expired, changed, and revoked credentials", async () => {
    const short = new VenueEdgeService(
      new FakeRepository(),
      () => new Date("2026-08-20T00:00:00.000Z"),
      () => "edge",
      () => ({ tokenId: "short", secret: new Uint8Array(31) }),
    );
    await expect(short.provision(new Date("2026-08-21T00:00:00.000Z"))).rejects.toThrow("256");
    const { repository, service } = setup();
    const value = await service.provision(new Date("2026-08-21T00:00:00.000Z"));
    [...repository.credentials.values()][0]!.expiresAt = "2026-08-19T00:00:00.000Z";
    await expect(service.authenticate(value.edge.id, value.token)).rejects.toMatchObject({
      code: "unauthorized",
    } satisfies Partial<VenueEdgeError>);
    const active = await service.provision(new Date("2026-08-21T00:00:00.000Z"));
    await expect(
      service.authenticate(active.edge.id, `${active.token}changed`),
    ).rejects.toMatchObject({ code: "unauthorized" } satisfies Partial<VenueEdgeError>);
    await service.revoke(active.edge.id);
    await expect(service.authenticate(active.edge.id, active.token)).rejects.toMatchObject({
      code: "unauthorized",
    } satisfies Partial<VenueEdgeError>);
  });
  it("supports rotation overlap and registration of a distinct runtime identity", async () => {
    const { repository, service } = setup();
    const value = await service.provision(new Date("2026-08-22T00:00:00.000Z"));
    const rotated = await service.rotate(
      value.edge.id,
      new Date("2026-08-23T00:00:00.000Z"),
      new Date("2026-08-21T00:00:00.000Z"),
    );
    await expect(service.authenticate(value.edge.id, rotated.token)).resolves.toMatchObject({
      id: value.edge.id,
    });
    await service.register(value.edge.id, {
      runtimeId: "runtime-1",
      runtimeVersion: "1",
      protocolVersion: "v1",
      capacity: 50,
      localEndpoint: "https://edge.local",
      certificateFingerprint: "fingerprint",
      health: "healthy",
    });
    expect(repository.edges.get(value.edge.id)).toMatchObject({
      runtimeId: "runtime-1",
      localEndpoint: "https://edge.local",
      health: "healthy",
    });
  });
  it("rejects expired provisioning and invalid rotation overlap", async () => {
    const { service } = setup();
    await expect(service.provision(new Date("2026-08-20T00:00:00.000Z"))).rejects.toMatchObject({
      code: "conflict",
    });
    const value = await service.provision(new Date("2026-08-22T00:00:00.000Z"));
    await expect(
      service.rotate(
        value.edge.id,
        new Date("2026-08-21T00:00:00.000Z"),
        new Date("2026-08-22T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("reports a runtime identity registration collision as a conflict", async () => {
    const { repository, service } = setup();
    const value = await service.provision(new Date("2026-08-22T00:00:00.000Z"));
    repository.rejectRegistration = true;

    await expect(
      service.register(value.edge.id, {
        runtimeId: "runtime-in-use",
        runtimeVersion: "1",
        protocolVersion: "v1",
        capacity: 50,
        localEndpoint: "https://edge.local",
        certificateFingerprint: "fingerprint",
        health: "healthy",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
