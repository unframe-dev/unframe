import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/test/**/*.test.{ts,tsx}", "scripts/test/**/*.test.ts"],
  },
});
