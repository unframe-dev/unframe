import { expect, test } from "@playwright/test";

for (const signedIn of [true, false]) {
  test(`shows a page skeleton while checking ${signedIn ? "an authenticated" : "an anonymous"} session`, async ({
    page,
  }, testInfo) => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "127.0.0.1" && url.port === "4173" ? route.continue() : route.abort();
    });
    await page.route("**/api/auth/get-session", async (route) => {
      await waiting;
      await route.fulfill({
        json: signedIn
          ? {
              user: { id: "loading-user", name: "テストユーザー", emailVerified: true },
              session: { id: "loading-session", expiresAt: "2099-01-01T00:00:00.000Z" },
            }
          : null,
      });
    });
    await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
    try {
      await page.goto("/home");
      const loading = page.getByRole("status", { name: "ページを読み込んでいます…", exact: true });
      await expect(loading).toBeVisible();
      await expect(loading.locator('[data-slot="skeleton"]').first()).toBeVisible();
      await expect(loading).toHaveText("");
      await expect(loading.getByRole("link")).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(loading.locator('[data-slot="skeleton"]').first()).toHaveCSS(
        "animation-name",
        "none",
      );
      await page.setViewportSize({ width: 375, height: 800 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("navigation-skeleton-mobile.png") });
      release();
      await expect(
        page.getByRole("heading", {
          name: signedIn ? "公開済みプレゼンテーション" : "Login.",
          exact: true,
        }),
      ).toBeVisible();
      await expect(loading).toHaveCount(0);
      await expect(page).toHaveURL(signedIn ? /\/home$/ : /\/login$/);
    } finally {
      release();
    }
  });
}

test("shows a skeleton when a protected navigation must refresh the session", async ({ page }) => {
  const initialTime = new Date("2026-11-01T00:00:00.000Z");
  await page.clock.setFixedTime(initialTime);
  let waiting: Promise<void> | undefined;
  let release!: () => void;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && url.port === "4173" ? route.continue() : route.abort();
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await waiting;
    await route.fulfill({
      json: {
        user: { id: "navigation-user", name: "テストユーザー", emailVerified: true },
        session: { id: "navigation-session", expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    });
  });
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
  await page.route("**/api/auth/list-sessions", (route) => route.fulfill({ json: [] }));
  await page.goto("/home");
  await expect(page.getByText("プレゼンテーションがありません。", { exact: true })).toBeVisible();
  waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.clock.setFixedTime(new Date(initialTime.getTime() + 61_000));
  try {
    await page.getByRole("link", { name: "デバイス", exact: true }).click();
    const loading = page.getByRole("status", { name: "ページを読み込んでいます…", exact: true });
    await expect(loading).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "デバイス", exact: true })).toBeVisible();
    await expect(loading).toHaveCount(0);
  } finally {
    release();
  }
});
