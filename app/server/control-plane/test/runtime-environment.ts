import { env } from "cloudflare:test";

export const runtimeEnvironment = () =>
  ({
    ASSETS: env.ASSETS,
    AUTH_EMAIL_FROM: "auth@example.com",
    BETTER_AUTH_API_KEY: "test-api-key",
    BETTER_AUTH_SECRET: "a".repeat(32),
    BETTER_AUTH_URL: "https://api.example.com",
    DB: env.DB,
    DEVICE_CLIENT_ID: "unity-client",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    R2_ACCESS_KEY_ID: "access-key",
    R2_ACCOUNT_ID: "account-id",
    R2_BUCKET_NAME: "assets",
    R2_SECRET_ACCESS_KEY: "secret-key",
    REALTIME_AUDIENCE: "unframe-realtime-runtime",
    REALTIME_ISSUER: "https://api.example.com",
    REALTIME_SIGNING_JWK:
      '{"crv":"Ed25519","d":"NpZQSdEURSFKTVz6-pzQdlaclGrXKEU63J612Pbyycw","x":"TqLQxsPp47KvbpA1ZgokEIlJdEGV3qjSoYq9F1d5AN4","kty":"OKP"}',
    REALTIME_SIGNING_KID: "test-realtime",
    RESEND_API_KEY: "re_test_key",
    SERVICE_IDENTITY_SECRET: "test-service-identity-secret-32-characters",
    WEB_ORIGIN: "https://app.example.com",
  }) as unknown as CloudflareBindings;
