import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, createOpenAPIDocument } from "../src/app";
import { runtimeEnvironment } from "./runtime-environment";

const jsonRoutes = Object.entries(createOpenAPIDocument().paths).flatMap(([path, methods]) =>
  Object.entries(methods ?? {}).flatMap(([method, operation]) =>
    operation &&
    typeof operation === "object" &&
    "requestBody" in operation &&
    operation.requestBody &&
    "content" in operation.requestBody &&
    operation.requestBody.content["application/json"]
      ? [{ method: method.toUpperCase(), path: path.replace(/\{[^}]+\}/g, "1") }]
      : [],
  ),
);

describe("JSON request media types", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('owner', 'Owner', 'json-owner@example.test', 1, 0, 0)",
      ),
      env.DB.prepare(
        "INSERT OR IGNORE INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES ('1', 'owner', 1, '{}', '2026', '2026')",
      ),
      env.DB.prepare(
        "INSERT OR IGNORE INTO presentation_members (presentation_id, user_id, role) VALUES ('1', 'owner', 'owner')",
      ),
    ]);
  });
  it.each(jsonRoutes)(
    "returns the JSON validation contract for $method $path with a different media type",
    async ({ method, path }) => {
      const app = createApp({
        identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
      });
      const init: RequestInit = {
        method,
        headers: {
          "content-type": "text/plain",
          authorization: "Bearer test-service-identity-secret-32-characters",
        },
        body: "{}",
      };
      const response = await app.fetch(
        new Request(`https://example.com${path}`, init),
        runtimeEnvironment(),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_error" } });
    },
  );

  it.each(jsonRoutes)(
    "rejects a missing required body for $method $path",
    async ({ method, path }) => {
      const response = await createApp({
        identityProvider: async () => ({ userId: "owner", globalRole: "user" }),
      }).fetch(
        new Request(`https://example.com${path}`, {
          method,
          headers: { authorization: "Bearer test-service-identity-secret-32-characters" },
        }),
        runtimeEnvironment(),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_error" } });
    },
  );

  it.each([
    "/callbacks/checkpoints",
    "/callbacks/completions",
    "/assets/uploads",
    "/presentations/1/builds",
  ])("authenticates %s before validating its body", async (path) => {
    const response = await createApp().fetch(
      new Request(`https://example.com${path}`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
      runtimeEnvironment(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });
});
