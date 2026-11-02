import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { createAuth, createAuthOptions } from "../../src/auth/options";
import type { AuthMailer } from "../../src/auth/mail";

const testEnvironment = () => ({
  DB: env.DB,
  BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
  BETTER_AUTH_URL: "https://example.com",
  BETTER_AUTH_API_KEY: "test-api-key",
  DEVICE_CLIENT_ID: "unframe-unity",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  RESEND_API_KEY: "re_test_key",
  AUTH_EMAIL_FROM: "auth@example.com",
  WEB_ORIGIN: "https://un-fra.me",
  ASSETS: { head: () => {}, get: () => {}, put: () => {}, delete: () => {}, list: () => {} },
  R2_ACCOUNT_ID: "test-r2-account-id",
  R2_BUCKET_NAME: "assets",
  R2_ACCESS_KEY_ID: "test-r2-access-key",
  R2_SECRET_ACCESS_KEY: "test-r2-secret-access-key",
  REALTIME_ISSUER: "https://api.example.com",
  REALTIME_AUDIENCE: "unframe-realtime-runtime",
  REALTIME_SIGNING_KID: "test-realtime",
  REALTIME_SIGNING_JWK:
    '{"crv":"Ed25519","d":"NpZQSdEURSFKTVz6-pzQdlaclGrXKEU63J612Pbyycw","x":"TqLQxsPp47KvbpA1ZgokEIlJdEGV3qjSoYq9F1d5AN4","kty":"OKP"}',
  SERVICE_IDENTITY_SECRET: "test-service-identity-secret-32-characters",
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

const responseCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");

const presentationsWith = (headers: HeadersInit) =>
  createApp().fetch(
    new Request("https://example.com/presentations", { headers }),
    testEnvironment() as unknown as CloudflareBindings,
  );

async function completeGoogleSignIn(customAuth: ReturnType<typeof createAuth>, email: string) {
  const profile = { sub: crypto.randomUUID(), email, email_verified: true, name: "Google User" };
  const idToken = `eyJhbGciOiJSUzI1NiJ9.${btoa(JSON.stringify(profile))}.test-signature`;
  const originalFetch = globalThis.fetch;
  const providerFetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Promise.resolve(
        Response.json({
          access_token: "test-google-token",
          token_type: "Bearer",
          id_token: idToken,
        }),
      );
    }
    return originalFetch(input, init);
  });
  try {
    const signIn = await requestWithAuth(customAuth, "/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "https://un-fra.me/device",
        disableRedirect: true,
      }),
    });
    expect(signIn.status).toBe(200);
    const authorization = new URL(((await signIn.json()) as { url: string }).url);
    const stateCookie = signIn.headers.get("set-cookie")!.split(";", 1)[0]!;
    return await requestWithAuth(
      customAuth,
      `/callback/google?code=test-code&state=${authorization.searchParams.get("state")}`,
      { headers: { cookie: stateCookie } },
    );
  } finally {
    providerFetch.mockRestore();
  }
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
  userId: string = crypto.randomUUID(),
) {
  const timestamp = Date.now();
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
    headers: { "content-type": "application/json", cookie, origin: "https://un-fra.me" },
    body: JSON.stringify({ userCode }),
  });
}

describe("profile image ownership", () => {
  it.each([null, "https://elsewhere.example/avatar.png"])(
    "rejects generic image changes (%s) without losing the owned image reference",
    async (image) => {
      const session = await seedBrowserSession();
      const current = `https://example.com/user-images/${session.userId}/${crypto.randomUUID()}.png`;
      await env.DB.prepare("UPDATE user SET image = ? WHERE id = ?")
        .bind(current, session.userId)
        .run();
      const response = await requestAuth("/update-user", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ image }),
      });
      expect(response.status).toBe(400);
      expect(
        await env.DB.prepare("SELECT image FROM user WHERE id = ?").bind(session.userId).first(),
      ).toEqual({ image: current });
    },
  );

  it("continues to allow name changes through the generic user API", async () => {
    const session = await seedBrowserSession();
    const response = await requestAuth("/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(response.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT name FROM user WHERE id = ?").bind(session.userId).first(),
    ).toEqual({ name: "New Name" });
  });
});

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
      `/verify-email?token=${encodeURIComponent(verification.searchParams.get("token")!)}&callbackURL=https%3A%2F%2Fun-fra.me`,
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
        origin: "https://un-fra.me",
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
            origin: "https://un-fra.me",
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
    expect((await presentationsWith({ cookie: challengeCookie })).status).toBe(401);
    const verified = await requestWithAuth(test.auth, "/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: challengeCookie,
        origin: "https://un-fra.me",
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
      session: { assurance: "password" },
      user: { email, twoFactorEnabled: true },
    });
    expect((await presentationsWith({ authorization: `Bearer ${bearerToken}` })).status).toBe(200);
    const trustedCookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const trustedSignIn = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: trustedCookie,
        origin: "https://un-fra.me",
      },
      body: JSON.stringify({ email, password }),
    });
    expect(trustedSignIn.status).toBe(200);
    expect(await trustedSignIn.json()).not.toMatchObject({ twoFactorRedirect: true });
    expect((await presentationsWith({ cookie: responseCookie(trustedSignIn) })).status).toBe(200);

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
          origin: "https://un-fra.me",
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
          origin: "https://un-fra.me",
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
        origin: "https://un-fra.me",
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

    const disabled = await requestWithAuth(test.auth, "/two-factor/disable", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: trustedCookie,
        origin: "https://un-fra.me",
      },
      body: JSON.stringify({ password }),
    });
    expect(disabled.status).toBe(200);
    const disabledCookie = responseCookie(disabled);
    expect((await presentationsWith({ cookie: disabledCookie })).status).toBe(200);
    const disabledSession = await requestWithAuth(test.auth, "/get-session", {
      headers: { cookie: disabledCookie },
    });
    await expect(disabledSession.json()).resolves.toMatchObject({
      session: { assurance: "password" },
      user: { twoFactorEnabled: false },
    });
    const passwordOnly = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(await passwordOnly.json()).not.toMatchObject({ twoFactorRedirect: true });
    expect((await presentationsWith({ cookie: responseCookie(passwordOnly) })).status).toBe(200);
  });
  it("allows verified password users to access presentations without enrolling MFA", async () => {
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
      `/verify-email?token=${encodeURIComponent(verificationUrl.searchParams.get("token")!)}&callbackURL=https%3A%2F%2Fun-fra.me`,
    );
    expect(verified.status).toBe(302);

    const afterVerification = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(afterVerification.status).toBe(200);
    const cookie = responseCookie(afterVerification);
    const presentations = await presentationsWith({ cookie });
    expect(presentations.status).toBe(200);
    const session = await requestWithAuth(test.auth, "/get-session", { headers: { cookie } });
    await expect(session.json()).resolves.toMatchObject({
      session: { assurance: "password" },
      user: { emailVerified: true, twoFactorEnabled: false },
    });
  });

  it("keeps presentation access after changing a password and replacing sessions", async () => {
    const test = mailbox();
    const email = `${crypto.randomUUID()}@example.com`;
    const password = "password-with-enough-length";
    await requestWithAuth(test.auth, "/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password }),
    });
    await env.DB.prepare("UPDATE user SET emailVerified = 1 WHERE email = ?").bind(email).run();
    const signedIn = await requestWithAuth(test.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const previousCookie = responseCookie(signedIn);
    const changed = await requestWithAuth(test.auth, "/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: previousCookie,
        origin: "https://un-fra.me",
      },
      body: JSON.stringify({
        currentPassword: password,
        newPassword: "another-long-password",
        revokeOtherSessions: true,
      }),
    });
    expect(changed.status).toBe(200);
    expect((await presentationsWith({ cookie: previousCookie })).status).toBe(401);
    expect((await presentationsWith({ cookie: responseCookie(changed) })).status).toBe(200);
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
      `/verify-email?token=${encodeURIComponent(verificationUrl.searchParams.get("token")!)}&callbackURL=https%3A%2F%2Fun-fra.me`,
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
        "password",
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
          body: JSON.stringify({ email, redirectTo: "https://un-fra.me/reset" }),
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
          body: JSON.stringify({ email, redirectTo: "https://un-fra.me/reset" }),
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
    expect(tasks.length).toBeGreaterThan(0);
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
      requireLocalEmailVerified: true,
    });
    expect(options.plugins.some((plugin) => plugin.id === "two-factor")).toBe(true);
  });
  it("configures Dash with the API key without enabling activity tracking", () => {
    const options = createAuthOptions(testEnvironment(), env.DB);
    const dashPlugin = options.plugins.find((plugin) => plugin.id === "dash");

    expect(dashPlugin).toMatchObject({ options: { apiKey: "test-api-key" } });
    expect(dashPlugin?.options.activityTracking).not.toMatchObject({ enabled: true });
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

  it("issues a code with the configured expiry, polling interval, and verification URIs", async () => {
    const response = await auth().handler(
      new Request("https://example.com/api/auth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: "unframe-unity" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      expires_in: number;
      interval: number;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
    };
    expect(body).toMatchObject({
      verification_uri: "https://un-fra.me/device",
      expires_in: 1800,
      interval: 3,
    });
    expect(body.verification_uri_complete).toBe(
      `https://un-fra.me/device?user_code=${encodeURIComponent(body.user_code)}`,
    );
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

  it("requires a verified email and recognized sign-in method to approve a device code", async () => {
    const device = await issueDeviceCode();
    const unverified = await seedBrowserSession("user", "password", 0, 1);
    const unknownMethod = await seedBrowserSession("user", "none", 1, 0);
    const password = await seedBrowserSession("user", "password", 1, 0);
    const app = createApp();
    const claim = (cookie: string) =>
      app.fetch(
        new Request(`https://example.com/api/auth/device?user_code=${device.user_code}`, {
          headers: { cookie },
        }),
        testEnvironment() as unknown as CloudflareBindings,
      );

    expect((await claim(unverified.cookie)).status).toBe(401);
    expect((await claim(unknownMethod.cookie)).status).toBe(401);
    expect((await claim(password.cookie)).status).toBe(200);
  });

  it("refuses to link Google to an unverified password account or activate its password", async () => {
    const setup = mailbox();
    const email = `${crypto.randomUUID()}@example.com`;
    const password = "password-with-enough-length";
    const signUp = await requestWithAuth(setup.auth, "/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password }),
    });
    expect(signUp.status).toBe(200);

    const callback = await completeGoogleSignIn(setup.auth, email);
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get("location")!).searchParams.get("error")).toBe(
      "account_not_linked",
    );
    expect(
      await env.DB.prepare("SELECT emailVerified FROM user WHERE email = ?").bind(email).first(),
    ).toMatchObject({ emailVerified: 0 });
    expect(
      await env.DB.prepare(
        "SELECT account.id FROM account JOIN user ON account.userId = user.id WHERE user.email = ? AND account.providerId = 'google'",
      )
        .bind(email)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT session.id FROM session JOIN user ON session.userId = user.id WHERE user.email = ?",
      )
        .bind(email)
        .first(),
    ).toBeNull();
    const passwordSignIn = await requestWithAuth(setup.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(passwordSignIn.status).toBe(403);
  });

  it("links Google to the same password user after local email verification", async () => {
    const setup = mailbox();
    const email = `${crypto.randomUUID()}@example.com`;
    const signUp = await requestWithAuth(setup.auth, "/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test User", email, password: "password-with-enough-length" }),
    });
    expect(signUp.status).toBe(200);
    const signedUp = (await signUp.json()) as { user: { id: string } };
    const verification = new URL(setup.messages[0]!.text.match(/https:\/\/[^\s]+/)![0]);
    const verified = await requestWithAuth(
      setup.auth,
      `/verify-email?token=${encodeURIComponent(verification.searchParams.get("token")!)}&callbackURL=https%3A%2F%2Fun-fra.me`,
    );
    expect(verified.status).toBe(302);

    const callback = await completeGoogleSignIn(setup.auth, email);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("https://un-fra.me/device");
    expect(
      await env.DB.prepare("SELECT userId FROM account WHERE providerId = 'google' AND userId = ?")
        .bind(signedUp.user.id)
        .first(),
    ).toMatchObject({ userId: signedUp.user.id });
    expect(
      await env.DB.prepare("SELECT userId, assurance FROM session WHERE userId = ?")
        .bind(signedUp.user.id)
        .first(),
    ).toMatchObject({ userId: signedUp.user.id, assurance: "google" });
    const accountsResponse = await requestWithAuth(setup.auth, "/list-accounts", {
      headers: { cookie: responseCookie(callback) },
    });
    expect(accountsResponse.status).toBe(200);
    const accounts = (await accountsResponse.json()) as { providerId: string }[];
    expect(accounts.map((account) => account.providerId).sort()).toEqual(["credential", "google"]);
  });

  it("sets an initial password through email recovery for a Google user and enrolls MFA", async () => {
    const setup = mailbox();
    const email = `${crypto.randomUUID()}@example.com`;
    const password = "initial-password-with-enough-length";
    const callback = await completeGoogleSignIn(setup.auth, email);
    expect(callback.status).toBe(302);
    const googleCookie = responseCookie(callback);
    const initialAccounts = await requestWithAuth(setup.auth, "/list-accounts", {
      headers: { cookie: googleCookie },
    });
    expect(initialAccounts.status).toBe(200);
    const googleAccounts = (await initialAccounts.json()) as { providerId: string }[];
    expect(googleAccounts.map((account) => account.providerId)).toEqual(["google"]);

    const requested = await requestWithAuth(setup.auth, "/request-password-reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: googleCookie,
        origin: "https://un-fra.me",
      },
      body: JSON.stringify({ email, redirectTo: "https://un-fra.me/reset" }),
    });
    expect(requested.status).toBe(200);
    expect(setup.messages).toHaveLength(1);
    expect(setup.messages[0]?.to).toBe(email);
    const resetLink = new URL(setup.messages[0]!.text.match(/https:\/\/[^\s]+/)![0]);
    const followed = await requestWithAuth(
      setup.auth,
      `${resetLink.pathname.slice("/api/auth".length)}${resetLink.search}`,
    );
    expect(followed.status).toBe(302);
    const resetPage = new URL(followed.headers.get("location")!);
    expect(`${resetPage.origin}${resetPage.pathname}`).toBe("https://un-fra.me/reset");
    const reset = await requestWithAuth(setup.auth, "/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: resetPage.searchParams.get("token"), newPassword: password }),
    });
    expect(reset.status).toBe(200);
    expect((await presentationsWith({ cookie: googleCookie })).status).toBe(401);
    expect(
      (await requestWithAuth(setup.auth, "/list-accounts", { headers: { cookie: googleCookie } }))
        .status,
    ).toBe(401);

    const signedIn = await requestWithAuth(setup.auth, "/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(signedIn.status).toBe(200);
    const passwordCookie = responseCookie(signedIn);
    expect((await presentationsWith({ cookie: passwordCookie })).status).toBe(200);
    const linkedAccounts = await requestWithAuth(setup.auth, "/list-accounts", {
      headers: { cookie: passwordCookie },
    });
    expect(linkedAccounts.status).toBe(200);
    const accounts = (await linkedAccounts.json()) as { providerId: string }[];
    expect(accounts.map((account) => account.providerId).sort()).toEqual(["credential", "google"]);

    const enabled = await requestWithAuth(setup.auth, "/two-factor/enable", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: passwordCookie,
        origin: "https://un-fra.me",
      },
      body: JSON.stringify({ password }),
    });
    expect(enabled.status).toBe(200);
    const enrollment = (await enabled.json()) as { totpURI: string };
    const verified = await requestWithAuth(setup.auth, "/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: passwordCookie,
        origin: "https://un-fra.me",
      },
      body: JSON.stringify({ code: await totpCode(enrollment.totpURI) }),
    });
    expect(verified.status).toBe(200);
    const session = await requestWithAuth(setup.auth, "/get-session", {
      headers: { cookie: responseCookie(verified) },
    });
    await expect(session.json()).resolves.toMatchObject({
      user: { email, emailVerified: true, twoFactorEnabled: true },
    });
  });

  it("requires a current session to list linked accounts", async () => {
    const response = await requestAuth("/list-accounts");

    expect(response.status).toBe(401);
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

  it("establishes Google assurance through the OAuth callback and allows device authorization", async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const callback = await completeGoogleSignIn(auth(), email);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("https://un-fra.me/device");
    const stored = await env.DB.prepare(
      "SELECT session.assurance FROM session JOIN user ON session.userId = user.id WHERE user.email = ?",
    )
      .bind(email)
      .first();
    expect(stored).toMatchObject({ assurance: "google" });
    const cookie = callback.headers
      .get("set-cookie")!
      .split(",")
      .map((value) => value.trim().split(";", 1)[0])
      .find((value) => value?.startsWith("__Secure-better-auth.session_token="));
    expect(cookie).toBeTruthy();
    const device = await issueDeviceCode();
    const response = await createApp().fetch(
      new Request(`https://example.com/api/auth/device?user_code=${device.user_code}`, {
        headers: { cookie: cookie! },
      }),
      testEnvironment() as unknown as CloudflareBindings,
    );
    expect(response.status).toBe(200);
    const approval = await createApp().fetch(
      new Request("https://example.com/api/auth/device/approve", {
        method: "POST",
        headers: {
          cookie: cookie!,
          "content-type": "application/json",
          origin: "https://un-fra.me",
        },
        body: JSON.stringify({ userCode: device.user_code }),
      }),
      testEnvironment() as unknown as CloudflareBindings,
    );
    expect(approval.status).toBe(200);
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

    const allowed = await request("https://un-fra.me");
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://un-fra.me");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("access-control-expose-headers")).toBe("set-auth-token,ETag");

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

    const deviceList = await requestAuth("/list-sessions", { headers: { cookie: browser.cookie } });
    expect(deviceList.status).toBe(200);
    expect(await deviceList.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assurance: "device", userId: browser.userId }),
        expect.objectContaining({ assurance: "google", userId: browser.userId }),
      ]),
    );

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

  it("rejects anonymous viewer sessions even when the email and sign-in method are populated", async () => {
    const viewer = await seedBrowserSession(
      "user",
      "password",
      1,
      0,
      `anonymous_${crypto.randomUUID()}`,
    );

    expect((await presentationsWith({ cookie: viewer.cookie })).status).toBe(401);
    expect((await presentationsWith({ authorization: `Bearer ${viewer.token}` })).status).toBe(401);
  });
});
