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

const publish = async (presentationId: string) => {
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
  ]);
};

const pinPublication = async (sessionId: string, presentationId: string, userId: string) => {
  await env.DB.batch([
    env.DB.prepare("UPDATE presentation_sessions SET publication_epoch = 1 WHERE id = ?").bind(
      sessionId,
    ),
    env.DB.prepare(
      "INSERT INTO session_participant_capabilities (session_id, user_id, capability_profile_id, capability_json, projection_profile_id, selected_at) VALUES (?, ?, 'quest-baked-web-v1', '{}', 'projection-test', '2026')",
    ).bind(sessionId, userId),
  ]);
};

const managedRooms = async () => {
  const suffix = crypto.randomUUID();
  const owner = `owner-${suffix}`;
  const viewer = `viewer-${suffix}`;
  const presentationId = `presentation-${suffix}`;
  await Promise.all([addUser(owner), addUser(viewer)]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{}', '2026', '2026')",
    ).bind(presentationId, owner),
    env.DB.prepare(
      "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES (?, ?, 'owner')",
    ).bind(presentationId, owner),
  ]);
  await publish(presentationId);
  const randomCode = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const value = [...crypto.getRandomValues(new Uint8Array(8))]
      .map((byte) => alphabet[byte & 31])
      .join("");
    return `${value.slice(0, 4)}-${value.slice(4)}`;
  };
  const replacementCode = randomCode();
  const secondCode = randomCode();
  const finalCode = randomCode();
  const codes = [randomCode(), secondCode, replacementCode];
  const app = createApp({
    identityProvider: async (context) => {
      const userId = context.req.header("x-test-user");
      return userId ? { userId, globalRole: "user" } : undefined;
    },
    joinCode: () => codes.shift()!,
    sessionNow: () => new Date("2026-10-30T00:00:00.000Z"),
  });
  const request = (path: string, userId?: string, body?: unknown) =>
    app.fetch(
      new Request(`https://api.example.com${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          ...(userId ? { "x-test-user": userId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      runtimeEnvironment(),
    );
  const first = await (
    await request("/sessions", owner, { presentationId })
  ).json<{ session: { id: string }; joinCode: string }>();
  const second = await (
    await request("/sessions", owner, { presentationId })
  ).json<{ session: { id: string } }>();
  const path = `/sessions/${first.session.id}/join-code`;
  return {
    request,
    path,
    owner,
    viewer,
    first,
    second,
    codes,
    presentationId,
    replacementCode,
    secondCode,
    finalCode,
  };
};

describe("session HTTP lifecycle", () => {
  it("returns the saved code only to the creator, including after a Viewer joins", async () => {
    const { request, path, owner, viewer, first } = await managedRooms();
    const reopened = await request(path, owner);
    expect(reopened.status).toBe(200);
    expect(reopened.headers.get("cache-control")).toBe("no-store");
    await expect(reopened.json()).resolves.toEqual({ joinCode: first.joinCode });
    expect((await request(path)).status).toBe(401);
    expect((await request(path, viewer)).status).toBe(403);
    expect((await request(path, viewer, {})).status).toBe(403);
    await request("/sessions/join", viewer, { joinCode: first.joinCode });
    expect((await request(path, viewer)).status).toBe(403);
  });

  it("lists only owned rooms in bounded, stable pages without exposing codes", async () => {
    const { request, owner, viewer, first, second } = await managedRooms();
    expect((await request("/sessions")).status).toBe(401);
    await expect((await request("/sessions", viewer)).json()).resolves.toEqual({
      sessions: [],
      nextCursor: null,
    });
    const page = await (
      await request("/sessions?limit=1", owner)
    ).json<{ sessions: { id: string }[]; nextCursor: string }>();
    expect(page.sessions).toHaveLength(1);
    expect(page.nextCursor).toBe(page.sessions[0]?.id);
    expect(page.sessions[0]?.id).toBe([first.session.id, second.session.id].sort().reverse()[0]);
    const next = await (
      await request(`/sessions?limit=1&cursor=${page.nextCursor}`, owner)
    ).json<{ sessions: { id: string }[]; nextCursor: string | null }>();
    expect(new Set([page.sessions[0]?.id, next.sessions[0]?.id])).toEqual(
      new Set([first.session.id, second.session.id]),
    );
    expect(next.nextCursor).toBeNull();
    expect(page.sessions[0]).not.toHaveProperty("joinCode");
    expect(page.sessions[0]).not.toHaveProperty("joinCodeHash");
    expect((await request("/sessions?limit=101", owner)).status).toBe(400);
    expect((await request(`/sessions?cursor=${first.session.id}`, viewer)).status).toBe(404);
  });

  it("replaces a code and invalidates old-code admission for both account and anonymous Viewers", async () => {
    const { request, path, owner, viewer, first, replacementCode } = await managedRooms();
    const rotated = await request(path, owner, {});
    expect(rotated.status).toBe(200);
    await expect(rotated.json()).resolves.toEqual({ joinCode: replacementCode });
    await expect((await request(path, owner)).json()).resolves.toEqual({
      joinCode: replacementCode,
    });
    expect((await request("/sessions/join", viewer, { joinCode: first.joinCode })).status).toBe(
      404,
    );
    expect(
      (await request("/viewer-credentials", undefined, { joinCode: first.joinCode })).status,
    ).toBe(404);
    expect(
      (await request("/viewer-credentials", undefined, { joinCode: replacementCode })).status,
    ).toBe(201);
    expect((await request("/sessions/join", viewer, { joinCode: replacementCode })).status).toBe(
      200,
    );
  });

  it("retries generated-code collisions without changing the conflicting room", async () => {
    const {
      request,
      path,
      owner,
      first,
      second,
      codes,
      presentationId,
      replacementCode,
      secondCode,
      finalCode,
    } = await managedRooms();
    codes.unshift(first.joinCode);
    const created = await request("/sessions", owner, { presentationId });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ joinCode: replacementCode });
    codes.push(secondCode, finalCode);
    const rotated = await request(path, owner, {});
    expect(rotated.status).toBe(200);
    await expect(rotated.json()).resolves.toEqual({ joinCode: finalCode });
    await expect(
      (await request(`/sessions/${second.session.id}/join-code`, owner)).json(),
    ).resolves.toEqual({ joinCode: secondCode });
  });

  it("forbids rotating or joining an ended room", async () => {
    const { request, path, owner, first } = await managedRooms();
    await request(`/sessions/${first.session.id}/end`, owner, {});
    expect((await request(path, owner, {})).status).toBe(409);
    expect(
      (await request("/viewer-credentials", undefined, { joinCode: first.joinCode })).status,
    ).toBe(404);
  });

  it("rejects an unpublished presentation without leaving a session or participant", async () => {
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
    expect(created.status).toBe(409);
    await expect(created.json()).resolves.toEqual({
      error: { code: "conflict", message: "conflict" },
    });
    const sessions = await env.DB.prepare(
      "SELECT id FROM presentation_sessions WHERE presentation_id = ?",
    )
      .bind(presentationId)
      .all();
    expect(sessions.results).toEqual([]);
    const participants = await env.DB.prepare(
      "SELECT session_id FROM session_participants WHERE user_id = ?",
    )
      .bind(userId)
      .all();
    expect(participants.results).toEqual([]);
  });
  it("reads a legacy unpublished session with a null fence and enforces authentication and membership", async () => {
    const suffix = crypto.randomUUID();
    const userId = `owner-${suffix}`;
    const outsider = `other-${suffix}`;
    const presentationId = `presentation-${suffix}`;
    const sessionId = `session-${suffix}`;
    await Promise.all([addUser(userId), addUser(outsider)]);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{}', '2026', '2026')",
      ).bind(presentationId, userId),
      env.DB.prepare(
        "INSERT INTO presentation_members (presentation_id, user_id, role) VALUES (?, ?, 'owner')",
      ).bind(presentationId, userId),
      env.DB.prepare(
        "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES (?, ?, ?, ?, 'Waiting', 1, 50, '2026-01-01T00:00:00.000Z')",
      ).bind(sessionId, presentationId, userId, `hash-${suffix}`),
      env.DB.prepare(
        "INSERT INTO session_participants (session_id, user_id, role, joined_at) VALUES (?, ?, 'presenter', '2026')",
      ).bind(sessionId, userId),
    ]);
    const app = createApp({
      identityProvider: async (context) => {
        const id = context.req.header("x-test-user");
        return id ? { userId: id, globalRole: "user" } : undefined;
      },
    });
    const request = (path: string, id?: string, body?: unknown) =>
      app.fetch(
        new Request(`https://api.example.com${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json", ...(id ? { "x-test-user": id } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        runtimeEnvironment(),
      );
    expect((await request("/sessions", undefined, { presentationId })).status).toBe(401);
    expect((await request("/sessions", outsider, { presentationId })).status).toBe(403);
    expect((await request("/sessions", userId, { presentationId: "missing" })).status).toBe(404);
    const legacy = await request(`/sessions/${sessionId}`, userId);
    expect(legacy.status).toBe(200);
    await expect(legacy.json()).resolves.toMatchObject({ id: sessionId, publicationFence: null });
    expect((await request(`/sessions/${sessionId}`, outsider)).status).toBe(403);
    await env.DB.prepare(
      "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at) VALUES (?, ?, 'Cloud', 'https://runtime.example.com', 1, 1, '2026-08-17T00:00:00.000Z', '2099-08-21T00:00:00.000Z')",
    )
      .bind(sessionId, `runtime-${suffix}`)
      .run();
    expect((await request(`/sessions/${sessionId}/start`, userId, {})).status).toBe(409);
    expect((await request(`/sessions/${sessionId}/bootstrap`, userId, {})).status).toBe(409);
    await expect(new D1SessionRepository(env.DB).findById(sessionId)).resolves.toMatchObject({
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

    await publish(presentationId);
    const created = await request("/sessions", ownerId, { presentationId });
    expect(created.status).toBe(201);
    const creation = await created.json<{
      session: { id: string; joinCodeHash?: string };
      joinCode: string;
    }>();
    expect(creation.joinCode).toBe("WXYZ-2345");
    expect(creation.session).toMatchObject({
      publicationFence: {
        presentationId,
        publicationEpoch: 1,
        publicationManifestHash: publishedPresentation.publicationManifestHash,
      },
    });
    const retrieved = await request(`/sessions/${creation.session.id}`, ownerId);
    await expect(retrieved.json()).resolves.toMatchObject({
      publicationFence: {
        presentationId,
        publicationEpoch: 1,
        publicationManifestHash: publishedPresentation.publicationManifestHash,
      },
    });
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
      "INSERT INTO venue_edges (id, runtime_id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', '1', 'v3', 50, ?, ?, 'healthy', ?, ?, ?)",
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
    await publish(presentationId);
    const created = await request("/sessions", { presentationId });
    expect(created.status).toBe(201);
    const creation = await created.json<{ session: { id: string } }>();
    await pinPublication(creation.session.id, presentationId, ownerId);
    const edgeId = `edge-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO venue_edges (id, runtime_id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', '1', 'v3', 50, ?, ?, 'healthy', ?, ?, ?)",
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
    await publish(presentationId);
    await pinPublication(sessionId, presentationId, ownerId);
    const app = createApp({
      identityProvider: async () => ({ userId: ownerId, globalRole: "user" }),
      sessionNow: () => now,
    });
    const edgeId = `edge-${suffix}`;
    const runtimeId = `runtime-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO venue_edges (id, runtime_id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, ?, 'active', '1', 'v3', 50, 'https://edge.example.com', 'sha256:test', 'healthy', ?, ?, ?)",
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
