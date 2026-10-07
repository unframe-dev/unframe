import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { D1SessionRepository } from "../../../src/modules/sessions/repository";
import { runtimeEnvironment } from "../../runtime-environment";
import publishedPresentation from "../../../../../../packages/contracts/presentation/fixtures/published-presentation.json";

const addUser = async (id: string) => {
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
  )
    .bind(id, "User", `${id}@example.test`, "2026-01-01", "2026-01-01")
    .run();
};

const pinPublication = async (sessionId: string, presentationId: string, userId: string) => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO presentation_builds (presentation_id, build_id, target_revision, artifacts, created_at) VALUES (?, 'test-build', 1, '{}', '2026')",
    ).bind(presentationId),
    env.DB.prepare(
      "INSERT INTO presentation_publications (presentation_id, epoch, build_id, manifest, published_at) VALUES (?, 1, 'test-build', ?, '2026')",
    ).bind(
      presentationId,
      JSON.stringify({ ...publishedPresentation, presentationId, publicationEpoch: 1 }),
    ),
    env.DB.prepare("UPDATE presentation_sessions SET publication_epoch = 1 WHERE id = ?").bind(
      sessionId,
    ),
    env.DB.prepare(
      "INSERT INTO session_participant_capabilities (session_id, user_id, capability_profile_id, capability_json, projection_profile_id, selected_at) VALUES (?, ?, 'quest-baked-web-v1', '{}', 'projection-test', '2026')",
    ).bind(sessionId, userId),
  ]);
};

describe("session HTTP lifecycle", () => {
  it("keeps unpublished sessions Waiting and refuses bootstrap even with an active Cloud assignment", async () => {
    const suffix = crypto.randomUUID();
    const userId = `owner-${suffix}`;
    const presentationId = `presentation-${suffix}`;
    await addUser(userId);
    await env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{}', '2026', '2026')",
    )
      .bind(presentationId, userId)
      .run();
    await env.DB.prepare(
      "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES (?, ?, 'owner')",
    )
      .bind(presentationId, userId)
      .run();
    const app = createApp({
      identityProvider: async () => ({ userId, globalRole: "user" }),
      sessionNow: () => new Date("2026-08-18T00:00:00.000Z"),
      credentials: {
        issue: async () => ({
          token: "unpublished-token",
          expiresAt: Date.parse("2026-08-21T00:00:00.000Z"),
        }),
      },
    });
    const post = (path: string, body = {}) =>
      app.fetch(
        new Request(`https://api.example.com${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        runtimeEnvironment(),
      );
    const created = await post("/sessions", { presentationId });
    expect(created.status).toBe(201);
    const { session } = await created.json<{ session: { id: string; state: string } }>();
    expect(session.state).toBe("Waiting");
    await env.DB.prepare(
      "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at) VALUES (?, ?, 'Cloud', 'https://runtime.example.com', 1, 1, '2026-08-17T00:00:00.000Z', '2026-08-21T00:00:00.000Z')",
    )
      .bind(session.id, `runtime-${suffix}`)
      .run();
    expect((await post(`/sessions/${session.id}/start`)).status).toBe(409);
    const bootstrap = await post(`/sessions/${session.id}/bootstrap`);
    expect(bootstrap.status).toBe(409);
    await expect(bootstrap.text()).resolves.not.toContain("unpublished-token");
    await expect(new D1SessionRepository(env.DB).findById(session.id)).resolves.toMatchObject({
      state: "Waiting",
    });
  });
  it("creates, joins, bootstraps, and makes credentials subordinate to Ended", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const viewerId = `viewer-${suffix}`;
    const presentationId = `presentation-${suffix}`;
    await Promise.all([addUser(ownerId), addUser(viewerId)]);
    await env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
    )
      .bind(
        presentationId,
        ownerId,
        '{"title":"Demo","groups":[],"assets":[]}',
        "2026-01-01",
        "2026-01-01",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES (?, ?, 'owner')",
    )
      .bind(presentationId, ownerId)
      .run();
    const app = createApp({
      identityProvider: async (context) => {
        const userId = context.req.header("x-test-user");
        return userId ? { userId, globalRole: "user" } : undefined;
      },
      joinCode: () => "WXYZ-2345",
      sessionNow: () => new Date("2026-08-18T00:00:00.000Z"),
      credentials: {
        issue: async () => ({
          token: "signed-session-token",
          expiresAt: Date.parse("2026-08-18T00:00:00.000Z"),
        }),
      },
    });
    const request = (path: string, userId: string, body?: unknown) =>
      app.fetch(
        new Request(`https://api.example.com${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": userId,
            "cf-connecting-ip": "192.0.2.1",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        runtimeEnvironment(),
      );

    const created = await request("/sessions", ownerId, { presentationId });
    expect(created.status).toBe(201);
    const creation = await created.json<{
      session: { id: string; joinCodeHash?: string };
      joinCode: string;
    }>();
    expect(creation.joinCode).toBe("WXYZ-2345");
    expect(creation.session).not.toHaveProperty("joinCodeHash");

    expect(
      (await request("/sessions/join", viewerId, { joinCode: creation.joinCode })).status,
    ).toBe(200);
    await pinPublication(creation.session.id, presentationId, viewerId);
    expect((await request(`/sessions/${creation.session.id}/start`, ownerId, {})).status).toBe(200);
    expect((await request(`/sessions/${creation.session.id}/bootstrap`, viewerId, {})).status).toBe(
      409,
    );
    await env.DB.prepare(
      "INSERT INTO venue_edges (id, runtime_id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', '1', 'v2', 50, ?, ?, 'healthy', ?, ?, ?)",
    )
      .bind(
        `edge-${suffix}`,
        `runtime-${suffix}`,
        "https://edge.example.com",
        `sha256:${"a".repeat(64)}`,
        "2026-08-17T00:00:00.000Z",
        "2026-08-18T00:00:00.000Z",
        "2026-08-17T00:00:00.000Z",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint, provisioning_edge_id, epoch, revision, issued_at, lease_expires_at) VALUES (?, ?, 'VenueEdge', ?, ?, ?, 1, 1, ?, ?)",
    )
      .bind(
        creation.session.id,
        `runtime-${suffix}`,
        "https://edge.example.com",
        `sha256:${"a".repeat(64)}`,
        `edge-${suffix}`,
        "2026-08-17T00:00:00.000Z",
        "2026-08-21T00:00:00.000Z",
      )
      .run();
    const bootstrap = await request(`/sessions/${creation.session.id}/bootstrap`, viewerId, {});
    await expect(bootstrap.json()).resolves.toMatchObject({
      endpoint: "https://edge.example.com",
      runtimeId: `runtime-${suffix}`,
      runtimeKind: "VenueEdge",
      assignmentEpoch: 1,
      presentationId,
      presentationRevision: 1,
      fingerprint: `sha256:${"a".repeat(64)}`,
      credential: "signed-session-token",
    });

    expect((await request(`/sessions/${creation.session.id}/end`, ownerId, {})).status).toBe(200);
    await expect(
      env.DB.prepare(
        "SELECT released_at AS releasedAt FROM runtime_assignments WHERE session_id = ? AND epoch = 1",
      )
        .bind(creation.session.id)
        .first<{ releasedAt: string | null }>(),
    ).resolves.toMatchObject({ releasedAt: "2026-08-18T00:00:00.000Z" });
    expect((await request(`/sessions/${creation.session.id}/bootstrap`, viewerId, {})).status).toBe(
      409,
    );
  });

  it("does not return a credential when the session ends during signing", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const presentationId = `presentation-${suffix}`;
    await addUser(ownerId);
    await env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
    )
      .bind(
        presentationId,
        ownerId,
        '{"title":"Demo","groups":[],"assets":[]}',
        "2026-01-01",
        "2026-01-01",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES (?, ?, 'owner')",
    )
      .bind(presentationId, ownerId)
      .run();
    const app = createApp({
      identityProvider: async () => ({ userId: ownerId, globalRole: "user" }),
      joinCode: () => "ABCD-EFGH",
      sessionNow: () => new Date("2026-08-18T00:00:00.000Z"),
      credentials: {
        issue: async (input) => {
          await new D1SessionRepository(env.DB).end(input.sessionId, "2026-08-18T00:00:00.000Z");
          return {
            token: "must-not-be-returned",
            expiresAt: Date.parse("2026-08-21T00:00:00.000Z"),
          };
        },
      },
    });
    const request = (path: string, body: unknown) =>
      app.fetch(
        new Request(`https://api.example.com${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        runtimeEnvironment(),
      );
    const created = await request("/sessions", { presentationId });
    expect(created.status).toBe(201);
    const creation = await created.json<{ session: { id: string } }>();
    await pinPublication(creation.session.id, presentationId, ownerId);
    const edgeId = `edge-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO venue_edges (id, runtime_id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', '1', 'v2', 50, ?, ?, 'healthy', ?, ?, ?)",
      ).bind(
        edgeId,
        `runtime-${suffix}`,
        "https://edge.example.com",
        `sha256:${"a".repeat(64)}`,
        "2026-08-17T00:00:00.000Z",
        "2026-08-17T00:00:00.000Z",
        "2026-08-17T00:00:00.000Z",
      ),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint, provisioning_edge_id, epoch, revision, issued_at, lease_expires_at) VALUES (?, ?, 'VenueEdge', ?, ?, ?, 1, 1, ?, ?)",
      ).bind(
        creation.session.id,
        `runtime-${suffix}`,
        "https://edge.example.com",
        `sha256:${"a".repeat(64)}`,
        edgeId,
        "2026-08-17T00:00:00.000Z",
        "2026-08-21T00:00:00.000Z",
      ),
    ]);

    const response = await request(`/sessions/${creation.session.id}/bootstrap`, {});
    expect(response.status).toBe(409);
    await expect(response.text()).resolves.not.toContain("must-not-be-returned");
  });

  it("returns the existing conflict response when less than one second remains on a lease", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const presentationId = `presentation-${suffix}`;
    const now = new Date("2026-08-18T00:00:00.900Z");
    await addUser(ownerId);
    await env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{\"groups\":[],\"assets\":[]}', '2026-01-01', '2026-01-01')",
    )
      .bind(presentationId, ownerId)
      .run();
    await env.DB.prepare(
      "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES (?, ?, 'owner')",
    )
      .bind(presentationId, ownerId)
      .run();
    const sessionId = `session-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES (?, ?, ?, ?, 'Waiting', 1, 50, ?)",
      ).bind(sessionId, presentationId, ownerId, `code-${suffix}`, now.toISOString()),
      env.DB.prepare(
        "INSERT INTO session_participants (session_id, user_id, role, joined_at) VALUES (?, ?, 'presenter', ?)",
      ).bind(sessionId, ownerId, now.toISOString()),
    ]);
    await pinPublication(sessionId, presentationId, ownerId);
    const app = createApp({
      identityProvider: async () => ({ userId: ownerId, globalRole: "user" }),
      sessionNow: () => now,
    });
    const edgeId = `edge-${suffix}`;
    const runtimeId = `runtime-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO venue_edges (id, runtime_id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', '1', 'v2', 50, 'https://edge.example.com', 'sha256:test', 'healthy', ?, ?, ?)",
      ).bind(edgeId, runtimeId, now.toISOString(), now.toISOString(), now.toISOString()),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, certificate_fingerprint, provisioning_edge_id, epoch, revision, issued_at, lease_expires_at) VALUES (?, ?, 'VenueEdge', 'https://edge.example.com', 'sha256:test', ?, 1, 1, ?, ?)",
      ).bind(sessionId, runtimeId, edgeId, now.toISOString(), "2026-08-18T00:00:01.100Z"),
    ]);
    const response = await app.fetch(
      new Request(`https://api.example.com/sessions/${sessionId}/bootstrap`, { method: "POST" }),
      runtimeEnvironment(),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "conflict", message: "conflict" },
    });
  });
});
