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

test("mock Presentation 一覧をAPI通信なしで表示する", async ({ page }) => {
  let presentationRequests = 0;
  await page.route("**/presentations", (route) => {
    presentationRequests += 1;
    return route.abort();
  });

  await page.goto("/home");

  await expect(page.getByRole("heading", { name: "Spatial product review" })).toBeVisible();
  await expect(page.getByText("更新 2026/08/18 · Revision 8")).toBeVisible();
  expect(presentationRequests).toBe(0);
  await expect(page.getByRole("link", { name: "編集を開く" })).toHaveCount(0);
});
