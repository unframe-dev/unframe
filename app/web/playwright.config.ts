import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const baseURL = "http://127.0.0.1:4173";
const nixChrome = "/run/current-system/sw/bin/google-chrome";
const executablePath =
  process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] ??
  (existsSync(nixChrome) ? nixChrome : undefined);
const isCI = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? "github" : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm run dev:e2e",
    url: `${baseURL}/editor/`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@webgl-fallback/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader-webgl"],
          ...(executablePath ? { executablePath } : {}),
        },
      },
    },
    {
      name: "chromium-no-webgl",
      grep: /@webgl-fallback/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--disable-webgl"],
          ...(executablePath ? { executablePath } : {}),
        },
      },
    },
  ],
});
