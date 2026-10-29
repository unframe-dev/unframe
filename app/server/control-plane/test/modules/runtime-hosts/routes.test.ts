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

const host = { endpoint: "https://runtime.example.test", accepting: true, capacity: 2 };
const boot = { bootId: "boot-1", bootStartedAt: "2026-08-20T00:00:00.000Z" };
const start = (s: Awaited<ReturnType<typeof setup>>, input = { ...host, ...boot }) =>
  s.request(`/internal/runtime/hosts/${s.runtimeId}/start`, "POST", input, "", secret);
const beat = (s: Awaited<ReturnType<typeof setup>>, sessions: unknown[] = [], extra = {}) =>
  s.heartbeat({ ...host, bootId: boot.bootId, generation: 1, sessions, ...extra });
const serving = (sessionId: string, assignmentEpoch = 1, state = "ready") => ({
  sessionId,
  assignmentEpoch,
  state,
});

describe("Runtime host preparation", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM runtime_hosts").run();
  });

  it("requires service identity and presenter ownership", async () => {
    const s = await setup();
    expect(
      (
        await s.request(
          `/internal/runtime/hosts/${s.runtimeId}/start`,
          "POST",
          { ...host, ...boot },
          "",
          "wrong",
        )
      ).status,
    ).toBe(401);
    expect((await s.request(s.prepPath, "POST", undefined, "")).status).toBe(401);
    expect((await s.request(s.prepPath, "GET", undefined, "another-user")).status).toBe(403);
    expect((await s.prepare()).status).toBe(409);
  });

  it("allocates multiple Sessions atomically up to the explicit host capacity", async () => {
    const a = await setup();
    const b = await setup();
    const c = await setup();
    expect((await start(a)).status).toBe(200);
    const responses = await Promise.all([a.prepare(), b.prepare(), c.prepare()]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 409]);
    const result = await (await beat(a)).json<{ assignments: { sessionId: string }[] }>();
    expect(result.assignments).toHaveLength(2);
    expect(new Set(result.assignments.map((a) => a.sessionId)).size).toBe(2);
  });

  it("allocates the same Session once under concurrent preparation", async () => {
    const s = await setup();
    await start(s);
    const responses = await Promise.all([s.prepare(), s.prepare()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM runtime_assignments WHERE session_id = ?")
        .bind(s.sessionId)
        .first(),
    ).toEqual({ count: 1 });
  });

  it("separates Session readiness and keeps leases while the host drains", async () => {
    const a = await setup();
    const b = await setup();
    await start(a);
    await a.prepare();
    await b.prepare();
    a.advance(30);
    const result = await (
      await beat(a, [serving(a.sessionId), serving(b.sessionId, 1, "recovering")], {
        accepting: false,
      })
    ).json<{ assignments: { leaseExpiresAt: string }[] }>();
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.map((a) => a.leaseExpiresAt)).toEqual([
      "2026-08-20T00:02:30.000Z",
      "2026-08-20T00:02:30.000Z",
    ]);
    await expect((await a.request(a.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "ready",
    });
    await expect((await b.request(b.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "starting",
    });
    const c = await setup();
    expect((await c.prepare()).status).toBe(409);
  });

  it("does not renew a failed Session while another Session remains ready", async () => {
    const a = await setup();
    const b = await setup();
    await start(a);
    await a.prepare();
    await b.prepare();
    a.advance(30);
    const result = await (
      await beat(a, [serving(a.sessionId, 1, "failed"), serving(b.sessionId)])
    ).json<{ assignments: { sessionId: string; leaseExpiresAt: string }[] }>();
    expect(result.assignments.find((x) => x.sessionId === a.sessionId)?.leaseExpiresAt).toBe(
      "2026-08-20T00:02:00.000Z",
    );
    expect(result.assignments.find((x) => x.sessionId === b.sessionId)?.leaseExpiresAt).toBe(
      "2026-08-20T00:02:30.000Z",
    );
  });

  it("fences old boots and waits for the old lease before recovering every Session", async () => {
    const a = await setup();
    const b = await setup();
    await start(a);
    await a.prepare();
    await b.prepare();
    const next = { ...host, bootId: "boot-2", bootStartedAt: "2026-08-20T00:00:30.000Z" };
    a.advance(30);
    await expect((await start(a, next)).json()).resolves.toEqual({ generation: 2 });
    expect((await beat(a, [serving(a.sessionId)])).status).toBe(409);
    expect((await start(a)).status).toBe(409);
    await expect(
      (await beat(a, [], { bootId: "boot-2", generation: 2 })).json(),
    ).resolves.toMatchObject({ generation: 2, assignments: [] });
    a.advance(90);
    const result = await (
      await beat(a, [], { bootId: "boot-2", generation: 2 })
    ).json<{ assignments: { sessionId: string; assignmentEpoch: number; recovery: boolean }[] }>();
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.map((a) => [a.assignmentEpoch, a.recovery])).toEqual([
      [2, true],
      [2, true],
    ]);
    expect(result.assignments.map((a) => a.sessionId).sort()).toEqual(
      [a.sessionId, b.sessionId].sort(),
    );
  });

  it("waits for a released assignment lease before an explicit preparation can create a new authority", async () => {
    const s = await setup();
    await start(s);
    await s.prepare();
    await env.DB.prepare(
      "UPDATE runtime_assignments SET released_at = '2026-08-20T00:00:30.000Z' WHERE session_id = ?",
    )
      .bind(s.sessionId)
      .run();
    expect((await s.prepare()).status).toBe(409);
    await expect((await beat(s)).json()).resolves.toMatchObject({ assignments: [] });
    s.advance(120);
    await beat(s);
    await expect((await s.prepare()).json()).resolves.toMatchObject({
      assignmentEpoch: 2,
      state: "starting",
    });
  });

  it("uses confirmed Host stop as a fence without automatically restoring an explicitly released Session", async () => {
    const s = await setup();
    await start(s);
    await s.prepare();
    await env.DB.prepare(
      "UPDATE runtime_assignments SET released_at = '2026-08-20T00:00:30.000Z' WHERE session_id = ?",
    )
      .bind(s.sessionId)
      .run();
    await expect(
      (await beat(s, [serving(s.sessionId, 1, "stopped")])).json(),
    ).resolves.toMatchObject({ assignments: [] });
    await expect((await s.prepare()).json()).resolves.toMatchObject({
      assignmentEpoch: 2,
      state: "starting",
    });
  });

  it("restarts a confirmed stopped Session with a fresh epoch without waiting for its lease", async () => {
    const s = await setup();
    await start(s);
    await s.prepare();
    const result = await (
      await beat(s, [serving(s.sessionId, 1, "stopped")])
    ).json<{ assignments: { assignmentEpoch: number; recovery: boolean }[] }>();
    expect(result.assignments).toMatchObject([{ assignmentEpoch: 2, recovery: true }]);
    await expect((await beat(s, [serving(s.sessionId, 1)])).json()).resolves.toMatchObject({
      assignments: [{ assignmentEpoch: 2 }],
    });
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "starting",
      assignmentEpoch: 2,
    });
  });

  it("makes boot registration idempotent and rejects endpoint changes with live assignments", async () => {
    const s = await setup();
    await expect((await start(s)).json()).resolves.toEqual({ generation: 1 });
    await expect((await start(s)).json()).resolves.toEqual({ generation: 1 });
    await s.prepare();
    expect((await beat(s, [], { endpoint: "https://other.example.test" })).status).toBe(409);
    expect(
      (
        await start(s, {
          ...host,
          ...boot,
          bootId: "other",
          endpoint: "https://other.example.test",
          bootStartedAt: "2026-08-20T00:00:01.000Z",
        })
      ).status,
    ).toBe(409);
  });

  it.each([
    ["ended", "UPDATE presentation_sessions SET state = 'Ended' WHERE id = ?"],
    ["unpublished", "UPDATE presentation_sessions SET publication_epoch = NULL WHERE id = ?"],
    [
      "released",
      "UPDATE runtime_assignments SET released_at = '2026-08-20T00:01:00.000Z' WHERE session_id = ?",
    ],
  ])("does not recover a %s Session", async (_reason, query) => {
    const s = await setup();
    await start(s);
    await s.prepare();
    await env.DB.prepare(query).bind(s.sessionId).run();
    s.advance(121);
    await expect((await beat(s)).json()).resolves.toMatchObject({ assignments: [] });
  });

  it("never reclaims a Session moved to another runtime", async () => {
    const s = await setup();
    await start(s);
    await s.prepare();
    await env.DB.prepare(
      "INSERT INTO runtime_assignments (session_id,runtime_id,runtime_kind,endpoint,epoch,revision,issued_at,lease_expires_at) SELECT session_id,'other-runtime','Cloud',endpoint,2,revision,'2026-08-20T00:00:30.000Z',lease_expires_at FROM runtime_assignments WHERE session_id = ? AND epoch = 1",
    )
      .bind(s.sessionId)
      .run();
    s.advance(121);
    await expect((await beat(s)).json()).resolves.toMatchObject({ assignments: [] });
  });

  it("does not allocate stale hosts or unpublished Sessions", async () => {
    const s = await setup();
    await start(s);
    s.advance(61);
    expect((await s.prepare()).status).toBe(409);
    await beat(s);
    await env.DB.prepare("UPDATE presentation_sessions SET publication_epoch = NULL WHERE id = ?")
      .bind(s.sessionId)
      .run();
    expect((await s.prepare()).status).toBe(409);
  });

  it("keeps a delayed registration retry from reopening a draining Host", async () => {
    const a = await setup();
    const b = await setup();
    await start(a);
    await beat(a, [], { accepting: false, capacity: 1 });
    await expect((await start(a)).json()).resolves.toEqual({ generation: 1 });
    expect((await b.prepare()).status).toBe(409);
    expect(
      await env.DB.prepare("SELECT capacity, accepting FROM runtime_hosts WHERE runtime_id = ?")
        .bind(a.runtimeId)
        .first(),
    ).toEqual({ capacity: 1, accepting: 0 });
  });

  it("applies Host capacity to direct administrator assignments", async () => {
    const a = await setup();
    const b = await setup();
    const c = await setup();
    await start(a);
    const input = {
      runtimeId: a.runtimeId,
      runtimeKind: "Cloud",
      endpoint: host.endpoint,
      presentationRevision: 1,
      leaseExpiresAt: "2026-08-20T00:02:00.000Z",
    };
    expect(
      (await a.request(`/sessions/${a.sessionId}/runtime-assignment`, "POST", input, "admin"))
        .status,
    ).toBe(201);
    expect(
      (await b.request(`/sessions/${b.sessionId}/runtime-assignment`, "POST", input, "admin"))
        .status,
    ).toBe(201);
    expect(
      (await c.request(`/sessions/${c.sessionId}/runtime-assignment`, "POST", input, "admin"))
        .status,
    ).toBe(409);
    await expect((await beat(a)).json()).resolves.toMatchObject({
      assignments: [{ assignmentEpoch: 1 }, { assignmentEpoch: 1 }],
    });
  });

  it("clears readiness when a Session is absent from the next heartbeat", async () => {
    const s = await setup();
    await start(s);
    await s.prepare();
    await beat(s, [serving(s.sessionId)]);
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "ready",
    });
    await beat(s);
    await expect((await s.request(s.prepPath, "GET")).json()).resolves.toMatchObject({
      state: "starting",
    });
  });

  it("reduces capacity without expiring existing leases or reaccepting Sessions", async () => {
    const a = await setup();
    const b = await setup();
    const c = await setup();
    await start(a);
    await a.prepare();
    await b.prepare();
    a.advance(30);
    await expect(
      (await beat(a, [serving(a.sessionId), serving(b.sessionId)], { capacity: 1 })).json(),
    ).resolves.toMatchObject({
      assignments: [
        { leaseExpiresAt: "2026-08-20T00:02:30.000Z" },
        { leaseExpiresAt: "2026-08-20T00:02:30.000Z" },
      ],
    });
    expect((await c.prepare()).status).toBe(409);
  });

  it("rejects duplicate Session reports and unbounded capacities", async () => {
    const s = await setup();
    expect((await start(s, { ...host, ...boot, capacity: 0 })).status).toBe(400);
    await start(s);
    expect((await beat(s, [serving(s.sessionId), serving(s.sessionId)])).status).toBe(400);
  });
});
