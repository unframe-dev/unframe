import { audienceWebCapabilityProfileId } from "@unframe/contracts/presentation";
import { env } from "cloudflare:test";
import { sha256JoinCode } from "../../../src/modules/sessions/service";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";

describe("anonymous viewer credentials", () => {
  it("validates the issuance request", async () => {
    const response = await createApp().fetch(
      new Request("https://api.example.com/viewer-credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      runtimeEnvironment(),
    );
    expect(response.status).toBe(400);
  });
  it("rejects an unknown join code without issuing credentials", async () => {
    const response = await createApp().fetch(
      new Request("https://api.example.com/viewer-credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinCode: "ABCD-EFGH" }),
      }),
      runtimeEnvironment(),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "not found" },
    });
  });
});

it("scopes, rotates, expires and revokes anonymous credentials without management access", async () => {
  const suffix = crypto.randomUUID();
  const sessionId = `viewer-session-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, '2026', '2026')",
    ).bind(suffix, `${suffix}@test.invalid`),
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{}', '2026', '2026')",
    ).bind(suffix, suffix),
    env.DB.prepare(
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, created_at) VALUES (?, ?, ?, ?, 'Waiting', '2026')",
    ).bind(sessionId, suffix, suffix, await sha256JoinCode("TEST-ABCD")),
    env.DB.prepare(
      "INSERT INTO session_participants (session_id, user_id, role, joined_at) VALUES (?, ?, 'presenter', '2026')",
    ).bind(sessionId, suffix),
  ]);
  let timestamp = new Date("2026-10-27T00:00:00Z");
  const app = createApp({ sessionNow: () => timestamp });
  const request = (path: string, method: string, token?: string, body?: unknown) =>
    app.fetch(
      new Request(`https://api.example.com${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      runtimeEnvironment(),
    );
  const issued = await request("/viewer-credentials", "POST", undefined, { joinCode: "TEST-ABCD" });
  expect(issued.status).toBe(201);
  expect(issued.headers.get("cache-control")).toBe("no-store");
  const credential = (await issued.json()) as {
    token: string;
    participantId: string;
    expiresAt: string;
  };
  expect(credential.expiresAt).toBe("2026-10-27T01:00:00.000Z");
  for (const [path, method, body] of [
    ["/presentations", "GET", undefined],
    ["/sessions", "POST", { presentationId: suffix }],
    [`/sessions/${sessionId}/start`, "POST", {}],
    [`/sessions/${sessionId}/end`, "POST", {}],
  ] as const)
    expect((await request(path, method, credential.token, body)).status).toBe(401);
  expect((await request("/sessions/other", "GET", credential.token)).status).toBe(403);
  expect(
    (
      await request("/sessions/other/delivery", "POST", credential.token, {
        capabilityProfileId: audienceWebCapabilityProfileId,
      })
    ).status,
  ).toBe(403);
  expect(
    (await request("/sessions/join", "POST", credential.token, { joinCode: "ABCD-EFGH" })).status,
  ).toBe(403);
  const refreshed = await request("/viewer-credentials/refresh", "POST", credential.token);
  expect(refreshed.status).toBe(200);
  const rotated = (await refreshed.json()) as { token: string };
  expect(rotated.token).not.toBe(credential.token);
  expect((await request(`/sessions/${sessionId}`, "GET", credential.token)).status).toBe(401);
  expect((await request(`/sessions/${sessionId}`, "GET", rotated.token)).status).toBe(200);
  await env.DB.prepare(
    "UPDATE anonymous_viewer_credentials SET renewable_until = '2026-10-27T00:30:00.000Z' WHERE user_id = ?",
  )
    .bind(credential.participantId)
    .run();
  timestamp = new Date("2026-10-27T00:29:00Z");
  const limitedRefresh = await request("/viewer-credentials/refresh", "POST", rotated.token);
  expect(limitedRefresh.status).toBe(200);
  const limited = (await limitedRefresh.json()) as { token: string; expiresAt: string };
  expect(limited.expiresAt).toBe("2026-10-27T00:30:00.000Z");
  rotated.token = limited.token;
  timestamp = new Date("2026-10-27T00:30:00Z");
  expect((await request("/viewer-credentials/refresh", "POST", rotated.token)).status).toBe(401);
  timestamp = new Date("2026-10-27T00:00:00Z");
  expect((await request("/viewer-credentials", "DELETE", rotated.token)).status).toBe(204);
  expect((await request(`/sessions/${sessionId}`, "GET", rotated.token)).status).toBe(401);
  const nextIssue = await request("/viewer-credentials", "POST", undefined, {
    joinCode: "TEST-ABCD",
  });
  expect(nextIssue.status).toBe(201);
  const nextCredential = (await nextIssue.json()) as { token: string };
  await env.DB.prepare("UPDATE presentation_sessions SET state = 'Ended' WHERE id = ?")
    .bind(sessionId)
    .run();
  const ended = await request("/viewer-credentials/refresh", "POST", nextCredential.token);
  expect(ended.status).toBe(410);
  await expect(ended.json()).resolves.toEqual({
    error: { code: "session_ended", message: "Session ended" },
  });
  expect(
    (await request(`/sessions/${sessionId}/bootstrap`, "POST", nextCredential.token, {})).status,
  ).toBe(410);
  expect((await request("/sessions/other", "GET", nextCredential.token)).status).toBe(403);
  expect((await request(`/sessions/${sessionId}`, "GET", "viewer_invalid")).status).toBe(401);
  expect((await request(`/sessions/${sessionId}`, "GET", credential.token)).status).toBe(401);
  timestamp = new Date("2026-10-27T01:00:00Z");
  expect((await request(`/sessions/${sessionId}`, "GET", nextCredential.token)).status).toBe(401);
});

it("allows only the configured Audience origin for bearer browser requests", async () => {
  const app = createApp();
  const environment = { ...runtimeEnvironment(), AUDIENCE_ORIGIN: "https://audience.example.test" };
  const allowed = await app.fetch(
    new Request("https://api.example.com/viewer-credentials", {
      method: "OPTIONS",
      headers: {
        origin: "https://audience.example.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    }),
    environment,
  );
  expect(allowed.headers.get("access-control-allow-origin")).toBe("https://audience.example.test");
  const rejected = await app.fetch(
    new Request("https://api.example.com/health", {
      headers: { origin: "https://other.example.test" },
    }),
    environment,
  );
  expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
});

it("rate limits issuance before allocating anonymous users", async () => {
  const app = createApp();
  const ip = crypto.randomUUID();
  for (let index = 0; index < 10; index++) {
    const response = await app.fetch(
      new Request("https://api.example.com/viewer-credentials", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ joinCode: "RATE-ABCD" }),
      }),
      runtimeEnvironment(),
    );
    expect(response.status).toBe(404);
  }
  const response = await app.fetch(
    new Request("https://api.example.com/viewer-credentials", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ joinCode: "RATE-ABCD" }),
    }),
    runtimeEnvironment(),
  );
  expect(response.status).toBe(429);
});
