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
    RESEND_API_KEY: "re_test_key",
    AUTH_EMAIL_FROM: "auth@example.com",
    WEB_ORIGIN: "https://app.example.com",
    R2_ACCOUNT_ID: "account-id",
    R2_BUCKET_NAME: "assets",
    R2_ACCESS_KEY_ID: "access-key",
    R2_SECRET_ACCESS_KEY: "secret-key",
    REALTIME_ENDPOINT: "https://realtime.example.com",
    REALTIME_ISSUER: "https://api.example.com",
    REALTIME_SIGNING_KID: "test-realtime",
    REALTIME_SIGNING_JWK:
      '{"crv":"Ed25519","d":"NpZQSdEURSFKTVz6-pzQdlaclGrXKEU63J612Pbyycw","x":"TqLQxsPp47KvbpA1ZgokEIlJdEGV3qjSoYq9F1d5AN4","kty":"OKP"}',
    SERVICE_IDENTITY_SECRET: "test-service-identity-secret-32-characters",
  }) as unknown as CloudflareBindings;
