import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { D1SessionRepository } from "../../../src/modules/sessions/repository";
import { runtimeEnvironment } from "../../runtime-environment";

const addUser = async (id: string) => {
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
  )
    .bind(id, "User", `${id}@example.test`, "2026-01-01", "2026-01-01")
    .run();
};

describe("session HTTP lifecycle", () => {
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
    expect((await request(`/sessions/${creation.session.id}/bootstrap`, viewerId, {})).status).toBe(
      409,
    );
    await env.DB.prepare(
      "INSERT INTO venue_edges (id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, 'active', '1', 'v1', 50, ?, ?, 'healthy', ?, ?, ?)",
    )
      .bind(
        `edge-${suffix}`,
        "https://edge.example.com",
        "sha256:test",
        "2026-08-17T00:00:00.000Z",
        "2026-08-17T00:00:00.000Z",
        "2026-08-17T00:00:00.000Z",
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO session_edge_assignments (session_id, edge_id, assignment_epoch, presentation_revision, issued_at, lease_expires_at) VALUES (?, ?, 1, 1, ?, ?)",
    )
      .bind(
        creation.session.id,
        `edge-${suffix}`,
        "2026-08-17T00:00:00.000Z",
        "2026-08-21T00:00:00.000Z",
      )
      .run();
    const bootstrap = await request(`/sessions/${creation.session.id}/bootstrap`, viewerId, {});
    await expect(bootstrap.json()).resolves.toMatchObject({
      endpoint: "https://edge.example.com",
      edgeId: `edge-${suffix}`,
      assignmentEpoch: 1,
      presentationId,
      presentationRevision: 1,
      fingerprint: "sha256:test",
      credential: "signed-session-token",
    });

    expect((await request(`/sessions/${creation.session.id}/end`, ownerId, {})).status).toBe(200);
    await expect(
      env.DB.prepare(
        "SELECT released_at AS releasedAt FROM session_edge_assignments WHERE session_id = ? AND assignment_epoch = 1",
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
    const edgeId = `edge-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO venue_edges (id, status, runtime_version, protocol_version, capacity, local_endpoint, certificate_fingerprint, health, registered_at, last_seen_at, created_at) VALUES (?, 'active', '1', 'v1', 50, ?, ?, 'healthy', ?, ?, ?)",
      ).bind(
        edgeId,
        "https://edge.example.com",
        "sha256:test",
        "2026-08-17T00:00:00.000Z",
        "2026-08-17T00:00:00.000Z",
        "2026-08-17T00:00:00.000Z",
      ),
      env.DB.prepare(
        "INSERT INTO session_edge_assignments (session_id, edge_id, assignment_epoch, presentation_revision, issued_at, lease_expires_at) VALUES (?, ?, 1, 1, ?, ?)",
      ).bind(creation.session.id, edgeId, "2026-08-17T00:00:00.000Z", "2026-08-21T00:00:00.000Z"),
    ]);

    const response = await request(`/sessions/${creation.session.id}/bootstrap`, {});
    expect(response.status).toBe(409);
    await expect(response.text()).resolves.not.toContain("must-not-be-returned");
  });
});
