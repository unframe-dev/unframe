import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { D1RuntimeAssignmentRepository } from "../../../src/modules/runtime-assignments/repository";

const addSession = async (suffix: string, state: "Waiting" | "Ended" = "Waiting") => {
  const userId = `user-${suffix}`;
  const presentationId = `presentation-${suffix}`;
  const sessionId = `session-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'User', ?, 1, '2026', '2026')",
    ).bind(userId, `${userId}@example.test`),
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, ?, '2026', '2026')",
    ).bind(presentationId, userId, '{"groups":[],"assets":[]}'),
    env.DB.prepare(
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES (?, ?, ?, ?, ?, 1, 50, '2026')",
    ).bind(sessionId, presentationId, userId, `hash-${suffix}`, state),
  ]);
  return sessionId;
};

const cloudAssignment = (
  sessionId: string,
  runtimeId: string,
  issuedAt = "2026-08-20T00:00:00.000Z",
) => ({
  sessionId,
  runtimeId,
  runtimeKind: "Cloud" as const,
  endpoint: "https://runtime.example.com",
  certificateFingerprint: null,
  provisioningEdgeId: null,
  presentationRevision: 1,
  issuedAt,
  leaseExpiresAt: "2026-08-21T00:00:00.000Z",
  edgeHealthyAfter: "2026-08-19T23:59:00.000Z",
});

describe("D1RuntimeAssignmentRepository", () => {
  it("fences one active assignment per session and runtime while incrementing the session epoch", async () => {
    const suffix = crypto.randomUUID();
    const firstSession = await addSession(`first-${suffix}`);
    const secondSession = await addSession(`second-${suffix}`);
    const repository = new D1RuntimeAssignmentRepository(env.DB);

    await expect(
      repository.assign({
        ...cloudAssignment(firstSession, `runtime-${suffix}`),
        presentationRevision: 2,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.assign(cloudAssignment(firstSession, `runtime-${suffix}`)),
    ).resolves.toMatchObject({ assignmentEpoch: 1, presentationRevision: 1 });
    await expect(
      repository.assign(cloudAssignment(firstSession, `other-runtime-${suffix}`)),
    ).resolves.toBeNull();
    await expect(
      repository.assign(cloudAssignment(secondSession, `runtime-${suffix}`)),
    ).resolves.toBeNull();

    await repository.releaseSession(firstSession, "2026-08-20T01:00:00.000Z");
    await expect(
      repository.assign(
        cloudAssignment(firstSession, `other-runtime-${suffix}`, "2026-08-20T01:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ assignmentEpoch: 2 });
  });

  it("returns only the public assignment shape while the session and lease remain active", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = await addSession(suffix);
    const repository = new D1RuntimeAssignmentRepository(env.DB);
    await repository.assign(cloudAssignment(sessionId, `runtime-${suffix}`));

    const assignment = await repository.findActive(
      sessionId,
      "2026-08-20T01:00:00.000Z",
      "2026-08-20T00:59:00.000Z",
    );
    expect(assignment).toMatchObject({ assignmentEpoch: 1, presentationRevision: 1 });
    expect(assignment).not.toHaveProperty("epoch");
    expect(assignment).not.toHaveProperty("revision");
    await expect(
      repository.findActive(
        sessionId,
        "2026-08-21T00:00:00.000Z",
        "2026-08-20T23:59:00.000Z",
      ),
    ).resolves.toBeNull();

    await env.DB.prepare("UPDATE presentation_sessions SET state = 'Ended' WHERE id = ?")
      .bind(sessionId)
      .run();
    await expect(
      repository.findActive(
        sessionId,
        "2026-08-20T01:00:00.000Z",
        "2026-08-20T00:59:00.000Z",
      ),
    ).resolves.toBeNull();
  });

  it("renews and releases a Venue Edge lease only for its exact provisioning identity", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = await addSession(suffix);
    const edgeId = `edge-${suffix}`;
    const runtimeId = `runtime-${suffix}`;
    await env.DB.prepare(
      "INSERT INTO venue_edges (id, runtime_id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', '1', 'v1', 1, 'https://edge.example.com', 'sha256:test', 'healthy', '2026', '2026', '2026')",
    )
      .bind(edgeId, runtimeId)
      .run();
    const repository = new D1RuntimeAssignmentRepository(env.DB);
    await expect(
      repository.assign({
        sessionId,
        runtimeId,
        runtimeKind: "VenueEdge",
        endpoint: "https://edge.example.com",
        certificateFingerprint: "sha256:test",
        provisioningEdgeId: edgeId,
        presentationRevision: 1,
        issuedAt: "2026-08-20T00:00:00.000Z",
        leaseExpiresAt: "2026-08-21T00:00:00.000Z",
        edgeHealthyAfter: "2025-12-31T23:59:00.000Z",
      }),
    ).resolves.toMatchObject({ assignmentEpoch: 1, provisioningEdgeId: edgeId });
    await expect(
      repository.renew({
        sessionId,
        provisioningEdgeId: "wrong-edge",
        assignmentEpoch: 1,
        now: "2026-08-20T01:00:00.000Z",
        leaseExpiresAt: "2026-08-21T01:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.renew({
        sessionId,
        provisioningEdgeId: edgeId,
        assignmentEpoch: 1,
        now: "2026-08-20T01:00:00.000Z",
        leaseExpiresAt: "2026-08-21T00:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.renew({
        sessionId,
        provisioningEdgeId: edgeId,
        assignmentEpoch: 1,
        now: "2026-08-20T01:00:00.000Z",
        leaseExpiresAt: "2026-08-21T01:00:00.000Z",
      }),
    ).resolves.toMatchObject({ leaseExpiresAt: "2026-08-21T01:00:00.000Z" });
    await expect(
      repository.release({
        sessionId,
        provisioningEdgeId: edgeId,
        assignmentEpoch: 2,
        now: "2026-08-20T02:00:00.000Z",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.release({
        sessionId,
        provisioningEdgeId: edgeId,
        assignmentEpoch: 1,
        now: "2026-08-20T02:00:00.000Z",
      }),
    ).resolves.toBe(true);
  });

  it("stops exposing and renewing a Venue Edge assignment when its session or edge is unhealthy", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = await addSession(suffix);
    const edgeId = `edge-${suffix}`;
    const runtimeId = `runtime-${suffix}`;
    await env.DB.prepare(
      "INSERT INTO venue_edges (id, runtime_id, status, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', 'v1', 1, 'https://edge.example.com', 'sha256:test', 'healthy', '2026', '2026', '2026')",
    )
      .bind(edgeId, runtimeId)
      .run();
    const repository = new D1RuntimeAssignmentRepository(env.DB);
    await repository.assign({
      sessionId,
      runtimeId,
      runtimeKind: "VenueEdge",
      endpoint: "https://edge.example.com",
      certificateFingerprint: "sha256:test",
      provisioningEdgeId: edgeId,
      presentationRevision: 1,
      issuedAt: "2026-08-20T00:00:00.000Z",
      leaseExpiresAt: "2026-08-21T00:00:00.000Z",
      edgeHealthyAfter: "2025-12-31T23:59:00.000Z",
    });
    await env.DB.prepare("UPDATE venue_edges SET health = 'unhealthy' WHERE id = ?")
      .bind(edgeId)
      .run();

    await expect(
      repository.findActive(
        sessionId,
        "2026-08-20T01:00:00.000Z",
        "2026-08-20T00:59:00.000Z",
      ),
    ).resolves.toBeNull();
    await expect(
      repository.renew({
        sessionId,
        provisioningEdgeId: edgeId,
        assignmentEpoch: 1,
        now: "2026-08-20T01:00:00.000Z",
        leaseExpiresAt: "2026-08-21T01:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("does not assign or expose a Venue Edge whose heartbeat is stale", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = await addSession(`stale-${suffix}`);
    const edgeId = `edge-stale-${suffix}`;
    const runtimeId = `runtime-stale-${suffix}`;
    await env.DB.prepare(
      "INSERT INTO venue_edges (id, runtime_id, status, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', 'v1', 1, 'https://edge.example.com', 'sha256:test', 'healthy', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')",
    )
      .bind(edgeId, runtimeId)
      .run();
    const repository = new D1RuntimeAssignmentRepository(env.DB);
    const input = {
      sessionId,
      runtimeId,
      runtimeKind: "VenueEdge" as const,
      endpoint: "https://edge.example.com",
      certificateFingerprint: "sha256:test",
      provisioningEdgeId: edgeId,
      presentationRevision: 1,
      issuedAt: "2026-08-20T00:02:00.000Z",
      leaseExpiresAt: "2026-08-21T00:00:00.000Z",
      edgeHealthyAfter: "2026-08-20T00:01:00.000Z",
    };

    await expect(repository.assign(input)).resolves.toBeNull();
    await env.DB.prepare("UPDATE venue_edges SET last_seen_at = ? WHERE id = ?")
      .bind("2026-08-20T00:02:00.000Z", edgeId)
      .run();
    await expect(repository.assign(input)).resolves.toMatchObject({ assignmentEpoch: 1 });
    await expect(
      repository.findActive(
        sessionId,
        "2026-08-20T00:04:00.000Z",
        "2026-08-20T00:03:00.000Z",
      ),
    ).resolves.toBeNull();
  });
});
