import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
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
      joinCode: () => "ABCD-EFGH",
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
    expect(creation.joinCode).toBe("ABCD-EFGH");
    expect(creation.session).not.toHaveProperty("joinCodeHash");

    expect(
      (await request("/sessions/join", viewerId, { joinCode: creation.joinCode })).status,
    ).toBe(200);
    const bootstrap = await request(`/sessions/${creation.session.id}/bootstrap`, viewerId, {});
    await expect(bootstrap.json()).resolves.toMatchObject({
      endpoint: "https://realtime.example.com",
      credential: "signed-session-token",
    });

    expect((await request(`/sessions/${creation.session.id}/end`, ownerId, {})).status).toBe(200);
    expect((await request(`/sessions/${creation.session.id}/bootstrap`, viewerId, {})).status).toBe(
      409,
    );
  });
});
