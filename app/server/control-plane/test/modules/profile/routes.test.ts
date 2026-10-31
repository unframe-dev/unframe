import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";
import {
  profilePng,
  smallPng,
  excessPixelsPng,
  invalidFilterPng,
  invalidDeflatePng,
} from "./png-fixture";

const owner = { userId: "profile-owner", globalRole: "user" as const };
const app = createApp({ identityProvider: async () => owner });
const request = (method: string, body?: Uint8Array, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request("https://api.example.com/users/me/image", {
      method,
      headers: { "content-type": "image/png", ...headers },
      ...(body ? { body } : {}),
    }),
    runtimeEnvironment(),
  );
const image = () =>
  env.DB.prepare("SELECT image FROM user WHERE id = ?")
    .bind(owner.userId)
    .first<{ image: string | null }>();

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', 'profile-owner@example.test', 1, 0, 0)",
  )
    .bind(owner.userId)
    .run();
  const objects = await env.ASSETS.list({ prefix: "user-images/" });
  await Promise.all(objects.objects.map((object) => env.ASSETS.delete(object.key)));
});

describe("profile images", () => {
  it("uploads a cropped PNG, updates the current user and serves it without credentials", async () => {
    const response = await request("PUT", profilePng);
    expect(response.status).toBe(200);
    const result = (await response.json()) as { image: string };
    expect(result.image).toMatch(
      /^https:\/\/api.example.com\/user-images\/profile-owner\/[a-f0-9-]+\.png$/,
    );
    expect(await image()).toEqual(result);
    const downloaded = await app.fetch(new Request(result.image), runtimeEnvironment());
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("image/png");
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(profilePng);
  });
  it("replaces and removes owned objects without leaving the previous image", async () => {
    const first = (await (await request("PUT", profilePng)).json()) as { image: string };
    const second = (await (await request("PUT", profilePng)).json()) as { image: string };
    expect(second.image).not.toBe(first.image);
    expect((await app.fetch(new Request(first.image), runtimeEnvironment())).status).toBe(404);
    expect((await request("DELETE")).status).toBe(200);
    expect(await image()).toEqual({ image: null });
    expect((await env.ASSETS.list({ prefix: "user-images/" })).objects).toHaveLength(0);
    expect((await request("DELETE")).status).toBe(200);
  });

  it("does not delete another user's image referenced by the current profile", async () => {
    const key = "user-images/another-user/44a9c420-20ca-4da0-bd01-204390bd0140.png";
    await env.ASSETS.put(key, profilePng);
    await env.DB.prepare("UPDATE user SET image = ? WHERE id = ?")
      .bind(`https://api.example.com/${key}`, owner.userId)
      .run();
    expect((await request("DELETE")).status).toBe(200);
    expect(await env.ASSETS.head(key)).not.toBeNull();
  });

  it("requires authentication before reading upload bodies or clearing an image", async () => {
    const anonymous = createApp({ identityProvider: async () => undefined });
    for (const method of ["PUT", "DELETE"]) {
      const result = await anonymous.fetch(
        new Request("https://api.example.com/users/me/image", { method }),
        runtimeEnvironment(),
      );
      expect(result.status).toBe(401);
    }
  });

  it("rejects cookie-authenticated writes from an untrusted origin", async () => {
    const response = await request("PUT", profilePng, {
      cookie: "session=token",
      origin: "https://attacker.example",
    });
    expect(response.status).toBe(403);
    expect(await image()).toEqual({ image: null });
  });

  it("rejects unsupported content types", async () => {
    expect((await request("PUT", profilePng, { "content-type": "image/svg+xml" })).status).toBe(
      415,
    );
  });

  it.each([
    ["incorrect dimensions", smallPng],
    ["excessive decompressed pixels", excessPixelsPng],
    ["invalid pixel filter", invalidFilterPng],
    ["invalid compressed data", invalidDeflatePng],
    ["HTML content", new TextEncoder().encode("<html>invalid</html>")],
    ["truncated PNG", profilePng.slice(0, 32)],
    ["trailing data", new Uint8Array([...profilePng, 1])],
    ["invalid header checksum", profilePng.with(29, profilePng[29]! ^ 1)],
    [
      "duplicate image header",
      new Uint8Array([...profilePng.slice(0, 33), ...profilePng.slice(8)]),
    ],
    [
      "nonconsecutive image data",
      new Uint8Array([
        ...profilePng.slice(0, -12),
        0,
        0,
        0,
        0,
        118,
        112,
        65,
        103,
        1,
        85,
        194,
        179,
        0,
        0,
        0,
        0,
        73,
        68,
        65,
        84,
        53,
        175,
        6,
        30,
        ...profilePng.slice(-12),
      ]),
    ],
    [
      "animated PNG",
      new Uint8Array([
        ...profilePng.slice(0, 33),
        0,
        0,
        0,
        8,
        97,
        99,
        84,
        76,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        180,
        45,
        233,
        160,
        ...profilePng.slice(33),
      ]),
    ],
    [
      "invalid ancillary checksum",
      new Uint8Array([
        ...profilePng.slice(0, 33),
        0,
        0,
        0,
        0,
        118,
        112,
        65,
        103,
        0,
        85,
        194,
        179,
        ...profilePng.slice(33),
      ]),
    ],
  ])("rejects %s without storing it", async (_description, bytes) => {
    expect((await request("PUT", bytes)).status).toBe(400);
    expect(await image()).toEqual({ image: null });
    expect((await env.ASSETS.list({ prefix: "user-images/" })).objects).toHaveLength(0);
  });

  it("enforces the body size limit without Content-Length", async () => {
    const body = new Uint8Array(2 * 1024 * 1024 + 1);
    expect((await request("PUT", body)).status).toBe(413);
    expect(await image()).toEqual({ image: null });
  });

  it("returns one winner for concurrent replacements and keeps the winner's object", async () => {
    const responses = await Promise.all([request("PUT", profilePng), request("PUT", profilePng)]);
    expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(
      true,
    );
    expect(responses.some((response) => response.status === 200)).toBe(true);
    const current = await image();
    expect(current?.image).toBeTruthy();
    const stored = await env.ASSETS.list({ prefix: "user-images/" });
    expect(stored.objects).toHaveLength(1);
    expect(current?.image).toBe(`https://api.example.com/${stored.objects[0]?.key}`);
  });
  it("removes a new R2 object when the profile database update fails", async () => {
    await env.DB.exec(
      "CREATE TRIGGER fail_profile_image_update BEFORE UPDATE OF image ON user BEGIN SELECT RAISE(ABORT, 'test update failure'); END",
    );
    try {
      expect((await request("PUT", profilePng)).status).toBe(500);
      expect(await image()).toEqual({ image: null });
      expect((await env.ASSETS.list({ prefix: "user-images/" })).objects).toHaveLength(0);
    } finally {
      await env.DB.exec("DROP TRIGGER fail_profile_image_update");
    }
  });

  it("exposes the updated image through the actual auth session", async () => {
    const timestamp = Date.now();
    const token = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId, assurance) VALUES (?, ?, ?, ?, ?, ?, 'password')",
    )
      .bind(crypto.randomUUID(), timestamp + 60_000, token, timestamp, timestamp, owner.userId)
      .run();
    const actualApp = createApp();
    const uploaded = await actualApp.fetch(
      new Request("https://api.example.com/users/me/image", {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "image/png" },
        body: profilePng,
      }),
      runtimeEnvironment(),
    );
    expect(uploaded.status).toBe(200);
    const updated = (await uploaded.json()) as { image: string };
    const session = await actualApp.fetch(
      new Request("https://api.example.com/api/auth/get-session", {
        headers: { authorization: `Bearer ${token}` },
      }),
      runtimeEnvironment(),
    );
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      user: { id: owner.userId, image: updated.image },
    });
  });
});
