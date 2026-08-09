import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createAuth, createAuthOptions } from "../../src/auth/options";
import type { AuthMailer } from "../../src/auth/mail";

const testEnvironment = () => ({
  DB: env.DB,
  BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
  BETTER_AUTH_URL: "https://example.com",
  DEVICE_CLIENT_ID: "unframe-unity",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  RESEND_API_KEY: "re_test_key",
  AUTH_EMAIL_FROM: "auth@example.com",
  WEB_ORIGIN: "https://app.example.com",
  ASSETS: { head: () => {}, get: () => {}, put: () => {}, delete: () => {}, list: () => {} },
  R2_ACCOUNT_ID: "test-r2-account-id",
  R2_BUCKET_NAME: "assets",
  R2_ACCESS_KEY_ID: "test-r2-access-key",
  R2_SECRET_ACCESS_KEY: "test-r2-secret-access-key",
});

const auth = () => createAuth(testEnvironment());

const mailbox = () => {
  const messages: { to: string; subject: string; text: string }[] = [];
  const mailer: AuthMailer = async (message) => {
    messages.push(message);
  };
  return { auth: createAuth(testEnvironment(), { mailer }), messages };
};

type DeviceCode = { device_code: string; user_code: string };

const base32Decode = (value: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value.replace(/=/g, "").toUpperCase()) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
};

async function totpCode(uri: string, now = Date.now()) {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("TOTP URI did not include a secret");
  const counter = Math.floor(now / 30_000);
  const counterBytes = new Uint8Array(8);
  new DataView(counterBytes.buffer).setUint32(4, counter);
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = digest.at(-1)! & 0x0f;
  const value =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(value % 1_000_000).padStart(6, "0");
}

async function requestAuth(path: string, init?: RequestInit) {
  return auth().handler(new Request(`https://example.com/api/auth${path}`, init));
}

async function requestWithAuth(
  customAuth: ReturnType<typeof createAuth>,
  path: string,
  init?: RequestInit,
) {
  return customAuth.handler(new Request(`https://example.com/api/auth${path}`, init));
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

async function seedBrowserSession(
  globalRole: "admin" | "user" = "user",
  assurance = "google",
  emailVerified = 1,
  twoFactorEnabled = 0,
) {
  const timestamp = Date.now();
  const userId = crypto.randomUUID();
  const token = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, globalRole, twoFactorEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      userId,
      "Test User",
      `${userId}@example.com`,
      emailVerified,
      timestamp,
      timestamp,
      globalRole,
      twoFactorEnabled,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId, assurance) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), timestamp + 60_000, token, timestamp, timestamp, userId, assurance)
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
  it("enrolls TOTP and completes an email/password MFA challenge", async () => {
    const test = mailbox();
    const email = `${crypto.randomUUID()}@example.com`;
    const password = "password-with-enough-length";
    await requestWithAuth(test.auth, "/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password }),
    });
    const verification = new URL(test.messages.shift()!.text.match(/https:\/\/[^\s]+/)![0]);
    await requestWithAuth(
      test.auth,
      `/verify-email?token=${encodeURIComponent(verification.searchParams.get("token")!)}&callbackURL=https%3A%2F%2Fapp.example.com`,
    );
    const signIn = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const sessionCookie = signIn.headers.get("set-cookie")!.split(";", 1)[0]!;
    const enabled = await requestWithAuth(test.auth, "/two-factor/enable", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
        origin: "https://app.example.com",
      },
      body: JSON.stringify({ password }),
    });
    if (enabled.status !== 200) throw new Error(await enabled.text());
    expect(enabled.status).toBe(200);
    const enrollment = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    const enrollmentCode = await totpCode(enrollment.totpURI);
    expect(
      (
        await requestWithAuth(test.auth, "/two-factor/verify-totp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
            origin: "https://app.example.com",
          },
          body: JSON.stringify({ code: enrollmentCode }),
        })
      ).status,
    ).toBe(200);

    const challenge = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(await challenge.json()).toMatchObject({ twoFactorRedirect: true });
    const challengeCookie = challenge.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const verified = await requestWithAuth(test.auth, "/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: challengeCookie,
        origin: "https://app.example.com",
      },
      body: JSON.stringify({ code: await totpCode(enrollment.totpURI), trustDevice: true }),
    });
    if (verified.status !== 200) throw new Error(await verified.text());
    expect(verified.status).toBe(200);
    const bearerToken = verified.headers.get("set-auth-token");
    expect(bearerToken).toEqual(expect.any(String));
    const verifiedSession = await requestWithAuth(test.auth, "/get-session", {
      headers: { authorization: `Bearer ${bearerToken}` },
    });
    await expect(verifiedSession.json()).resolves.toMatchObject({
      session: { assurance: "password_mfa" },
      user: { email, twoFactorEnabled: true },
    });
    const trustedCookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const trustedSignIn = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: trustedCookie },
      body: JSON.stringify({ email, password }),
    });
    expect(await trustedSignIn.json()).not.toMatchObject({ twoFactorRedirect: true });

    const backupChallenge = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const backupCookie = backupChallenge.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const backup = () =>
      requestWithAuth(test.auth, "/two-factor/verify-backup-code", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: backupCookie,
          origin: "https://app.example.com",
        },
        body: JSON.stringify({ code: enrollment.backupCodes[0] }),
      });
    expect((await backup()).status).toBe(200);
    expect((await backup()).status).toBeGreaterThanOrEqual(400);

    let lastFailure: Response | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const lockoutChallenge = await requestWithAuth(test.auth, "/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const lockoutCookie = lockoutChallenge.headers
        .getSetCookie()
        .map((value) => value.split(";", 1)[0])
        .join("; ");
      lastFailure = await requestWithAuth(test.auth, "/two-factor/verify-totp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: lockoutCookie,
          origin: "https://app.example.com",
        },
        body: JSON.stringify({ code: "000000" }),
      });
    }
    expect(lastFailure?.status).toBe(401);
    const lockedChallenge = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const lockedCookie = lockedChallenge.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const locked = await requestWithAuth(test.auth, "/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: lockedCookie,
        origin: "https://app.example.com",
      },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(locked.status).toBe(429);
    const lockout = await env.DB.prepare(
      "SELECT failedVerificationCount, lockedUntil FROM twoFactor WHERE userId = (SELECT id FROM user WHERE email = ?)",
    )
      .bind(email)
      .first<{ failedVerificationCount: number; lockedUntil: string | null }>();
    expect(lockout).toMatchObject({ failedVerificationCount: 10, lockedUntil: expect.any(String) });
  });
  it("requires verification before password sign-in and sends the verification link", async () => {
    const test = mailbox();
    const email = `${crypto.randomUUID()}@example.com`;
    const password = "password-with-enough-length";
    const signUp = await requestWithAuth(test.auth, "/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password }),
    });
    expect(signUp.status).toBe(200);
    expect(test.messages).toHaveLength(1);

    const beforeVerification = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(beforeVerification.status).toBe(403);

    const verificationUrl = new URL(test.messages[0]!.text.match(/https:\/\/[^\s]+/)![0]);
    const verified = await requestWithAuth(
      test.auth,
      `/verify-email?token=${encodeURIComponent(verificationUrl.searchParams.get("token")!)}&callbackURL=https%3A%2F%2Fapp.example.com`,
    );
    expect(verified.status).toBe(302);

    const afterVerification = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(afterVerification.status).toBe(200);
  });

  it("sends a reset link, revokes sessions, and refuses a reused reset token", async () => {
    const test = mailbox();
    const email = `${crypto.randomUUID()}@example.com`;
    const password = "password-with-enough-length";
    await requestWithAuth(test.auth, "/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password }),
    });
    const verificationUrl = new URL(test.messages.shift()!.text.match(/https:\/\/[^\s]+/)![0]);
    await requestWithAuth(
      test.auth,
      `/verify-email?token=${encodeURIComponent(verificationUrl.searchParams.get("token")!)}&callbackURL=https%3A%2F%2Fapp.example.com`,
    );
    const user = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    const token = crypto.randomUUID();
    const timestamp = Date.now();
    await env.DB.prepare(
      "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId, assurance) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        timestamp + 60_000,
        token,
        timestamp,
        timestamp,
        user!.id,
        "password_mfa",
      )
      .run();
    const pendingDevice = await requestWithAuth(test.auth, "/device/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "unframe-unity" }),
    });
    const { device_code: deviceCode } = (await pendingDevice.json()) as DeviceCode;
    await env.DB.prepare(
      "UPDATE deviceCode SET userId = ?, status = 'approved' WHERE deviceCode = ?",
    )
      .bind(user!.id, deviceCode)
      .run();
    await env.DB.prepare(
      "INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        `2fa-${crypto.randomUUID()}`,
        user!.id,
        timestamp + 60_000,
        timestamp,
        timestamp,
      )
      .run();

    expect(
      (
        await requestWithAuth(test.auth, "/request-password-reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, redirectTo: "https://app.example.com/reset" }),
        })
      ).status,
    ).toBe(200);
    const expiredUrl = new URL(test.messages[0]!.text.match(/https:\/\/[^\s]+/)![0]);
    const expiredToken = expiredUrl.pathname.split("/").at(-1)!;
    await env.DB.prepare("UPDATE verification SET expiresAt = ? WHERE identifier = ?")
      .bind(timestamp - 1, `reset-password:${expiredToken}`)
      .run();
    const reset = (resetToken: string) =>
      requestWithAuth(test.auth, "/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword: "new-password-with-enough-length" }),
      });
    expect((await reset(expiredToken)).status).toBeGreaterThanOrEqual(400);
    expect(
      (
        await requestWithAuth(test.auth, "/request-password-reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, redirectTo: "https://app.example.com/reset" }),
        })
      ).status,
    ).toBe(200);
    const resetUrl = new URL(test.messages[1]!.text.match(/https:\/\/[^\s]+/)![0]);
    const resetToken = resetUrl.pathname.split("/").at(-1)!;
    const resetResponse = await reset(resetToken);
    expect(resetResponse.status).toBe(200);
    const remainingSessions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM session WHERE token = ?",
    )
      .bind(token)
      .first<{ count: number }>();
    expect(remainingSessions?.count).toBe(0);
    const remainingGrants = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM deviceCode WHERE userId = ?) + (SELECT COUNT(*) FROM verification WHERE value = ?) AS count",
    )
      .bind(user!.id, user!.id)
      .first<{ count: number }>();
    expect(remainingGrants?.count).toBe(0);
    expect(
      (
        await requestWithAuth(test.auth, "/device/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: "unframe-unity",
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await reset(resetToken)).status).toBeGreaterThanOrEqual(400);
  });

  it("keeps password reset responses generic when background email delivery fails", async () => {
    const setup = mailbox();
    const email = `${crypto.randomUUID()}@example.com`;
    await requestWithAuth(setup.auth, "/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password: "password-with-enough-length" }),
    });
    const tasks: Promise<unknown>[] = [];
    const backgroundAuth = createAuth(testEnvironment(), {
      mailer: async () => {
        throw new Error("delivery failed");
      },
      backgroundTaskHandler: (task) => tasks.push(task),
    });
    const requestReset = (target: string) =>
      requestWithAuth(backgroundAuth, "/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: target }),
      });

    const existing = await requestReset(email);
    const missing = await requestReset(`${crypto.randomUUID()}@example.com`);
    expect(existing.status).toBe(200);
    expect(missing.status).toBe(200);
    await expect(existing.json()).resolves.toEqual(await missing.json());
    expect(tasks).toHaveLength(1);
    await Promise.allSettled(tasks);
  });
  it("enables password authentication, email verification, and encrypted TOTP backup codes", () => {
    const options = createAuthOptions(testEnvironment(), env.DB);
    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
    });
    expect(options.account.accountLinking).toMatchObject({
      enabled: true,
      requireLocalEmailVerified: false,
    });
    expect(options.plugins.some((plugin) => plugin.id === "two-factor")).toBe(true);
  });
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

  it("does not let unverified or MFA-incomplete sessions approve a device code", async () => {
    const device = await issueDeviceCode();
    const unverified = await seedBrowserSession("user", "password_mfa", 0, 1);
    const noMfa = await seedBrowserSession("user", "password_mfa", 1, 0);
    const app = createApp();
    const claim = (cookie: string) =>
      app.fetch(
        new Request(`https://example.com/api/auth/device?user_code=${device.user_code}`, {
          headers: { cookie },
        }),
        testEnvironment() as unknown as CloudflareBindings,
      );

    expect((await claim(unverified.cookie)).status).toBe(401);
    expect((await claim(noMfa.cookie)).status).toBe(401);
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
