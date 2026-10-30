import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "test-user",
          name: "テストユーザー",
          email: "test@example.com",
          emailVerified: true,
          createdAt: "2026-08-17T00:00:00.000Z",
          updatedAt: "2026-08-17T00:00:00.000Z",
        },
        session: {
          id: "test-session",
          userId: "test-user",
          expiresAt: "2026-08-18T00:00:00.000Z",
          token: "test-token",
          createdAt: "2026-08-17T00:00:00.000Z",
          updatedAt: "2026-08-17T00:00:00.000Z",
        },
      }),
    }),
  );
});

test("public authentication routes and account menu are accessible", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Login." })).toBeVisible();
  await page.getByRole("link", { name: "アカウントを作成" }).click();
  await expect(page.getByRole("heading", { name: "Sign up." })).toBeVisible();
  await page.goto("/home");
  const desktopMenu = page.getByRole("button", { name: "アカウントメニュー" });
  const projectGuide = page.getByRole("heading", { name: "公開済み Dist" });
  await expect(desktopMenu).toBeVisible();
  await expect(projectGuide).toBeVisible();
  const mainNavigation = page.getByRole("navigation", {
    name: "メインナビゲーション",
  });
  for (const label of ["ホーム", "設定", "デバイス", "ルーム"]) {
    await expect(mainNavigation.getByRole("link", { name: label })).toBeVisible();
  }
  const collapseSidebar = page.getByRole("button", {
    name: "サイドバーを折り畳む",
  });
  const roomsLink = mainNavigation.getByRole("link", { name: "ルーム" });
  await roomsLink.hover();
  await expect
    .poll(() =>
      roomsLink.evaluate((element) => ({
        background: getComputedStyle(element).backgroundColor,
        color: getComputedStyle(element).color,
      })),
    )
    .toEqual({ background: "rgba(0, 0, 0, 0)", color: "rgb(48, 75, 189)" });
  await collapseSidebar.hover();
  await expect
    .poll(() => collapseSidebar.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  const collapseSidebarBox = await collapseSidebar.boundingBox();
  expect(collapseSidebarBox?.width).toBeGreaterThanOrEqual(44);
  expect(collapseSidebarBox?.height).toBeGreaterThanOrEqual(44);
  await collapseSidebar.click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("button", { name: "サイドバーを展開" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "サイドバーを展開" })).toBeVisible();
  await page.getByRole("button", { name: "サイドバーを展開" }).click();
  await expect(page.getByRole("menuitem", { name: "設定" })).toBeHidden();
  const pageWidthBeforeMenu = await page.evaluate(() => document.documentElement.clientWidth);
  await desktopMenu.click();
  const accountMenu = page.getByRole("menu");
  await expect(accountMenu).toBeVisible();
  expect(
    await accountMenu.evaluate((element) => getComputedStyle(element).transitionDuration),
  ).not.toBe("0s");
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(pageWidthBeforeMenu);
  await expect(page.getByRole("menuitem", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "ホーム" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(desktopMenu).toBeFocused();
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/home");
  const homeContentWidth = await page.locator("main#main-content").evaluate((element) => ({
    main: element.getBoundingClientRect().width,
    parent: element.parentElement?.getBoundingClientRect().width,
  }));
  expect(homeContentWidth.main).toBe(homeContentWidth.parent);
  const menu = page.getByRole("button", { name: "アカウントメニュー" });
  await menu.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "設定" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "設定" })).toBeHidden();
  await expect(menu).toBeFocused();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);

  await page.goto("/settings/profile");
  const settingsContentWidth = await page.locator("main#main-content").evaluate((element) => ({
    main: element.getBoundingClientRect().width,
    parent: element.parentElement?.getBoundingClientRect().width,
  }));
  expect(settingsContentWidth.main).toBe(settingsContentWidth.parent);
  const settingsNavigation = page.getByRole("navigation", {
    name: "設定ナビゲーション",
  });
  await expect(settingsNavigation.getByRole("link", { name: "プロフィール" })).toBeVisible();
  await expect(settingsNavigation.getByRole("link", { name: "セキュリティー" })).toBeVisible();
});

test("logout failure keeps the page and presents the error state", async ({ page }) => {
  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "SIGN_OUT_FAILED" }),
    }),
  );
  await page.goto("/home");

  await page.getByRole("button", { name: "アカウントメニュー" }).click();
  await page.getByRole("menuitem", { name: "ログアウト" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("ログアウトできませんでした。もう一度お試しください。");
  await expect(alert).toHaveCSS("color", "rgb(158, 48, 57)");
  await expect(page).toHaveURL(/\/home$/);
});

test("device authorization accepts a code", async ({ page }) => {
  await page.route("**/api/auth/device?user_code=ABCD-EFGH", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ user_code: "ABCD-EFGH", status: "pending" }),
    }),
  );
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/device?user_code=ABCD-EFGH");
  expect(
    await page
      .getByRole("heading", { name: "Connect a device." })
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("56px");
  await page.getByRole("button", { name: "コードを確認" }).click();
  await expect(page.getByRole("button", { name: "承認する" })).toBeVisible();
});

test("shows active device authorizations and links to approval without exposing credentials", async ({
  page,
}) => {
  const baseSession = {
    userId: "test-user",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    expiresAt: "2027-10-30T00:00:00.000Z",
    ipAddress: null,
  };
  await page.route("**/api/auth/list-sessions", (route) =>
    route.fulfill({
      json: [
        {
          ...baseSession,
          id: "quest-1",
          token: "secret-device-token",
          assurance: "device",
          userAgent: "Unframe Quest",
        },
        {
          ...baseSession,
          id: "browser-1",
          token: "secret-browser-token",
          assurance: "google",
          userAgent: "Desktop Chrome",
        },
        {
          ...baseSession,
          id: "expired-quest",
          token: "expired-device-token",
          assurance: "device",
          userAgent: "Expired Quest",
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "デバイス", exact: true })).toBeVisible();
  await expect(page.getByText("Unframe Quest", { exact: true })).toBeVisible();
  await expect(page.getByText("Desktop Chrome", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Expired Quest", { exact: true })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("secret-device-token");
  await page.getByRole("link", { name: "デバイスを承認" }).click();
  await expect(page.getByRole("heading", { name: "Connect a device." })).toBeVisible();
  await page.getByRole("link", { name: "デバイス一覧へ" }).click();
  await expect(page.getByText("Unframe Quest", { exact: true })).toBeVisible();
});

test("recovers the device list after an explicit retry", async ({ page }) => {
  await page.route("**/api/auth/list-sessions", (route) =>
    route.fulfill({ status: 401, json: { code: "UNAUTHORIZED" } }),
  );
  await page.goto("/devices");
  await expect(page.getByRole("alert")).toContainText("デバイスを読み込めませんでした");
  await page.route("**/api/auth/list-sessions", (route) => route.fulfill({ json: [] }));
  await page.getByRole("button", { name: "デバイス一覧を再取得" }).click();
  await expect(page.getByText("認証済みのデバイスはありません。")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
