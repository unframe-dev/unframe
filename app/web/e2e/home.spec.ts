import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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

test("guides users to the Local Host project", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "ローカル project を開く" })).toBeVisible();
  await expect(page.getByText(/表示された Editor URL/)).toBeVisible();
  await expect(page.getByRole("button", { name: "新規作成" })).toHaveCount(0);
});
