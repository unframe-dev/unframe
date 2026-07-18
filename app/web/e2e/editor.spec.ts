import { expect, test, type Page } from "@playwright/test";

const editorPath = "/editor/presentations/demo/edit?panel=properties";
const viewerPath = "/editor/presentations/demo/view";

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

test("Canvas操作をcommandとして確定し、Undo / RedoとViewer同期を行う", async ({
  context,
  page,
}) => {
  await page.goto(editorPath);
  await expect(page.getByRole("heading", { name: "Spatial story" })).toBeVisible();

  const viewer = await context.newPage();
  await viewer.goto(viewerPath);
  await expect(viewer.getByText("Read-only viewer · revision 0")).toBeVisible();
  await page.bringToFront();

  const center = await canvasCenter(page);
  await page.mouse.click(center.x, center.y);
  await expect(page.getByRole("heading", { name: "Unframe sculpture のプロパティ" })).toBeVisible();

  await page.getByRole("button", { name: "移動" }).click();
  const xAxisHandle = { x: center.x, y: center.y + 10 };
  await page.mouse.move(xAxisHandle.x, xAxisHandle.y);
  await page.mouse.down();
  await page.mouse.move(xAxisHandle.x + 80, xAxisHandle.y + 20, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByText("Revision 1")).toBeVisible();
  await expect(viewer.getByText("Read-only viewer · revision 1")).toBeVisible();

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("Revision 2")).toBeVisible();
  await expect(viewer.getByText("Read-only viewer · revision 2")).toBeVisible();

  await page.getByRole("button", { name: "やり直す" }).click();
  await expect(page.getByText("Revision 3")).toBeVisible();
  await expect(viewer.getByText("Read-only viewer · revision 3")).toBeVisible();
});

test("Viewer deep linkをmobile viewportで操作し、revision欠番をsnapshotから復旧する", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(viewerPath);

  await expect(page.getByText("Read-only viewer · revision 0")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "3Dプレゼンテーション" }).locator("canvas"),
  ).toBeVisible();
  await page.getByRole("button", { name: "次のスライド" }).click();
  await expect(page.getByText("2 / 2")).toBeVisible();
  await expect(page.getByText("Shape the room around your idea.")).toBeVisible();

  await page.evaluate(() => {
    const key = "unframe:presentation:demo";
    const serialized = window.localStorage.getItem(key);
    if (!serialized) throw new Error("Snapshot is missing");
    const snapshot = JSON.parse(serialized) as { revision: number };
    snapshot.revision = 5;
    window.localStorage.setItem(key, JSON.stringify(snapshot));

    const channel = new BroadcastChannel("unframe:document:demo");
    channel.postMessage({
      presentationId: "demo",
      baseRevision: 4,
      revision: 5,
      command: {
        type: "element.update",
        elementId: "demo-model-element",
        changes: { visible: false },
      },
    });
    channel.close();
  });

  await expect(page.getByText("Read-only viewer · revision 5")).toBeVisible();
  await expect(page.getByText("確定操作を待機中")).toBeVisible();
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
  await page.goto(viewerPath);

  const fallback = page.getByRole("alert");
  await expect(fallback).toContainText("Unframe sculptureを読み込めません");
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
});

test("@webgl-fallback WebGLを利用できない場合に復旧案内を表示する", async ({ page }) => {
  await page.goto(viewerPath);

  const fallback = page.getByRole("alert");
  await expect(fallback).toContainText("WebGLを利用できません");
  await expect(fallback).toContainText("ハードウェアアクセラレーション");
});
