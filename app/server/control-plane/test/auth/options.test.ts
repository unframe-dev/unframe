import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createAuth, createAuthOptions } from "../../src/auth/options";

const testEnvironment = () => ({
  DB: env.DB,
  BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
  BETTER_AUTH_URL: "https://example.com",
  DEVICE_CLIENT_ID: "unframe-unity",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  WEB_ORIGIN: "https://app.example.com",
  ASSETS: { head: () => {}, get: () => {}, put: () => {}, delete: () => {}, list: () => {} },
  R2_ACCOUNT_ID: "test-r2-account-id",
  R2_BUCKET_NAME: "assets",
  R2_ACCESS_KEY_ID: "test-r2-access-key",
  R2_SECRET_ACCESS_KEY: "test-r2-secret-access-key",
});

const auth = () => createAuth(testEnvironment());

type DeviceCode = { device_code: string; user_code: string };

async function requestAuth(path: string, init?: RequestInit) {
  return auth().handler(new Request(`https://example.com/api/auth${path}`, init));
}

async function issueDeviceCode(): Promise<DeviceCode> {
  const response = await requestAuth("/device/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: "unframe-unity" }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<DeviceCode>;
}

async function seedBrowserSession(globalRole: "admin" | "user" = "user") {
  const timestamp = Date.now();
  const userId = crypto.randomUUID();
  const token = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, globalRole) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(userId, "Test User", `${userId}@example.com`, 1, timestamp, timestamp, globalRole)
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), timestamp + 60_000, token, timestamp, timestamp, userId)
    .run();
  const sessionResponse = await requestAuth("/get-session", {
    headers: { authorization: `Bearer ${token}` },
  });
  const cookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toBeTruthy();
  return { cookie: cookie!, token, userId };
}

function deviceTokenRequest(deviceCode: string) {
  return requestAuth("/device/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: "unframe-unity",
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
}

async function claimDeviceCode(userCode: string, cookie: string) {
  return requestAuth(`/device?user_code=${encodeURIComponent(userCode)}`, { headers: { cookie } });
}

async function decideDeviceCode(
  path: "/device/approve" | "/device/deny",
  userCode: string,
  cookie: string,
) {
  return requestAuth(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: "https://app.example.com" },
    body: JSON.stringify({ userCode }),
  });
}

describe("Better Auth device authorization", () => {
  it("publishes the Better Auth OpenAPI schema without enabling the reference UI", async () => {
    const schema = await auth().handler(
      new Request("https://example.com/api/auth/open-api/generate-schema"),
    );
    expect(schema.status).toBe(200);
    const document = (await schema.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toBe("3.1.1");
    expect(document.paths).toHaveProperty("/device/code");
    expect(document.paths).toHaveProperty("/device/token");

    const reference = await auth().handler(new Request("https://example.com/api/auth/reference"));
    expect(reference.status).toBe(404);
  });

  it("issues a code with the configured expiry, polling interval, and verification URI", async () => {
    const response = await auth().handler(
      new Request("https://example.com/api/auth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: "unframe-unity" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      verification_uri: "https://app.example.com/device",
      expires_in: 1800,
      interval: 3,
    });
  });

  it("rejects an unrecognized device client", async () => {
    const response = await auth().handler(
      new Request("https://example.com/api/auth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: "other-client" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_client" });
  });

  it("starts Google sign-in at Better Auth's provider route with the configured callback URL", async () => {
    const response = await requestAuth("/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", disableRedirect: true }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { redirect: boolean; url: string };
    const authorizationUrl = new URL(body.url);
    expect(body.redirect).toBe(false);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.pathname).toBe("/o/oauth2/v2/auth");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("google-client-id");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://example.com/api/auth/callback/google",
    );
  });

  it("allows credentialed CORS only from the web origin", async () => {
    const app = createApp();
    const request = (origin: string) =>
      app.fetch(
        new Request("https://example.com/api/auth/device/code", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ client_id: "unframe-unity" }),
        }),
        testEnvironment() as unknown as CloudflareBindings,
      );

    const allowed = await request("https://app.example.com");
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("access-control-expose-headers")).toBe("set-auth-token");

    const rejected = await request("https://other.example.com");
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns authorization_pending and enforces the three-second polling interval", async () => {
    const issued = await auth().handler(
      new Request("https://example.com/api/auth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: "unframe-unity" }),
      }),
    );
    const { device_code: deviceCode } = (await issued.json()) as { device_code: string };
    const tokenRequest = () =>
      new Request("https://example.com/api/auth/device/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: "unframe-unity",
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

    const pending = await auth().handler(tokenRequest());
    expect(pending.status).toBe(400);
    await expect(pending.json()).resolves.toMatchObject({ error: "authorization_pending" });

    const tooSoon = await auth().handler(tokenRequest());
    expect(tooSoon.status).toBe(400);
    await expect(tooSoon.json()).resolves.toMatchObject({ error: "slow_down" });
  });

  it("issues a Bearer token after the claimed browser session approves the device code", async () => {
    const device = await issueDeviceCode();
    const browser = await seedBrowserSession();

    expect((await claimDeviceCode(device.user_code, browser.cookie)).status).toBe(200);
    expect(
      (await decideDeviceCode("/device/approve", device.user_code, browser.cookie)).status,
    ).toBe(200);

    const tokenResponse = await deviceTokenRequest(device.device_code);
    expect(tokenResponse.status).toBe(200);
    const token = (await tokenResponse.json()) as { access_token: string; token_type: string };
    expect(token.token_type).toBe("Bearer");
    expect(token.access_token).toEqual(expect.any(String));
    expect(token.access_token).not.toBe(browser.token);

    const session = await requestAuth("/get-session", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    await expect(session.json()).resolves.toMatchObject({
      user: { id: browser.userId, globalRole: "user" },
    });
    const app = createApp();
    const protectedResponse = await app.fetch(
      new Request("https://example.com/presentations", {
        headers: { authorization: `Bearer ${token.access_token}` },
      }),
      testEnvironment() as unknown as CloudflareBindings,
    );
    expect(protectedResponse.status).toBe(200);
  });

  it("returns access_denied when the code is denied", async () => {
    const device = await issueDeviceCode();
    const browser = await seedBrowserSession();
    await claimDeviceCode(device.user_code, browser.cookie);
    expect((await decideDeviceCode("/device/deny", device.user_code, browser.cookie)).status).toBe(
      200,
    );

    const response = await deviceTokenRequest(device.device_code);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "access_denied" });
  });

  it("returns expired_token for expired device codes", async () => {
    const device = await issueDeviceCode();
    await env.DB.prepare("UPDATE deviceCode SET expiresAt = ? WHERE deviceCode = ?")
      .bind(Date.now() - 1, device.device_code)
      .run();

    const response = await deviceTokenRequest(device.device_code);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "expired_token" });
  });

  it("does not let a different browser session approve a claimed device code", async () => {
    const device = await issueDeviceCode();
    const claimant = await seedBrowserSession();
    const otherBrowser = await seedBrowserSession();
    await claimDeviceCode(device.user_code, claimant.cookie);

    const response = await decideDeviceCode(
      "/device/approve",
      device.user_code,
      otherBrowser.cookie,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "access_denied" });
  });

  it("keeps globalRole server-controlled and maps persisted user and admin roles", async () => {
    const options = createAuthOptions(testEnvironment(), env.DB);
    expect(options.user.additionalFields.globalRole).toMatchObject({
      input: false,
      defaultValue: "user",
    });

    const user = await seedBrowserSession();
    const admin = await seedBrowserSession("admin");
    const userSession = await requestAuth("/get-session", {
      headers: { authorization: `Bearer ${user.token}` },
    });
    const adminSession = await requestAuth("/get-session", {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    await expect(userSession.json()).resolves.toMatchObject({ user: { globalRole: "user" } });
    await expect(adminSession.json()).resolves.toMatchObject({ user: { globalRole: "admin" } });
  });

  it("uses cookie and bearer sessions for presentation authorization while rejecting anonymous requests", async () => {
    const browser = await seedBrowserSession();
    const app = createApp();
    const request = (headers?: HeadersInit) =>
      app.fetch(
        new Request("https://example.com/presentations", headers ? { headers } : undefined),
        testEnvironment() as unknown as CloudflareBindings,
      );

    expect((await request()).status).toBe(401);
    expect((await request({ authorization: `Bearer ${browser.token}` })).status).toBe(200);
    expect((await request({ cookie: browser.cookie })).status).toBe(200);
  });
});
