import { expect, test, type Page } from "@playwright/test";

async function profileServer(page: Page) {
  const state = {
    userId: "profile-user",
    name: "テストユーザー",
    signedIn: true,
    image: null as string | null,
    uploads: [] as Buffer[],
    fail: false,
    deletes: 0,
  };
  const context = page.context();
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.protocol === "blob:" || ["127.0.0.1", "localhost"].includes(url.hostname)
      ? route.continue()
      : route.abort();
  });
  await context.route("**/api/auth/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/get-session")
      return route.fulfill({
        json: state.signedIn
          ? {
              user: {
                id: state.userId,
                name: state.name,
                image: state.image,
                emailVerified: true,
              },
              session: { id: "profile-session", expiresAt: "2099-01-01T00:00:00.000Z" },
            }
          : null,
      });
    if (path === "/api/auth/update-user") {
      const name = route.request().postDataJSON().name as string;
      state.name = name;
      return route.fulfill({ json: { status: true } });
    }
    throw new Error(`Unexpected auth request: ${path}`);
  });
  await context.route("**/user-images/**", (route) =>
    route.fulfill({ contentType: "image/png", body: state.uploads.at(-1)! }),
  );
  await context.route("**/users/me/image", (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().headers()["content-type"]).toBe("image/png");
      state.uploads.push(route.request().postDataBuffer()!);
      if (state.fail)
        return route.fulfill({ status: 500, json: { error: { code: "internal_error" } } });
      state.image = "https://api.un-fra.me/user-images/profile-user/new-image.png";
    } else if (route.request().method() === "DELETE") {
      state.deletes++;
      state.image = null;
    } else throw new Error("Unexpected image request");
    return route.fulfill({ json: { image: state.image } });
  });
  await page.goto("/settings/profile");
  await expect(page.getByLabel("名前", { exact: true })).toHaveValue("テストユーザー");
  return state;
}

async function chooseImage(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = "blue";
    ctx.fillRect(400, 0, 400, 400);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page
    .getByLabel("アイコン画像を選択")
    .setInputFiles({ name: "landscape.png", mimeType: "image/png", buffer: Buffer.from(bytes) });
  await expect(page.getByRole("dialog", { name: "画像を切り抜く" })).toBeVisible();
}

test("crops an image before upload, updates the icon, and removes it", async ({
  page,
}, testInfo) => {
  const state = await profileServer(page);
  await expect(page.getByRole("textbox", { name: "アイコンURL" })).toHaveCount(0);
  await chooseImage(page);
  await page.getByRole("dialog").screenshot({ path: testInfo.outputPath("crop-desktop.png") });
  await page.getByRole("slider", { name: "拡大率" }).fill("2");
  const cropArea = await page
    .getByRole("img", { name: "切り抜きプレビュー" })
    .locator("..")
    .boundingBox();
  expect(cropArea).not.toBeNull();
  await page.mouse.move(cropArea!.x + cropArea!.width / 2, cropArea!.y + cropArea!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cropArea!.x + cropArea!.width / 2 - 50, cropArea!.y + cropArea!.height / 2);
  await page.mouse.up();
  await expect(page.getByRole("slider", { name: "左右の位置" })).not.toHaveValue("0");
  await page.getByRole("slider", { name: "左右の位置" }).fill("1");
  await page.getByRole("button", { name: "切り抜く", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.uploads).toHaveLength(0);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  expect(state.uploads).toHaveLength(1);
  const bytes = state.uploads[0]!;
  expect(new DataView(new Uint8Array(bytes).buffer).getUint32(16)).toBe(512);
  expect(new DataView(new Uint8Array(bytes).buffer).getUint32(20)).toBe(512);
  const pixel = await page.evaluate(
    async (data) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(data)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...context.getImageData(256, 256, 1, 1).data];
    },
    [...bytes],
  );
  expect(pixel).toEqual([0, 0, 255, 255]);
  await expect(
    page.getByRole("button", { name: "アカウントメニュー" }).locator("img"),
  ).toHaveAttribute("src", state.image!);
  await page.getByRole("button", { name: "アイコンを解除" }).click();
  expect(state.deletes).toBe(0);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  expect(state.deletes).toBe(1);
  const accountMenu = page.getByRole("button", { name: "アカウントメニュー" });
  await expect(accountMenu.locator("img")).toHaveCount(0);
  await accountMenu.click();
  await expect(page.getByRole("menuitem", { name: "設定" })).toBeVisible();
});

test("preserves the crop when upload fails and allows retry", async ({ page }) => {
  const state = await profileServer(page);
  await chooseImage(page);
  await page.getByRole("button", { name: "切り抜く", exact: true }).click();
  state.fail = true;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("保存できませんでした");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  state.fail = false;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  expect(state.uploads).toHaveLength(2);
});

test("cancels crop and rejects invalid images without an upload", async ({ page }, testInfo) => {
  const state = await profileServer(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseImage(page);
  await page.getByRole("dialog").screenshot({ path: testInfo.outputPath("crop-mobile.png") });
  await expect(page.getByRole("button", { name: "切り抜く", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await page.getByLabel("アイコン画像を選択").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText("画像を読み込めませんでした");
  expect(state.uploads).toHaveLength(0);
});

test("shares image changes and removal with another tab while preserving its name draft", async ({
  page,
  context,
}) => {
  const state = await profileServer(page);
  const other = await context.newPage();
  await other.goto("/settings/profile");
  const otherName = other.getByLabel("名前", { exact: true });
  await expect(otherName).toHaveValue(state.name);
  await otherName.fill("編集中の名前");

  await chooseImage(page);
  await page.getByRole("button", { name: "切り抜く", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  await expect(other.getByRole("img", { name: "プロフィールアイコン" })).toHaveAttribute(
    "src",
    state.image!,
  );
  const otherMenu = other.getByRole("button", { name: "アカウントメニュー" });
  await expect(otherMenu.locator("img")).toHaveAttribute("src", state.image!);
  await expect(otherName).toHaveValue("編集中の名前");

  await page.getByRole("button", { name: "アイコンを解除" }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("保存しました。");
  await expect(other.getByRole("img", { name: "プロフィールアイコン" })).toHaveCount(0);
  await expect(otherMenu.locator("img")).toHaveCount(0);
  await expect(otherName).toHaveValue("編集中の名前");
});

test("discards the image and name drafts when the account changes during an image save", async ({
  page,
}) => {
  const state = await profileServer(page);
  let finishUpload!: () => void;
  const uploadReleased = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  await page.route("**/users/me/image", async (route) => {
    await uploadReleased;
    await route.fulfill({
      json: { image: "https://api.un-fra.me/user-images/profile-user/old-account.png" },
    });
  });
  await page.getByLabel("名前", { exact: true }).fill("前のユーザーの編集");
  await chooseImage(page);
  await page.getByRole("button", { name: "切り抜く", exact: true }).click();
  const upload = page.waitForResponse("**/users/me/image");
  const started = page.waitForRequest("**/users/me/image");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await started;

  try {
    state.userId = "next-profile-user";
    state.name = "切り替え後のユーザー";
    await page.evaluate(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "unframe.auth.changed",
          newValue: crypto.randomUUID(),
        }),
      ),
    );
    await expect(page.getByLabel("名前", { exact: true })).toHaveValue(state.name);
    await expect(page.getByRole("img", { name: "プロフィールアイコン" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  } finally {
    finishUpload();
    await (await upload).finished();
  }
});

test("clears the shared session when the image upload API returns 401", async ({ page }) => {
  const state = await profileServer(page);
  await page.route("**/users/me/image", (route) => {
    state.signedIn = false;
    return route.fulfill({ status: 401, json: { error: { code: "unauthorized" } } });
  });
  await chooseImage(page);
  await page.getByRole("button", { name: "切り抜く", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Login.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "アカウントメニュー" })).toHaveCount(0);
});
