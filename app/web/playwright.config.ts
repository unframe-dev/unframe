import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const baseURL = "http://127.0.0.1:4173";
const nixChrome = "/run/current-system/sw/bin/google-chrome";
const executablePath =
  process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] ??
  (existsSync(nixChrome) ? nixChrome : undefined);
const isCI = Boolean(process.env["CI"]);

export default defineConfig({
  forbidOnly: isCI,
  fullyParallel: false,
  projects: [
    {
      grepInvert: /@webgl-fallback/,
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader-webgl"],
          ...(executablePath ? { executablePath } : {}),
        },
      },
    },
    {
      grep: /@webgl-fallback/,
      name: "chromium-no-webgl",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--disable-webgl"],
          ...(executablePath ? { executablePath } : {}),
        },
      },
    },
  ],
  reporter: isCI ? "github" : "list",
  retries: isCI ? 1 : 0,
  testDir: "./e2e",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm run dev:e2e",
    reuseExistingServer: !isCI,
    timeout: 120_000,
    url: `${baseURL}/`,
  },
});
