import { expect, test, type BrowserContext } from "@playwright/test";

async function mockAccount(context: BrowserContext) {
  const account = {
    user: {
      id: "cache-user",
      name: "テストユーザー",
      email: "cache@example.test",
      emailVerified: true,
    },
    session: { id: "cache-session", userId: "cache-user", expiresAt: "2099-01-01T00:00:00.000Z" },
  };
  let signedIn = true;
  const sessionRequests: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && url.port === "4173" ? route.continue() : route.abort();
  });
  await context.route("**/api/auth/get-session", (route) => {
    sessionRequests.push(route.request().url());
    return route.fulfill({ json: signedIn ? account : null });
  });
  await context.route("**/api/auth/list-accounts", (route) => route.fulfill({ json: [] }));
  await context.route("**/api/auth/sign-out", (route) => {
    signedIn = false;
    return route.fulfill({ json: { success: true } });
  });
  await context.route("**/presentations", (route) =>
    route.fulfill({ json: { presentations: [] } }),
  );
  return {
    sessionRequests,
    currentSession: () => (signedIn ? account : null),
    expire: () => {
      signedIn = false;
    },
  };
}

test("shares one session request between the route, sidebar, profile and security", async ({
  page,
  context,
}) => {
  const server = await mockAccount(context);
  await page.goto("/home");
  await expect(page.getByText("プレゼンテーションがありません。", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "設定", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "名前", exact: true })).toHaveValue(
    "テストユーザー",
  );
  await page.getByRole("link", { name: "セキュリティー", exact: true }).click();
  await expect(page.getByRole("heading", { name: "パスワード", exact: true })).toBeVisible();
  expect(server.sessionRequests).toHaveLength(1);
});

test("updates another tab after logout without showing cached account data", async ({
  page,
  context,
}) => {
  await mockAccount(context);
  const other = await context.newPage();
  await page.goto("/home");
  await other.goto("/home");
  await expect(other.getByText("プレゼンテーションがありません。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "アカウントメニュー", exact: true }).click();
  await page.getByRole("menuitem", { name: "ログアウト", exact: true }).click();
  await expect(other).toHaveURL(/\/login$/);
  await expect(other.getByRole("heading", { name: "Login.", exact: true })).toBeVisible();
  await expect(other.getByRole("navigation", { name: "メインナビゲーション" })).toHaveCount(0);
});

test("expires the shared session when a protected API returns 401", async ({ page, context }) => {
  const server = await mockAccount(context);
  await page.goto("/home");
  await expect(page.getByText("プレゼンテーションがありません。", { exact: true })).toBeVisible();
  server.expire();
  await page.route("**/presentations", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "unauthorized" } } }),
  );
  await page.getByRole("button", { name: "公開情報を再取得", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Login.", exact: true })).toBeVisible();
});

test("keeps an incorrect-password response in the login form without session refresh loops", async ({
  page,
  context,
}) => {
  const server = await mockAccount(context);
  server.expire();
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({ status: 401, json: { code: "INVALID_EMAIL_OR_PASSWORD" } }),
  );
  await page.goto("/login");
  await page.getByLabel("メールアドレス", { exact: true }).fill("cache@example.test");
  await page.getByLabel("パスワード", { exact: true }).fill("invalid-password");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ログインできませんでした");
  await expect(page).toHaveURL(/\/login$/);
  expect(server.sessionRequests).toHaveLength(0);
});

test("refreshes an expired session after a protected auth operation returns 401", async ({
  page,
  context,
}) => {
  const server = await mockAccount(context);
  await page.goto("/settings/profile");
  const name = page.getByRole("textbox", { name: "名前", exact: true });
  await expect(name).toHaveValue("テストユーザー");
  await name.fill("更新する名前");
  server.expire();
  await page.route("**/api/auth/update-user", (route) =>
    route.fulfill({ status: 401, json: { code: "UNAUTHORIZED" } }),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(name).toHaveCount(0);
});

test("does not restore an old session response after another tab logs out", async ({
  page,
  context,
}) => {
  const server = await mockAccount(context);
  const other = await context.newPage();
  await page.goto("/home");
  await other.goto("/home");
  await expect(page.getByText("プレゼンテーションがありません。", { exact: true })).toBeVisible();
  await expect(other.getByText("プレゼンテーションがありません。", { exact: true })).toBeVisible();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  let hold = true;
  await context.route("**/api/auth/get-session", async (route) => {
    const snapshot = server.currentSession();
    if (route.request().frame().page() === page && hold) {
      hold = false;
      started();
      await waiting;
    }
    await route.fulfill({ json: snapshot });
  });
  try {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await requested;
    await other.getByRole("button", { name: "アカウントメニュー", exact: true }).click();
    await other.getByRole("menuitem", { name: "ログアウト", exact: true }).click();
    await expect(other).not.toHaveURL(/\/home$/);
    release();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Login.", exact: true })).toBeVisible();
  } finally {
    release();
  }
});
