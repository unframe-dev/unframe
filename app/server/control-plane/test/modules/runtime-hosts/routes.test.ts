import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";

const secret = "test-service-identity-secret-32-characters";
const setup = async () => {
  const id = crypto.randomUUID();
  const sessionId = `session-${id}`;
  const userId = `user-${id}`;
  const runtimeId = `runtime-${id}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'User', ?, 1, '2026', '2026')",
    ).bind(userId, `${userId}@example.test`),
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{\"groups\":[],\"assets\":[]}', '2026', '2026')",
    ).bind(id, userId),
    env.DB.prepare(
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, publication_epoch, created_at) VALUES (?, ?, ?, ?, 'Waiting', 1, 50, 1, '2026')",
    ).bind(sessionId, id, userId, id),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO presentation_builds (presentation_id, build_id, target_revision, artifacts, created_at) VALUES (?, 'build', 1, '{}', '2026')",
    ).bind(id),
    env.DB.prepare(
      "INSERT INTO presentation_publications (presentation_id, epoch, build_id, manifest, published_at) VALUES (?, 1, 'build', ?, '2026')",
    ).bind(
      id,
      JSON.stringify({
        presentationId: id,
        publicationEpoch: 1,
        publicationManifestHash: `sha256:${"a".repeat(64)}`,
      }),
    ),
  ]);
  let now = new Date("2026-08-20T00:00:00.000Z");
  const app = createApp({
    sessionNow: () => now,
    identityProvider: async (context) => {
      const user = context.req.header("x-user");
      return user ? { userId: user, globalRole: user === "admin" ? "admin" : "user" } : undefined;
    },
  });
  const request = (path: string, method: string, body?: unknown, user = userId, token?: string) =>
    app.fetch(
      new Request(`https://api.example.com${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-user": user,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      runtimeEnvironment(),
    );
  const prepPath = `/sessions/${sessionId}/runtime-preparation`;
  const heartbeat = (body: unknown, token = secret) =>
    request(`/internal/runtime/hosts/${runtimeId}/heartbeat`, "POST", body, "", token);
  const prepare = () => request(prepPath, "POST");
  return {
    sessionId,
    runtimeId,
    userId,
    request,
    prepPath,
    heartbeat,
    prepare,
    advance: (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
};

const host = { endpoint: "https://runtime.example.test", accepting: true };

describe("Runtime host preparation", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM runtime_hosts").run();
  });
  it("requires service identity for registration and Session presenter for preparation", async () => {
    const s = await setup();
    expect((await s.heartbeat(host, "wrong-secret")).status).toBe(401);
    expect((await s.request(s.prepPath, "POST", undefined, "")).status).toBe(401);
    expect((await s.request(s.prepPath, "GET", undefined, "another-user")).status).toBe(403);
    expect((await s.prepare()).status).toBe(409);
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toEqual({
      state: "unassigned",
    });
  });

  it("reserves one Session per host and does not allocate unpublished Sessions", async () => {
    const first = await setup();
    const second = await setup();
    await first.heartbeat(host);
    const allocations = await Promise.all([first.prepare(), second.prepare()]);
    expect(allocations.map((response) => response.status).sort()).toEqual([200, 409]);
    const unprepared = allocations[0]!.status === 409 ? first : second;
    await env.DB.prepare("UPDATE presentation_sessions SET publication_epoch = NULL WHERE id = ?")
      .bind(unprepared.sessionId)
      .run();
    await unprepared.heartbeat(host);
    expect((await unprepared.prepare()).status).toBe(409);
    await expect((await unprepared.request(unprepared.prepPath, "GET")).json()).resolves.toEqual({
      state: "unassigned",
    });
    expect((await first.request("/sessions/missing/runtime-preparation", "GET")).status).toBe(404);
  });

  it("allocates once, becomes ready only after serving, renews the lease, and stops on End", async () => {
    const s = await setup();
    await expect((await s.heartbeat(host)).json()).resolves.toEqual({ assignment: null });
    const results = await Promise.all([s.prepare(), s.prepare()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const prepared = await results[0]!.json<{
      state: string;
      assignmentEpoch: number;
      leaseExpiresAt: string;
    }>();
    expect(prepared).toMatchObject({
      state: "starting",
      runtimeId: s.runtimeId,
      assignmentEpoch: 1,
    });
    await expect(results[1]!.json()).resolves.toEqual(prepared);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM runtime_assignments WHERE session_id = ?",
    )
      .bind(s.sessionId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
    s.advance(30);
    const serving = { ...host, serving: { sessionId: s.sessionId, assignmentEpoch: 1 } };
    const beat = await s.heartbeat(serving);
    await expect(beat.json()).resolves.toMatchObject({
      assignment: {
        sessionId: s.sessionId,
        runtimeId: s.runtimeId,
        assignmentEpoch: 1,
        leaseExpiresAt: "2026-08-20T00:02:30.000Z",
      },
    });
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "ready",
    });
    expect((await s.heartbeat({ ...host, endpoint: "https://changed.example.test" })).status).toBe(
      409,
    );
    expect((await s.request(`/sessions/${s.sessionId}/end`, "POST")).status).toBe(200);
    await expect((await s.heartbeat(serving)).json()).resolves.toEqual({ assignment: null });
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toEqual({ state: "ended" });
    expect((await s.prepare()).status).toBe(409);
  });

  it("does not allocate stale hosts or renew draining hosts, and fences wrong serving epochs", async () => {
    const s = await setup();
    await s.heartbeat(host);
    s.advance(61);
    expect((await s.prepare()).status).toBe(409);
    await s.heartbeat(host);
    await s.prepare();
    await s.heartbeat({ ...host, serving: { sessionId: s.sessionId, assignmentEpoch: 2 } });
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "starting",
    });
    s.advance(30);
    const draining = await s.heartbeat({
      ...host,
      accepting: false,
      serving: { sessionId: s.sessionId, assignmentEpoch: 1 },
    });
    await expect(draining.json()).resolves.toMatchObject({
      assignment: { leaseExpiresAt: "2026-08-20T00:03:01.000Z" },
    });
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "starting",
    });
    s.advance(91);
    await expect((await s.heartbeat(host)).json()).resolves.toMatchObject({
      assignment: { sessionId: s.sessionId, assignmentEpoch: 2 },
    });
    await expect((await s.prepare()).json()).resolves.toMatchObject({
      state: "starting",
      assignmentEpoch: 2,
    });
  });

  it("restores the expired Session once and waits for serving the new epoch", async () => {
    const s = await setup();
    await s.heartbeat(host);
    await s.prepare();
    s.advance(120);
    const responses = await Promise.all([
      s.heartbeat({ ...host, serving: { sessionId: s.sessionId, assignmentEpoch: 1 } }),
      s.heartbeat(host),
      s.prepare(),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    for (const response of responses.slice(0, 2)) {
      await expect(response.json()).resolves.toMatchObject({
        assignment: { sessionId: s.sessionId, assignmentEpoch: 2 },
      });
    }
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "starting",
      assignmentEpoch: 2,
    });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM runtime_assignments WHERE session_id = ?",
    )
      .bind(s.sessionId)
      .first<{ count: number }>();
    expect(count?.count).toBe(2);
    await s.heartbeat({ ...host, serving: { sessionId: s.sessionId, assignmentEpoch: 2 } });
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "ready",
      assignmentEpoch: 2,
    });
  });

  it.each([
    ["ended", "UPDATE presentation_sessions SET state = 'Ended' WHERE id = ?"],
    ["unpublished", "UPDATE presentation_sessions SET publication_epoch = NULL WHERE id = ?"],
    [
      "released",
      "UPDATE runtime_assignments SET released_at = '2026-08-20T00:01:00.000Z' WHERE session_id = ?",
    ],
  ])("does not restore an expired %s Session", async (_reason, update) => {
    const s = await setup();
    await s.heartbeat(host);
    await s.prepare();
    await env.DB.prepare(update).bind(s.sessionId).run();
    s.advance(121);
    await expect((await s.heartbeat(host)).json()).resolves.toEqual({ assignment: null });
  });

  it.each([
    { ...host, accepting: false },
    { ...host, endpoint: "https://changed.example.test" },
  ])(
    "does not restore when the host no longer accepts its previous endpoint: %j",
    async (input) => {
      const s = await setup();
      await s.heartbeat(host);
      await s.prepare();
      s.advance(121);
      await expect((await s.heartbeat(input)).json()).resolves.toEqual({ assignment: null });
    },
  );

  it.each(["Cloud", "VenueEdge"])(
    "does not reclaim a Session moved to another %s runtime",
    async (kind) => {
      const s = await setup();
      await s.heartbeat(host);
      await s.prepare();
      await env.DB.prepare(
        "INSERT INTO venue_edges (id, status, last_seen_at, created_at) VALUES (?, 'active', '2026', '2026')",
      )
        .bind(s.runtimeId)
        .run();
      await env.DB.prepare(
        "INSERT INTO runtime_assignments SELECT session_id, 'another-runtime', ?, endpoint, NULL, ?, 2, revision, '2026-08-20T00:00:30.000Z', '2026-08-20T00:02:00.000Z', NULL FROM runtime_assignments WHERE session_id = ? AND epoch = 1",
      )
        .bind(kind, kind === "VenueEdge" ? s.runtimeId : null, s.sessionId)
        .run();
      s.advance(121);
      await expect((await s.heartbeat(host)).json()).resolves.toEqual({ assignment: null });
    },
  );

  it.each([
    [
      "ended",
      "UPDATE presentation_sessions SET state = 'Ended' WHERE id = ?",
      "2026-08-20T00:00:30.000Z",
    ],
    [
      "released",
      "UPDATE runtime_assignments SET released_at = '2026-08-20T00:01:00.000Z' WHERE session_id = ?",
      "2026-08-20T00:00:30.000Z",
    ],
    [
      "ambiguous",
      "UPDATE presentation_sessions SET state = 'Waiting' WHERE id = ?",
      "2026-08-20T00:00:00.000Z",
    ],
  ])(
    "does not fall back to older history when the latest host assignment is %s",
    async (_reason, update, issuedAt) => {
      const s = await setup();
      const later = await setup();
      await s.heartbeat(host);
      await s.prepare();
      await env.DB.prepare(
        "INSERT INTO runtime_assignments SELECT ?, runtime_id, runtime_kind, endpoint, NULL, NULL, 1, revision, ?, lease_expires_at, NULL FROM runtime_assignments WHERE session_id = ? AND epoch = 1",
      )
        .bind(later.sessionId, issuedAt, s.sessionId)
        .run();
      await env.DB.prepare(update).bind(later.sessionId).run();
      s.advance(121);
      await expect((await s.heartbeat(host)).json()).resolves.toEqual({ assignment: null });
    },
  );

  it("restores only the most recently assigned Session on a reused host", async () => {
    const first = await setup();
    const latest = await setup();
    await first.heartbeat(host);
    await first.prepare();
    await env.DB.prepare(
      "INSERT INTO runtime_assignments SELECT ?, runtime_id, runtime_kind, endpoint, NULL, NULL, 1, revision, '2026-08-20T00:00:30.000Z', lease_expires_at, NULL FROM runtime_assignments WHERE session_id = ? AND epoch = 1",
    )
      .bind(latest.sessionId, first.sessionId)
      .run();
    first.advance(121);
    await expect((await first.heartbeat(host)).json()).resolves.toMatchObject({
      assignment: { sessionId: latest.sessionId, assignmentEpoch: 2 },
    });
  });
});
