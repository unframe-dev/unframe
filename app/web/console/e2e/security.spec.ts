import { expect, test } from "@playwright/test";

test("a Google-only account can set a password by email without being asked for a current password", async ({
  page,
}) => {
  let sendingFails = true;
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    switch (path) {
      case "/api/auth/get-session":
        return route.fulfill({
          json: {
            user: { id: "google-user", email: "google@example.test", twoFactorEnabled: false },
            session: { id: "session-1" },
          },
        });
      case "/api/auth/list-accounts":
        return route.fulfill({ json: [{ id: "account-1", providerId: "google" }] });
      case "/api/auth/request-password-reset":
        expect(route.request().postDataJSON()).toEqual({
          email: "google@example.test",
          redirectTo: "http://127.0.0.1:4173/recover/reset",
        });
        if (sendingFails) {
          sendingFails = false;
          return route.fulfill({ status: 500, json: { code: "FAILED" } });
        }
        return route.fulfill({ json: { status: true } });
      default:
        throw new Error(`Unexpected auth endpoint: ${path}`);
    }
  });
  await page.goto("/settings/security");
  const password = page.getByRole("region", { name: "パスワード", exact: true });
  await expect(password.getByText("Unframe用のパスワードは未設定です。")).toBeVisible();
  await expect(page.getByLabel("現在のパスワード", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "パスワードを変更" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "二要素認証を設定" })).toHaveCount(0);
  const googleSecurity = page.getByRole("link", { name: "Googleのセキュリティー設定" });
  await expect(googleSecurity).toHaveAttribute("href", "https://myaccount.google.com/security");
  const send = password.getByRole("button", { name: "パスワード設定メールを送信" });
  await send.click();
  await expect(password.getByRole("alert")).toContainText("送信できませんでした");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(password.getByRole("status")).toContainText("設定メールを送信しました");
  await expect(send).toBeDisabled();
});

test("an account linked to Google and a password retains password and two-factor management", async ({
  page,
}) => {
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    switch (path) {
      case "/api/auth/get-session":
        return route.fulfill({
          json: {
            user: { id: "linked-user", email: "linked@example.test", twoFactorEnabled: true },
            session: { id: "session-1" },
          },
        });
      case "/api/auth/list-accounts":
        return route.fulfill({
          json: [
            { id: "account-google", providerId: "google" },
            { id: "account-password", providerId: "credential" },
          ],
        });
      default:
        throw new Error(`Unexpected auth endpoint: ${path}`);
    }
  });
  await page.goto("/settings/security");
  await expect(page.getByRole("button", { name: "パスワードを変更" })).toBeVisible();
  await expect(page.getByLabel("現在のパスワード", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "パスワード設定メールを送信" })).toHaveCount(0);
  const mfa = page.getByRole("region", { name: "二要素認証", exact: true });
  await expect(mfa.getByText("有効", { exact: true })).toBeVisible();
  await expect(mfa.getByRole("button", { name: "二要素認証を無効化" })).toBeVisible();
  await expect(mfa.getByRole("link", { name: "Googleのセキュリティー設定" })).toBeVisible();
});

test("a failed account lookup offers retry without assuming a password is missing", async ({
  page,
}) => {
  let lookupFails = true;
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    switch (path) {
      case "/api/auth/get-session":
        return route.fulfill({
          json: {
            user: { id: "user-1", email: "user@example.test", twoFactorEnabled: false },
            session: { id: "session-1" },
          },
        });
      case "/api/auth/list-accounts":
        if (lookupFails) {
          return route.fulfill({ status: 500, json: { code: "FAILED" } });
        }
        return route.fulfill({ json: [{ id: "account-1", providerId: "credential" }] });
      default:
        throw new Error(`Unexpected auth endpoint: ${path}`);
    }
  });
  await page.goto("/settings/security");
  await expect(page.getByRole("alert")).toContainText("認証設定を読み込めませんでした");
  await expect(page.getByRole("button", { name: "パスワード設定メールを送信" })).toHaveCount(0);
  await expect(page.getByLabel("現在のパスワード", { exact: true })).toHaveCount(0);
  lookupFails = false;
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByRole("button", { name: "パスワードを変更" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
