import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { REALTIME_AUDIENCE: "unframe-realtime-runtime" },
    setupFiles: ["./test/setup.ts"],
    include: ["./test/**/*.test.ts"],
    exclude: ["./test/startup.test.ts"],
    testTimeout: 30_000,
    maxWorkers: 4,
  },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.toml",
      },
      // vitest-pool-workers 0.20.3 bundles Miniflare with support through 2026-08-01.
      miniflare: {
        compatibilityDate: "2026-08-01",
        bindings: {
          WEB_ORIGIN: "https://un-fra.me",
          BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
          BETTER_AUTH_API_KEY: "test-api-key",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          RESEND_API_KEY: "re_test_key",
          AUTH_EMAIL_FROM: "auth@example.com",
          R2_ACCESS_KEY_ID: "test-r2-access-key",
          R2_SECRET_ACCESS_KEY: "test-r2-secret-access-key",
          R2_ACCOUNT_ID: "test-r2-account-id",
          REALTIME_AUDIENCE: "unframe-realtime-runtime",
          REALTIME_SIGNING_JWK:
            '{"crv":"Ed25519","d":"NpZQSdEURSFKTVz6-pzQdlaclGrXKEU63J612Pbyycw","x":"TqLQxsPp47KvbpA1ZgokEIlJdEGV3qjSoYq9F1d5AN4","kty":"OKP"}',
          SERVICE_IDENTITY_SECRET: "test-service-identity-secret-32-characters",
        },
      },
    }),
  ],
});
