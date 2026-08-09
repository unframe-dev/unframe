import { env } from "cloudflare:test";

export const runtimeEnvironment = () =>
  ({
    DB: env.DB,
    ASSETS: env.ASSETS,
    BETTER_AUTH_SECRET: "a".repeat(32),
    BETTER_AUTH_URL: "https://api.example.com",
    DEVICE_CLIENT_ID: "unity-client",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    WEB_ORIGIN: "https://app.example.com",
    R2_ACCOUNT_ID: "account-id",
    R2_BUCKET_NAME: "assets",
    R2_ACCESS_KEY_ID: "access-key",
    R2_SECRET_ACCESS_KEY: "secret-key",
  }) as unknown as CloudflareBindings;
