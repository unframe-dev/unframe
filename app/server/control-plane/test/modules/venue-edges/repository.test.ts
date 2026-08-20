import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { D1VenueEdgeRepository } from "../../../src/modules/venue-edges/repository";

const edge = (id: string) => ({
  id,
  status: "active" as const,
  runtimeVersion: null,
  protocolVersion: null,
  capacity: null,
  localEndpoint: null,
  certificateFingerprint: null,
  health: null,
  registeredAt: null,
  lastSeenAt: "2026-08-20T00:00:00.000Z",
  createdAt: "2026-08-20T00:00:00.000Z",
  revokedAt: null,
});
const credential = (edgeId: string, tokenId = "token") => ({
  edgeId,
  tokenId,
  tokenHash: "hash",
  status: "active" as const,
  createdAt: "2026-08-20T00:00:00.000Z",
  expiresAt: "2026-08-21T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
});
const edgeHealthyAfter = "2026-08-19T23:59:00.000Z";
const registerEdge = (repository: D1VenueEdgeRepository, edgeId: string) =>
  repository.register(edgeId, {
    runtimeVersion: "1.0.0",
    protocolVersion: "v1",
    capacity: 50,
    localEndpoint: "https://edge.local",
    certificateFingerprint: "sha256:abc",
    health: "healthy",
    observedAt: "2026-08-20T00:00:00.000Z",
  });
const addSession = async (id: string) => {
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'User', ?, 1, '2026-01-01', '2026-01-01')",
  )
    .bind(`user-${id}`, `${id}@example.test`)
    .run();
  await env.DB.prepare(
    "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{\"groups\":[],\"assets\":[]}', '2026-01-01', '2026-01-01')",
  )
    .bind(`presentation-${id}`, `user-${id}`)
    .run();
  await env.DB.prepare(
    "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES (?, ?, ?, ?, 'Waiting', 1, 50, '2026-01-01')",
  )
    .bind(id, `presentation-${id}`, `user-${id}`, `code-${id}`)
    .run();
};

describe("D1VenueEdgeRepository", () => {
  it("persists non-secret credential material and registration state", async () => {
    const suffix = crypto.randomUUID();
    const repository = new D1VenueEdgeRepository(env.DB);
    const value = edge(`edge-${suffix}`);
    await repository.createEdge(value, credential(value.id));
    await repository.register(value.id, {
      runtimeVersion: "1.0.0",
      protocolVersion: "v1",
      capacity: 50,
      localEndpoint: "https://edge.local",
      certificateFingerprint: "sha256:abc",
      health: "healthy",
      observedAt: "2026-08-20T00:01:00.000Z",
    });
    await expect(repository.findCredential(value.id, "token")).resolves.toMatchObject({
      tokenHash: "hash",
    });
    await expect(repository.findEdge(value.id)).resolves.toMatchObject({
      capacity: 50,
      localEndpoint: "https://edge.local",
      certificateFingerprint: "sha256:abc",
    });
  });
  it("fences assignment by a live lease and increments epochs only after release or expiry", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = `session-${suffix}`;
    const repository = new D1VenueEdgeRepository(env.DB);
    await addSession(sessionId);
    const first = edge(`edge-a-${suffix}`);
    const second = edge(`edge-b-${suffix}`);
    await repository.createEdge(first, credential(first.id));
    await repository.createEdge(second, credential(second.id));
    const input = {
      sessionId,
      presentationRevision: 1,
      issuedAt: "2026-08-20T00:00:00.000Z",
      leaseExpiresAt: "2026-08-20T01:00:00.000Z",
      edgeHealthyAfter,
    };
    await expect(repository.assign({ ...input, edgeId: first.id })).resolves.toBeNull();
    await Promise.all([registerEdge(repository, first.id), registerEdge(repository, second.id)]);
    await expect(
      repository.assign({ ...input, edgeId: first.id, presentationRevision: 2 }),
    ).resolves.toBeNull();
    await expect(repository.assign({ ...input, edgeId: first.id })).resolves.toMatchObject({
      assignmentEpoch: 1,
    });
    await expect(repository.assign({ ...input, edgeId: second.id })).resolves.toBeNull();
    await expect(
      repository.release({
        sessionId,
        edgeId: first.id,
        assignmentEpoch: 1,
        now: "2026-08-20T00:10:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.assign({ ...input, edgeId: second.id, issuedAt: "2026-08-20T00:10:00.000Z" }),
    ).resolves.toMatchObject({ assignmentEpoch: 2 });
  });
  it("keeps one Venue Edge authoritative for at most one active room", async () => {
    const suffix = crypto.randomUUID();
    const firstSessionId = `session-a-${suffix}`;
    const secondSessionId = `session-b-${suffix}`;
    const repository = new D1VenueEdgeRepository(env.DB);
    await Promise.all([addSession(firstSessionId), addSession(secondSessionId)]);
    const value = edge(`edge-${suffix}`);
    await repository.createEdge(value, credential(value.id));
    await registerEdge(repository, value.id);
    const assignment = {
      edgeId: value.id,
      presentationRevision: 1,
      issuedAt: "2026-08-20T00:00:00.000Z",
      leaseExpiresAt: "2026-08-20T01:00:00.000Z",
      edgeHealthyAfter,
    };

    await expect(
      repository.assign({ ...assignment, sessionId: firstSessionId }),
    ).resolves.toMatchObject({ assignmentEpoch: 1 });
    await expect(
      repository.assign({ ...assignment, sessionId: secondSessionId }),
    ).resolves.toBeNull();
  });
  it("only assigns a healthy Edge using the current protocol", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = `session-${suffix}`;
    const repository = new D1VenueEdgeRepository(env.DB);
    await addSession(sessionId);
    const value = edge(`edge-${suffix}`);
    await repository.createEdge(value, credential(value.id));
    await repository.register(value.id, {
      runtimeVersion: "1.0.0",
      protocolVersion: "v0",
      capacity: 50,
      localEndpoint: "https://edge.local",
      certificateFingerprint: "sha256:abc",
      health: "unhealthy",
      observedAt: "2026-08-20T00:00:00.000Z",
    });

    await expect(
      repository.assign({
        sessionId,
        edgeId: value.id,
        presentationRevision: 1,
        issuedAt: "2026-08-20T00:00:00.000Z",
        leaseExpiresAt: "2026-08-20T01:00:00.000Z",
        edgeHealthyAfter,
      }),
    ).resolves.toBeNull();
  });
  it("does not assign or expose an Edge whose health observation is stale", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = `session-${suffix}`;
    const repository = new D1VenueEdgeRepository(env.DB);
    await addSession(sessionId);
    const value = edge(`edge-${suffix}`);
    await repository.createEdge(value, credential(value.id));
    await registerEdge(repository, value.id);

    await expect(
      repository.assign({
        sessionId,
        edgeId: value.id,
        presentationRevision: 1,
        issuedAt: "2026-08-20T00:02:00.000Z",
        leaseExpiresAt: "2026-08-20T01:00:00.000Z",
        edgeHealthyAfter: "2026-08-20T00:01:00.000Z",
      }),
    ).resolves.toBeNull();

    await repository.register(value.id, {
      runtimeVersion: "1.0.0",
      protocolVersion: "v1",
      capacity: 50,
      localEndpoint: "https://edge.local",
      certificateFingerprint: "sha256:abc",
      health: "healthy",
      observedAt: "2026-08-20T00:02:00.000Z",
    });
    await expect(
      repository.assign({
        sessionId,
        edgeId: value.id,
        presentationRevision: 1,
        issuedAt: "2026-08-20T00:02:00.000Z",
        leaseExpiresAt: "2026-08-20T01:00:00.000Z",
        edgeHealthyAfter: "2026-08-20T00:01:00.000Z",
      }),
    ).resolves.toMatchObject({ assignmentEpoch: 1 });
    await expect(
      repository.findActiveAssignment(
        sessionId,
        "2026-08-20T00:04:00.000Z",
        "2026-08-20T00:03:00.000Z",
      ),
    ).resolves.toBeNull();
  });
  it("requires exact edge and epoch to renew or release, and revocation releases leases", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = `session-${suffix}`;
    const repository = new D1VenueEdgeRepository(env.DB);
    await addSession(sessionId);
    const value = edge(`edge-${suffix}`);
    await repository.createEdge(value, credential(value.id));
    await registerEdge(repository, value.id);
    const assigned = await repository.assign({
      sessionId,
      edgeId: value.id,
      presentationRevision: 1,
      issuedAt: "2026-08-20T00:00:00.000Z",
      leaseExpiresAt: "2026-08-20T01:00:00.000Z",
      edgeHealthyAfter,
    });
    if (!assigned) throw new Error("assignment failed");
    await expect(
      repository.renew({
        sessionId,
        edgeId: value.id,
        assignmentEpoch: assigned.assignmentEpoch,
        now: "2026-08-20T00:01:00.000Z",
        leaseExpiresAt: "2026-08-20T01:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.renew({
        sessionId,
        edgeId: "wrong",
        assignmentEpoch: assigned.assignmentEpoch,
        now: "2026-08-20T00:01:00.000Z",
        leaseExpiresAt: "2026-08-20T02:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await repository.register(value.id, {
      runtimeVersion: "1.0.0",
      protocolVersion: "v1",
      capacity: 50,
      localEndpoint: "https://edge.local",
      certificateFingerprint: "sha256:abc",
      health: "unhealthy",
      observedAt: "2026-08-20T00:02:00.000Z",
    });
    await expect(
      repository.renew({
        sessionId,
        edgeId: value.id,
        assignmentEpoch: assigned.assignmentEpoch,
        now: "2026-08-20T00:02:00.000Z",
        leaseExpiresAt: "2026-08-20T02:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(repository.revokeEdge(value.id, "2026-08-20T00:02:00.000Z")).resolves.toBe(true);
    await expect(
      repository.renew({
        sessionId,
        edgeId: value.id,
        assignmentEpoch: assigned.assignmentEpoch,
        now: "2026-08-20T00:03:00.000Z",
        leaseExpiresAt: "2026-08-20T02:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });
  it("does not expose or renew an assignment after its session ends", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = `session-${suffix}`;
    const repository = new D1VenueEdgeRepository(env.DB);
    await addSession(sessionId);
    const value = edge(`edge-${suffix}`);
    await repository.createEdge(value, credential(value.id));
    await registerEdge(repository, value.id);
    const assigned = await repository.assign({
      sessionId,
      edgeId: value.id,
      presentationRevision: 1,
      issuedAt: "2026-08-20T00:00:00.000Z",
      leaseExpiresAt: "2026-08-20T01:00:00.000Z",
      edgeHealthyAfter,
    });
    if (!assigned) throw new Error("assignment failed");
    await env.DB.prepare("UPDATE presentation_sessions SET state = 'Ended' WHERE id = ?")
      .bind(sessionId)
      .run();

    await expect(
      repository.renew({
        sessionId,
        edgeId: value.id,
        assignmentEpoch: assigned.assignmentEpoch,
        now: "2026-08-20T00:10:00.000Z",
        leaseExpiresAt: "2026-08-20T02:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.findActiveAssignment(
        sessionId,
        "2026-08-20T00:10:00.000Z",
        "2026-08-20T00:09:00.000Z",
      ),
    ).resolves.toBeNull();
  });
});
