import { expect, test } from "@playwright/test";

test("optional two-factor authentication can be enabled and disabled from the account menu", async ({
  page,
}) => {
  let enabled = false;
  let disableFails = true;
  const user = {
    id: "user-1",
    name: "テストユーザー",
    email: "user@example.test",
    emailVerified: true,
  };
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    switch (path) {
      case "/api/auth/list-accounts":
        return route.fulfill({ json: [{ id: "account-1", providerId: "credential" }] });
      case "/api/auth/get-session":
        return route.fulfill({
          json: {
            user: { ...user, twoFactorEnabled: enabled },
            session: { id: "session-1", userId: user.id, expiresAt: "2027-10-31T00:00:00Z" },
          },
        });
      case "/api/auth/two-factor/enable":
        if (route.request().postDataJSON().password !== "password123") {
          return route.fulfill({ status: 400, json: { code: "INVALID_PASSWORD" } });
        }
        expect(route.request().postDataJSON()).toMatchObject({ password: "password123" });
        return route.fulfill({
          json: {
            method: "totp",
            totpURI: "otpauth://totp/Unframe:test?secret=JBSWY3DPEHPK3PXP&issuer=Unframe",
            backupCodes: ["backup-one", "backup-two"],
          },
        });
      case "/api/auth/two-factor/verify-totp":
        if (route.request().postDataJSON().code !== "123456") {
          return route.fulfill({ status: 400, json: { code: "INVALID_CODE" } });
        }
        enabled = true;
        return route.fulfill({
          json: { token: "test-token", user: { ...user, twoFactorEnabled: true } },
        });
      case "/api/auth/two-factor/disable":
        expect(route.request().postDataJSON()).toMatchObject({ password: "password123" });
        if (disableFails) {
          disableFails = false;
          return route.fulfill({ status: 500, json: { code: "FAILED" } });
        }
        enabled = false;
        return route.fulfill({ json: { status: true } });
      default:
        throw new Error(`Unexpected auth endpoint: ${path}`);
    }
  });
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "公開済み Dist" })).toBeVisible();
  await page.getByRole("button", { name: "アカウントメニュー" }).click();
  await page.getByRole("menuitem", { name: "セキュリティー" }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);

  const section = page.getByRole("region", { name: "二要素認証", exact: true });
  await expect(section.getByText("未設定", { exact: true })).toBeVisible();
  await expect(
    section.getByText(
      "メールアドレスとパスワードでのログインに、任意で認証アプリのコードを追加します。",
    ),
  ).toBeVisible();
  await expect(section.getByRole("button", { name: "二要素認証を無効化" })).toHaveCount(0);
  await section.getByLabel("現在のパスワード", { exact: true }).fill("wrong-password");
  await section.getByRole("button", { name: "二要素認証を設定" }).click();
  await expect(section.getByRole("alert")).toContainText("現在のパスワードを確認");
  await expect(section.getByText("未設定", { exact: true })).toBeVisible();
  await section.getByLabel("現在のパスワード", { exact: true }).fill("password123");
  await section.getByRole("button", { name: "二要素認証を設定" }).click();
  await expect(section.getByRole("img", { name: "認証アプリ登録用 QR コード" })).toBeVisible();
  await section.getByText("QR コードを読み取れない場合", { exact: true }).click();
  await expect(section.getByText("JBSWY3DPEHPK3PXP", { exact: true })).toBeVisible();
  await expect(section.getByText("backup-one", { exact: true })).toHaveCount(0);

  await section.getByLabel("認証コード", { exact: true }).fill("000000");
  await section.getByRole("button", { name: "コードを確認" }).click();
  await expect(section.getByRole("alert")).toContainText("コードを確認");
  await expect(section.getByRole("img", { name: "認証アプリ登録用 QR コード" })).toBeVisible();
  await section.getByLabel("認証コード", { exact: true }).fill("123456");
  await section.getByRole("button", { name: "コードを確認" }).click();
  await expect(section.getByText("有効", { exact: true })).toBeVisible();
  await expect(section.getByText("backup-one", { exact: true })).toBeVisible();
  await expect(section.getByRole("img", { name: "認証アプリ登録用 QR コード" })).toHaveCount(0);
  await section.getByRole("button", { name: "保存しました" }).click();
  await expect(section.getByText("backup-one", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(section.getByText("有効", { exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "二要素認証を設定" })).toHaveCount(0);

  await section.getByLabel("現在のパスワード", { exact: true }).fill("password123");
  await section.getByRole("button", { name: "二要素認証を無効化" }).click();
  await expect(section.getByRole("alert")).toContainText("無効化できませんでした");
  await expect(section.getByText("有効", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "二要素認証を無効化" }).click();
  await expect(section.getByText("未設定", { exact: true })).toBeVisible();
  await expect(section.getByLabel("現在のパスワード", { exact: true })).toBeEmpty();
  await page.reload();
  await expect(section.getByText("未設定", { exact: true })).toBeVisible();
});

test("an account with two-factor enabled completes its challenge before entering Console", async ({
  page,
}) => {
  let verified = false;
  const user = {
    id: "user-1",
    name: "テストユーザー",
    email: "user@example.test",
    emailVerified: true,
    twoFactorEnabled: true,
  };
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    switch (path) {
      case "/api/auth/get-session":
        return route.fulfill({
          json: verified ? { user, session: { id: "session-1", userId: user.id } } : null,
        });
      case "/api/auth/sign-in/email":
        return route.fulfill({ json: { twoFactorRedirect: true, twoFactorMethods: ["totp"] } });
      case "/api/auth/two-factor/verify-totp":
        return route.fulfill({ status: 400, json: { code: "INVALID_CODE" } });
      case "/api/auth/two-factor/verify-backup-code":
        expect(route.request().postDataJSON()).toEqual({ code: "backup-one", trustDevice: false });
        verified = true;
        return route.fulfill({ json: { token: "test-token", user } });
      default:
        throw new Error(`Unexpected auth endpoint: ${path}`);
    }
  });
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
  await page.goto("/login");
  await page.getByLabel("メールアドレス", { exact: true }).fill(user.email);
  await page.getByLabel("パスワード", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(
    page.getByText(
      "二要素認証が必要です。認証アプリのコード、またはバックアップコードを入力してください。",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("認証コード", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "確認", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("コードを確認");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("combobox", { name: "確認方法", exact: true }).selectOption("backup");
  await page.getByLabel("バックアップコード", { exact: true }).fill("backup-one");
  await page.getByRole("button", { name: "確認", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "公開済み Dist" })).toBeVisible();
});
