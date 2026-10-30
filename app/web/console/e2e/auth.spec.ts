import { expect, test } from "@playwright/test";

test("email signup leads to verification, resend and login", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.route("**/api/auth/sign-up/email", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      name: "テストユーザー",
      email: "user@example.test",
      callbackURL: "http://127.0.0.1:4173/login?verified=true",
    });
    await route.fulfill({ json: { token: null, user: { id: "user-1" } } });
  });
  await page.goto("/signup");
  await page.getByLabel("名前", { exact: true }).fill("テストユーザー");
  await page.getByLabel("メールアドレス", { exact: true }).fill("user@example.test");
  await page.getByLabel("パスワード", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "登録", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("user@example.test");
  await expect(page.getByRole("button", { name: "登録", exact: true })).toHaveCount(0);

  await page.route("**/api/auth/send-verification-email", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "user@example.test",
      callbackURL: "http://127.0.0.1:4173/login?verified=true",
    });
    await route.fulfill({ status: 500, json: { code: "FAILED" } });
  });
  await page.getByRole("button", { name: "確認メールを再送" }).click();
  await expect(page.getByRole("alert")).toContainText("再送できませんでした");
  await page.route("**/api/auth/send-verification-email", (route) =>
    route.fulfill({ json: { status: true } }),
  );
  await page.getByRole("button", { name: "確認メールを再送" }).click();
  await expect(page.getByRole("status").filter({ hasText: "再送しました" })).toBeVisible();
  await page.getByRole("link", { name: "ログインへ" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("verified email login reaches Console", async ({ page }) => {
  let signedIn = false;
  const user = {
    id: "user-1",
    name: "テストユーザー",
    email: "user@example.test",
    emailVerified: true,
  };
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: signedIn
        ? { user, session: { id: "session-1", userId: user.id, expiresAt: "2027-10-31T00:00:00Z" } }
        : null,
    }),
  );
  await page.route("**/api/auth/sign-in/email", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      email: user.email,
      callbackURL: "http://127.0.0.1:4173/home",
    });
    signedIn = true;
    await route.fulfill({
      json: {
        redirect: true,
        url: route.request().postDataJSON().callbackURL,
        token: "test-token",
        user,
      },
    });
  });
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
  await page.goto("/login?verified=true");
  await expect(page.getByRole("status")).toContainText("メールアドレスを確認しました");
  await page.getByLabel("メールアドレス", { exact: true }).fill(user.email);
  await page.getByLabel("パスワード", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "公開済み Dist" })).toBeVisible();
});

test("an expired verification link offers recovery instead of a success message", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({ status: 403, json: { code: "EMAIL_NOT_VERIFIED" } }),
  );
  await page.route("**/api/auth/send-verification-email", (route) =>
    route.fulfill({ json: { status: true } }),
  );
  await page.goto("/login?verified=true&error=TOKEN_EXPIRED");
  await expect(page.getByRole("alert")).toContainText("有効期限が切れています");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByLabel("メールアドレス", { exact: true }).fill("user@example.test");
  await page.getByLabel("パスワード", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("button", { name: "確認メールを再送" }).click();
  await expect(page.getByRole("status")).toContainText("確認メールを再送しました");
});

test("Google signup can be retried and returns to Console", async ({ page }) => {
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 500, json: { code: "FAILED" } }),
  );
  await page.goto("/signup");
  await page.getByRole("button", { name: "Google で登録" }).click();
  await expect(page.getByRole("alert")).toContainText("Google 認証を開始できませんでした");
  await page.route("**/api/auth/sign-in/social", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      provider: "google",
      callbackURL: "http://127.0.0.1:4173/home",
      errorCallbackURL: "http://127.0.0.1:4173/login?provider=google",
    });
    await route.fulfill({ json: { redirect: true, url: "http://127.0.0.1:4173/home" } });
  });
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: { user: { id: "user-1", name: "Google User" }, session: { id: "session-1" } },
    }),
  );
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
  await page.getByRole("button", { name: "Google で登録" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "公開済み Dist" })).toBeVisible();
});

test("an unauthenticated Console visit leads directly to login", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in." })).toBeVisible();
});

test("a cancelled Google callback explains the failure and allows retry", async ({ page }) => {
  await page.goto("/login?provider=google&error=access_denied");
  await expect(page.getByRole("alert")).toHaveText(
    "Google 認証を完了できませんでした。もう一度お試しください。",
  );
  await expect(page.getByRole("button", { name: "Google でログイン" })).toBeEnabled();
});
