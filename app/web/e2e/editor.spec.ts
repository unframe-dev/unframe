import { expect, test, type Page } from "@playwright/test";

const editorPath = "/editor/demo?panel=properties";

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

async function canvasCenter(page: Page) {
  const canvas = page.getByRole("region", { name: "3Dプレゼンテーション" }).locator("canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("3D Canvas の表示領域を取得できません");
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

test("Canvas操作をcommandとして確定し、Undo / Redoを行う", async ({ page }) => {
  await page.goto(editorPath);
  await expect(page.getByRole("heading", { name: "Spatial story" })).toBeVisible();

  await page.getByRole("button", { name: "Unframe sculptureを選択" }).click();
  await expect(page.getByRole("heading", { name: "Unframe sculpture のプロパティ" })).toBeVisible();

  const center = await canvasCenter(page);

  await page.getByRole("button", { name: "移動" }).click();
  const xAxisHandle = { x: center.x, y: center.y + 10 };
  await page.mouse.move(xAxisHandle.x, xAxisHandle.y);
  await page.mouse.down();
  await page.mouse.move(xAxisHandle.x + 80, xAxisHandle.y + 20, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByText("Revision 1")).toBeVisible();

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("Revision 2")).toBeVisible();

  await page.getByRole("button", { name: "やり直す" }).click();
  await expect(page.getByText("Revision 3")).toBeVisible();
});

test("GLB読込失敗時に再試行できるfallbackを表示する", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("data:model/gltf-binary")) {
        return Promise.reject(new TypeError("Injected GLB load failure"));
      }
      return originalFetch(input, init);
    };
  });
  await page.goto(editorPath);

  const fallback = page.getByRole("alert");
  await expect(fallback).toContainText("Unframe sculptureを読み込めません");
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
});

test("@webgl-fallback WebGLを利用できない場合に復旧案内を表示する", async ({ page }) => {
  await page.goto(editorPath);

  const fallback = page.getByRole("alert");
  await expect(fallback).toContainText("WebGLを利用できません");
  await expect(fallback).toContainText("ハードウェアアクセラレーション");
});
