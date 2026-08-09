import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["./test/setup.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      // vitest-pool-workers 0.20.3 bundles Miniflare with support through 2026-08-01.
      miniflare: {
        compatibilityDate: "2026-08-01",
      },
    }),
  ],
});
