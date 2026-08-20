import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";

const addSession = async (suffix: string) => {
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
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES (?, ?, ?, ?, 'Waiting', 1, 50, '2026')",
    ).bind(sessionId, presentationId, userId, `hash-${suffix}`),
  ]);
  return sessionId;
};

const request = (
  app: ReturnType<typeof createApp>,
  path: string,
  method: string,
  user?: string,
  body?: unknown,
) =>
  app.fetch(
    new Request(`https://api.example.com${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(user ? { "x-user": user } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    runtimeEnvironment(),
  );

describe("runtime assignment HTTP routes", () => {
  it("authorizes an assignment once before resolving a runtime profile", async () => {
    let identityCalls = 0;
    const app = createApp({
      identityProvider: async (context) => {
        identityCalls += 1;
        const userId = context.req.header("x-user");
        return userId ? { userId, globalRole: userId === "admin" ? "admin" : "user" } : undefined;
      },
      sessionNow: () => new Date("2026-08-20T00:00:00.000Z"),
    });
    const path = `/sessions/session-${crypto.randomUUID()}/runtime-assignment`;

    expect(
      (
        await request(app, path, "POST", undefined, {
          runtimeId: "missing-runtime",
          runtimeKind: "VenueEdge",
          presentationRevision: 1,
          leaseExpiresAt: "2026-08-21T00:00:00.000Z",
        })
      ).status,
    ).toBe(401);
    expect(identityCalls).toBe(1);

    expect(
      (
        await request(app, path, "POST", "user", {
          runtimeId: "missing-runtime",
          runtimeKind: "VenueEdge",
          presentationRevision: 1,
          leaseExpiresAt: "2026-08-21T00:00:00.000Z",
        })
      ).status,
    ).toBe(403);
    expect(identityCalls).toBe(2);
  });

  it("creates and returns a Cloud assignment with the generic contract", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = await addSession(suffix);
    let identityCalls = 0;
    const app = createApp({
      identityProvider: async () => {
        identityCalls += 1;
        return { userId: "admin", globalRole: "admin" };
      },
      sessionNow: () => new Date("2026-08-20T00:00:00.000Z"),
    });
    const path = `/sessions/${sessionId}/runtime-assignment`;

    expect(
      (
        await request(app, path, "POST", "admin", {
          runtimeId: `runtime-${suffix}`,
          runtimeKind: "Cloud",
          presentationRevision: 1,
          leaseExpiresAt: "2026-08-21T00:00:00.000Z",
        })
      ).status,
    ).toBe(400);

    const created = await request(app, path, "POST", "admin", {
      runtimeId: `runtime-${suffix}`,
      runtimeKind: "Cloud",
      endpoint: "https://runtime.example.com",
      presentationRevision: 1,
      leaseExpiresAt: "2026-08-21T00:00:00.000Z",
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({
      sessionId,
      runtimeId: `runtime-${suffix}`,
      runtimeKind: "Cloud",
      endpoint: "https://runtime.example.com",
      certificateFingerprint: null,
      provisioningEdgeId: null,
      assignmentEpoch: 1,
      presentationRevision: 1,
      issuedAt: "2026-08-20T00:00:00.000Z",
      leaseExpiresAt: "2026-08-21T00:00:00.000Z",
      releasedAt: null,
    });
    expect(identityCalls).toBe(2);

    const active = await request(app, path, "GET", "admin");
    expect(active.status).toBe(200);
    await expect(active.json()).resolves.toMatchObject({
      runtimeId: `runtime-${suffix}`,
      runtimeKind: "Cloud",
      assignmentEpoch: 1,
    });
  });

  it("derives a Venue Edge endpoint and fingerprint from its provisioning profile", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = await addSession(suffix);
    const edgeId = `edge-${suffix}`;
    const runtimeId = `runtime-${suffix}`;
    await env.DB.prepare(
      "INSERT INTO venue_edges (id, runtime_id, status, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', 'v1', 1, 'https://edge.example.com', 'sha256:test', 'healthy', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')",
    )
      .bind(edgeId, runtimeId)
      .run();
    const app = createApp({
      identityProvider: async () => ({ userId: "admin", globalRole: "admin" }),
      sessionNow: () => new Date("2026-08-20T00:00:00.000Z"),
    });

    const created = await request(
      app,
      `/sessions/${sessionId}/runtime-assignment`,
      "POST",
      "admin",
      {
        runtimeId,
        runtimeKind: "VenueEdge",
        presentationRevision: 1,
        leaseExpiresAt: "2026-08-21T00:00:00.000Z",
      },
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      runtimeId,
      runtimeKind: "VenueEdge",
      endpoint: "https://edge.example.com",
      certificateFingerprint: "sha256:test",
      provisioningEdgeId: edgeId,
    });
  });
});
