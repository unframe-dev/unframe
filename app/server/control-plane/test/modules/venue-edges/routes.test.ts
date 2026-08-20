import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";

describe("venue edge HTTP routes", () => {
  it("limits provisioning and assignment to administrators and authenticates edge registration and leases", async () => {
    const suffix = crypto.randomUUID();
    const sessionId = `session-${suffix}`;
    const app = createApp({
      identityProvider: async (context) => {
        const userId = context.req.header("x-user");
        return userId ? { userId, globalRole: userId === "admin" ? "admin" : "user" } : undefined;
      },
      sessionNow: () => new Date("2026-08-20T00:00:00.000Z"),
      venueEdgeCredential: () => ({ tokenId: "token-id", secret: new Uint8Array(32).fill(1) }),
    });
    const request = (path: string, method: string, user?: string, body?: unknown, token?: string) =>
      app.fetch(
        new Request(`https://api.example.com${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            ...(user ? { "x-user": user } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        runtimeEnvironment(),
      );
    const forbidden = await request("/venue-edges", "POST", "user", {
      expiresAt: "2026-08-22T00:00:00.000Z",
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      error: { code: "forbidden", message: "forbidden" },
    });
    const provisioned = await request("/venue-edges", "POST", "admin", {
      expiresAt: "2026-08-22T00:00:00.000Z",
    });
    expect(provisioned.status).toBe(201);
    const credential = await provisioned.json<{
      edge: { id: string; status: string };
      token: string;
    }>();
    expect(credential.token).toMatch(/^token-id\./);
    expect(credential.edge).toEqual({ id: expect.any(String), status: "active" });
    expect(
      (
        await request(`/venue-edges/${credential.edge.id}/register`, "POST", undefined, {
          runtimeVersion: "1",
          protocolVersion: "v1",
          capacity: 10,
          localEndpoint: "https://edge.example.com",
          certificateFingerprint: "sha256:test",
          health: "healthy",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          `/venue-edges/${credential.edge.id}/register`,
          "POST",
          undefined,
          {
            runtimeVersion: "1",
            protocolVersion: "v1",
            capacity: 10,
            localEndpoint: "http://edge.example.com",
            certificateFingerprint: "sha256:test",
            health: "healthy",
          },
          credential.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/venue-edges/${credential.edge.id}/register`,
          "POST",
          undefined,
          {
            runtimeVersion: "1",
            protocolVersion: "v1",
            capacity: 10,
            localEndpoint: "https://edge.example.com",
            certificateFingerprint: "sha256:test",
            health: "healthy",
          },
          credential.token,
        )
      ).status,
    ).toBe(204);
    await env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'User', ?, 1, '2026-01-01', '2026-01-01')",
    )
      .bind(`user-${suffix}`, `${suffix}@example.test`)
      .run();
    await env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{\"groups\":[],\"assets\":[]}', '2026-01-01', '2026-01-01')",
    )
      .bind(`presentation-${suffix}`, `user-${suffix}`)
      .run();
    await env.DB.prepare(
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, participant_count, max_participants, created_at) VALUES (?, ?, ?, ?, 'Waiting', 1, 50, '2026-01-01')",
    )
      .bind(sessionId, `presentation-${suffix}`, `user-${suffix}`, `code-${suffix}`)
      .run();
    const assignment = await request(
      `/sessions/${sessionId}/venue-edge-assignment`,
      "POST",
      "admin",
      {
        edgeId: credential.edge.id,
        presentationRevision: 1,
        leaseExpiresAt: "2026-08-22T00:00:00.000Z",
      },
    );
    expect(assignment.status).toBe(201);
    const value = await assignment.json<{ assignmentEpoch: number }>();
    expect(
      (await request(`/sessions/${sessionId}/venue-edge-assignment`, "GET", "admin")).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/venue-edges/${credential.edge.id}/assignments/${sessionId}/${value.assignmentEpoch + 1}/renew`,
          "POST",
          undefined,
          { leaseExpiresAt: "2026-08-23T00:00:00.000Z" },
          credential.token,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/venue-edges/${credential.edge.id}/assignments/${sessionId}/${value.assignmentEpoch}/renew`,
          "POST",
          undefined,
          { leaseExpiresAt: "2026-08-23T00:00:00.000Z" },
          credential.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/venue-edges/${credential.edge.id}/assignments/${sessionId}/${value.assignmentEpoch}/release`,
          "POST",
          undefined,
          undefined,
          credential.token,
        )
      ).status,
    ).toBe(204);
  });

  it("normalizes malformed Venue Edge JSON as a validation error", async () => {
    const app = createApp({
      identityProvider: async () => ({ userId: "admin", globalRole: "admin" }),
      sessionNow: () => new Date("2026-08-20T00:00:00.000Z"),
    });

    const response = await app.fetch(
      new Request("https://api.example.com/venue-edges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      runtimeEnvironment(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "validation_error", message: "Invalid JSON body" },
    });
  });
});
