import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["./test/setup.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.toml",
      },
      // vitest-pool-workers 0.20.3 bundles Miniflare with support through 2026-08-01.
      miniflare: {
        compatibilityDate: "2026-08-01",
        bindings: {
          BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          RESEND_API_KEY: "re_test_key",
          AUTH_EMAIL_FROM: "auth@example.com",
          R2_ACCESS_KEY_ID: "test-r2-access-key",
          R2_SECRET_ACCESS_KEY: "test-r2-secret-access-key",
          R2_ACCOUNT_ID: "test-r2-account-id",
        },
      },
    }),
  ],
});
