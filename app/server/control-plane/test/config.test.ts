import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { ConfigurationError, validateConfig } from "../src/config";
import { createWorker } from "../src/index";

const config = () => ({
  DB: { prepare: () => {}, batch: () => {}, exec: () => {} },
  ASSETS: { head: () => {}, get: () => {}, put: () => {}, delete: () => {}, list: () => {} },
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "https://api.example.com",
  DEVICE_CLIENT_ID: "unity-client",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  RESEND_API_KEY: "re_test_key",
  AUTH_EMAIL_FROM: "auth@example.com",
  WEB_ORIGIN: "https://app.example.com",
  R2_ACCOUNT_ID: "account-id",
  R2_BUCKET_NAME: "assets",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
});

describe("runtime configuration", () => {
  it("accepts complete runtime configuration", () => {
    expect(validateConfig(config())).toMatchObject({
      WEB_ORIGIN: "https://app.example.com",
      R2_BUCKET_NAME: "assets",
    });
  });

  it("reports only invalid field names", () => {
    expect(() =>
      validateConfig({
        ...config(),
        BETTER_AUTH_SECRET: "do-not-report-this-value",
        GOOGLE_CLIENT_ID: "",
      }),
    ).toThrow(
      "Invalid Worker configuration: BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID",
    );
  });

  it.each([
    ["BETTER_AUTH_SECRET", "short"],
    ["BETTER_AUTH_URL", "not-a-url"],
    ["DEVICE_CLIENT_ID", ""],
    ["GOOGLE_CLIENT_ID", ""],
    ["GOOGLE_CLIENT_SECRET", ""],
    ["RESEND_API_KEY", ""],
    ["AUTH_EMAIL_FROM", "not-an-email"],
    ["WEB_ORIGIN", "https://app.example.com/path"],
    ["R2_ACCOUNT_ID", "replace-with-r2-account-id"],
    ["R2_BUCKET_NAME", ""],
    ["R2_ACCESS_KEY_ID", ""],
    ["R2_SECRET_ACCESS_KEY", ""],
  ])("rejects an invalid %s", (field, value) => {
    const environment = { ...config(), [field]: value };
    expect(() => validateConfig(environment)).toThrow(ConfigurationError);
    try {
      validateConfig(environment);
    } catch (error) {
      expect(error).toMatchObject({ fields: expect.arrayContaining([field]) });
    }
  });

  it.each(["DB", "ASSETS"])("rejects a missing %s binding", (field) => {
    const environment = config();
    delete (environment as Record<string, unknown>)[field];
    expect(() => validateConfig(environment)).toThrow(ConfigurationError);
  });

  it.each([
    ["DB", { prepare: () => {}, batch: () => {}, exec: "not-a-function" }],
    [
      "ASSETS",
      { head: () => {}, get: "not-a-function", put: () => {}, delete: () => {}, list: () => {} },
    ],
  ])("rejects a structurally invalid %s binding", (field, value) => {
    expect(() => validateConfig({ ...config(), [field]: value })).toThrow(ConfigurationError);
  });

  it("rejects an invalid environment while creating the worker", () => {
    expect(() =>
      createWorker(
        { ...config(), R2_ACCOUNT_ID: "replace-with-r2-account-id" } as unknown as CloudflareBindings,
      ),
    ).toThrow(ConfigurationError);
  });

  it("rejects an invalid environment before handling a request", async () => {
    const response = await createApp().fetch(
      new Request("https://api.example.com/health"),
      { ...config(), BETTER_AUTH_SECRET: "short" } as unknown as CloudflareBindings,
    );

    expect(response.status).toBe(500);
  });
});
