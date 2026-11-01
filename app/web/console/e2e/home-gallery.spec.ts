import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PublishedPresentation } from "@unframe/contracts/presentation";
import { hashCanonicalJsonPayload } from "@unframe/artifacts";

const presentations = [
  { id: "gallery-1", name: "春のプロダクト紹介" },
  { id: "gallery-2", name: "新しい展示の提案" },
  { id: "gallery-3", name: "チームのふりかえり" },
];
const thumbnail = readFileSync(new URL("../public/favicon/favicon-32x32.png", import.meta.url));
const publication = (
  presentationId: string,
  buildId = `build-${presentationId}`,
  epoch = 1,
): PublishedPresentation => {
  const payload = {
    schemaVersion: 1 as const,
    presentationId,
    publicationEpoch: epoch,
    sourceDraftRevision: 1,
    buildId,
    definitionHash: `sha256:${"b".repeat(64)}`,
    renderBundleHash: `sha256:${"c".repeat(64)}`,
    assetSetHash: `sha256:${"d".repeat(64)}`,
    contractVersions: {
      definition: 1 as const,
      renderBundle: 1 as const,
      assetSet: 1 as const,
      delivery: 3 as const,
      runtime: 3 as const,
      progression: 2 as const,
      projection: 2 as const,
    },
  };
  return { ...payload, publicationManifestHash: hashCanonicalJsonPayload(payload) };
};
const thumbnailPath = (id: string, buildId = `build-${id}`) =>
  `/presentations/${id}/builds/${buildId}/thumbnail`;
const cardFor = (page: Page, index: number) =>
  page.getByRole("link", { name: `${presentations[index]!.name}の詳細を見る`, exact: true });
async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}
async function loadedThumbnails(page: Page) {
  for (const presentation of presentations) {
    const image = page.getByRole("img", { name: `${presentation.name}のサムネイル`, exact: true });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
      )
      .toBe(true);
  }
}
async function mockedGallery(
  page: Page,
  { unpublished = [], unavailable = [] }: { unpublished?: string[]; unavailable?: string[] } = {},
) {
  const thumbnailRequests: string[] = [];
  const unavailableIds = new Set(unavailable);
  const buildVersions = new Map(
    presentations.map(({ id }) => [id, { buildId: `build-${id}`, epoch: 1 }]),
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port === "8787")
      return route.abort();
    return route.continue();
  });
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: { id: "gallery-user", name: "テストユーザー", emailVerified: true },
        session: { id: "gallery-session", expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    }),
  );
  await page.route("**/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [], nextCursor: null } }),
  );
  await page.route("**/presentations**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.port === "4173") return route.continue();
    if (request.method() !== "GET") return route.abort();
    const path = url.pathname;
    if (path === "/presentations") return route.fulfill({ json: { presentations } });
    for (const presentation of presentations) {
      const version = buildVersions.get(presentation.id)!;
      if (path === `/presentations/${presentation.id}`)
        return route.fulfill({ json: presentation });
      if (path === `/presentations/${presentation.id}/publication`)
        return unpublished.includes(presentation.id)
          ? route.fulfill({ status: 404, json: { error: { code: "not_found" } } })
          : route.fulfill({ json: publication(presentation.id, version.buildId, version.epoch) });
      if (path === thumbnailPath(presentation.id, version.buildId)) {
        thumbnailRequests.push(path);
        return unavailableIds.has(presentation.id)
          ? route.fulfill({
              status: 404,
              json: { error: { code: "not_found" } },
              headers: {
                "access-control-allow-origin": "http://127.0.0.1:4173",
                "access-control-allow-credentials": "true",
              },
            })
          : route.fulfill({
              body: thumbnail,
              contentType: "image/png",
              headers: {
                "access-control-allow-origin": "http://127.0.0.1:4173",
                "access-control-allow-credentials": "true",
              },
            });
      }
    }
    return route.abort();
  });
  return { thumbnailRequests, unavailableIds, buildVersions };
}

test("shows three authenticated thumbnails in one desktop row and opens card details by pointer or keyboard", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const server = await mockedGallery(page);
  await page.goto("/home");
  await loadedThumbnails(page);
  const cards = await Promise.all(presentations.map((_, index) => bounds(cardFor(page, index))));
  expect(Math.abs(cards[0]!.y - cards[1]!.y)).toBeLessThan(1);
  expect(Math.abs(cards[1]!.y - cards[2]!.y)).toBeLessThan(1);
  expect(cards[1]!.x).toBeGreaterThan(cards[0]!.x + cards[0]!.width);
  expect(cards[2]!.x).toBeGreaterThan(cards[1]!.x + cards[1]!.width);
  expect(server.thumbnailRequests.sort()).toEqual(
    presentations.map(({ id }) => thumbnailPath(id)).sort(),
  );
  for (const presentation of presentations) {
    const image = page.getByRole("img", { name: `${presentation.name}のサムネイル`, exact: true });
    await expect(image).toHaveAttribute("src", new RegExp(`${thumbnailPath(presentation.id)}$`));
    await expect(image).toHaveAttribute("crossorigin", "use-credentials");
    const imageBox = await bounds(image);
    expect(imageBox.width / imageBox.height).toBeCloseTo(16 / 9, 1);
  }
  const imagePath = testInfo.outputPath("home-gallery-desktop.png");
  await page.screenshot({ path: imagePath, fullPage: true });
  await testInfo.attach("Home gallery", { path: imagePath, contentType: "image/png" });
  await cardFor(page, 0).click();
  await expect(page).toHaveURL(/\/presentations\/gallery-1$/);
  await expect(
    page.getByRole("heading", { name: presentations[0]!.name, exact: true }),
  ).toBeVisible();
  await page.goto("/home");
  await cardFor(page, 1).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/presentations\/gallery-2$/);
});

test("enlarges a hovered card and respects reduced motion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockedGallery(page);
  await page.goto("/home");
  await loadedThumbnails(page);
  const card = cardFor(page, 0);
  const heading = page.getByRole("heading", { name: "公開済みプレゼンテーション", exact: true });
  await heading.hover();
  const original = await bounds(card);
  await card.hover();
  await expect.poll(async () => (await bounds(card)).width).toBeGreaterThan(original.width * 1.01);
  await heading.hover();
  await expect
    .poll(() => card.evaluate((element) => element.closest("article")!.matches(":hover")))
    .toBe(false);
  await expect
    .poll(async () => Math.abs((await bounds(card)).width - original.width))
    .toBeLessThan(0.5);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await card.hover();
  await card.evaluate(async (element) => {
    await Promise.all(
      element
        .closest("article")!
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  expect((await bounds(card)).width).toBeLessThanOrEqual(original.width + 0.5);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await card.hover();
  await expect.poll(async () => (await bounds(card)).width).toBeGreaterThan(original.width * 1.01);
  const imagePath = testInfo.outputPath("home-gallery-hover.png");
  await page.screenshot({ path: imagePath, fullPage: true });
  await testInfo.attach("Home gallery hover", { path: imagePath, contentType: "image/png" });
});

test("uses two columns on medium screens and one column without horizontal overflow on mobile", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await mockedGallery(page);
  await page.goto("/home");
  await expect(cardFor(page, 2)).toBeVisible();
  const medium = await Promise.all(presentations.map((_, index) => bounds(cardFor(page, index))));
  expect(Math.abs(medium[0]!.y - medium[1]!.y)).toBeLessThan(1);
  expect(medium[2]!.y).toBeGreaterThan(medium[0]!.y + medium[0]!.height);
  await page.setViewportSize({ width: 375, height: 850 });
  const mobile = await Promise.all(presentations.map((_, index) => bounds(cardFor(page, index))));
  expect(Math.abs(mobile[0]!.x - mobile[1]!.x)).toBeLessThan(1);
  expect(Math.abs(mobile[1]!.x - mobile[2]!.x)).toBeLessThan(1);
  expect(mobile[1]!.y).toBeGreaterThan(mobile[0]!.y + mobile[0]!.height);
  expect(mobile[2]!.y).toBeGreaterThan(mobile[1]!.y + mobile[1]!.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  const imagePath = testInfo.outputPath("home-gallery-mobile.png");
  await page.screenshot({ path: imagePath, fullPage: true });
  await testInfo.attach("Home gallery mobile", { path: imagePath, contentType: "image/png" });
});

test("recovers a missing thumbnail after explicit refresh without requesting unpublished images", async ({
  page,
}) => {
  const server = await mockedGallery(page, {
    unpublished: ["gallery-2"],
    unavailable: ["gallery-1", "gallery-3"],
  });
  await page.goto("/home");
  await expect(page.getByText("サムネイルなし", { exact: true })).toHaveCount(3);
  await expect(page.getByText("未公開", { exact: true })).toBeVisible();
  expect(server.thumbnailRequests.sort()).toEqual(
    [thumbnailPath("gallery-1"), thumbnailPath("gallery-3")].sort(),
  );

  server.unavailableIds.delete("gallery-1");
  await page.getByRole("button", { name: "公開情報を再取得", exact: true }).click();
  const recovered = page.getByRole("img", {
    name: `${presentations[0]!.name}のサムネイル`,
    exact: true,
  });
  await expect(recovered).toBeVisible();
  await expect
    .poll(() =>
      recovered.evaluate(
        (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(page.getByText("サムネイルなし", { exact: true })).toHaveCount(2);
  expect(
    server.thumbnailRequests.filter((path) => path === thumbnailPath("gallery-1")).length,
  ).toBeGreaterThan(1);
  expect(server.thumbnailRequests).not.toContain(thumbnailPath("gallery-2"));
});

test("loads the thumbnail from the newly published build after refreshing publication information", async ({
  page,
}) => {
  const server = await mockedGallery(page);
  await page.goto("/home");
  await loadedThumbnails(page);
  const first = presentations[0]!;
  const image = page.getByRole("img", { name: `${first.name}のサムネイル`, exact: true });
  await expect(image).toHaveAttribute("src", new RegExp(`${thumbnailPath(first.id)}$`));
  const nextBuildId = "build-gallery-1-v2";
  server.buildVersions.set(first.id, { buildId: nextBuildId, epoch: 2 });
  await page.getByRole("button", { name: "公開情報を再取得", exact: true }).click();
  await expect(image).toHaveAttribute(
    "src",
    new RegExp(`${thumbnailPath(first.id, nextBuildId)}$`),
  );
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
    )
    .toBe(true);
  expect(server.thumbnailRequests).toContain(thumbnailPath(first.id));
  expect(server.thumbnailRequests).toContain(thumbnailPath(first.id, nextBuildId));
});

test("keeps the room presentation chooser as rows without thumbnail requests", async ({ page }) => {
  const server = await mockedGallery(page);
  await page.goto("/rooms");
  for (const presentation of presentations)
    await expect(
      page.getByRole("button", { name: `${presentation.name}を選択`, exact: true }),
    ).toBeVisible();
  await expect(page.getByRole("img", { name: /のサムネイル$/ })).toHaveCount(0);
  expect(server.thumbnailRequests).toEqual([]);
});
