import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PublishedPresentation } from "@unframe/contracts/presentation";
import { hashCanonicalJsonPayload } from "../../../../packages/unframe-core/src/canonicalization/payload";

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
    schemaVersion: 3 as const,
    presentationId,
    publicationEpoch: epoch,
    sourceDraftRevision: 1,
    buildId,
    definitionHash: `sha256:${"b".repeat(64)}`,
    renderBundleHash: `sha256:${"c".repeat(64)}`,
    assetSetHash: `sha256:${"d".repeat(64)}`,
    contractVersions: {
      definition: 3 as const,
      renderBundle: 2 as const,
      assetSet: 2 as const,
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
  {
    unpublished = [],
    unavailable = [],
    pending = {},
    items = presentations,
  }: {
    unpublished?: string[];
    unavailable?: string[];
    items?: { id: string; name: string }[];
    pending?: {
      presentations?: Promise<void>;
      publications?: Promise<void>;
      thumbnails?: Promise<void>;
    };
  } = {},
) {
  const thumbnailRequests: string[] = [];
  const unavailableIds = new Set(unavailable);
  const buildVersions = new Map(items.map(({ id }) => [id, { buildId: `build-${id}`, epoch: 1 }]));
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
  await page.route("**/presentations**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.port === "4173") return route.continue();
    if (request.method() !== "GET") return route.abort();
    const path = url.pathname;
    if (path === "/presentations") {
      await pending.presentations;
      return route.fulfill({ json: { presentations: items } });
    }
    for (const presentation of items) {
      const version = buildVersions.get(presentation.id)!;
      if (path === `/presentations/${presentation.id}`)
        return route.fulfill({ json: presentation });
      if (path === `/presentations/${presentation.id}/publication`) {
        await pending.publications;
        return unpublished.includes(presentation.id)
          ? route.fulfill({ status: 404, json: { error: { code: "not_found" } } })
          : route.fulfill({ json: publication(presentation.id, version.buildId, version.epoch) });
      }
      if (path === thumbnailPath(presentation.id, version.buildId)) {
        thumbnailRequests.push(path);
        await pending.thumbnails;
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

function pausedResponse() {
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { response, release };
}

test("shows card skeletons through list, publication and thumbnail loading", async ({
  page,
}, testInfo) => {
  const list = pausedResponse();
  const publications = pausedResponse();
  const thumbnails = pausedResponse();
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockedGallery(page, {
    pending: {
      presentations: list.response,
      publications: publications.response,
      thumbnails: thumbnails.response,
    },
  });
  try {
    await page.goto("/home");
    const listStatus = page.getByRole("status", {
      name: "プレゼンテーションを読み込んでいます…",
      exact: true,
    });
    await expect(listStatus.locator("article")).toHaveCount(6);
    await expect(listStatus.locator("a, button")).toHaveCount(0);
    await expect(listStatus).toHaveText("");
    const skeleton = listStatus.locator('[data-slot="skeleton"]').first();
    await expect(skeleton).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(skeleton).toHaveCSS("animation-name", "none");
    await page.screenshot({ path: testInfo.outputPath("home-list-skeleton.png"), fullPage: true });
    await page.setViewportSize({ width: 375, height: 850 });
    const firstCard = await bounds(listStatus.locator("article").nth(0));
    const secondCard = await bounds(listStatus.locator("article").nth(1));
    expect(secondCard.y).toBeGreaterThan(firstCard.y + firstCard.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
    await page.screenshot({
      path: testInfo.outputPath("home-list-skeleton-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    list.release();

    const publicationStatus = page.getByRole("status", {
      name: /の公開情報を読み込んでいます…$/,
    });
    await expect(publicationStatus.locator("article")).toHaveCount(3);
    await expect(listStatus).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("home-publication-skeleton.png"),
      fullPage: true,
    });
    publications.release();

    const thumbnailStatus = page.getByRole("status", {
      name: `${presentations[0]!.name}のサムネイルを読み込んでいます…`,
      exact: true,
    });
    await expect(thumbnailStatus.locator('[data-slot="skeleton"]')).toBeVisible();
    await expect(cardFor(page, 0)).toBeVisible();
    const loadingBounds = await bounds(thumbnailStatus);
    expect(loadingBounds.width / loadingBounds.height).toBeCloseTo(16 / 9, 1);
    await page.screenshot({
      path: testInfo.outputPath("home-thumbnail-skeleton.png"),
      fullPage: true,
    });
    thumbnails.release();
    await loadedThumbnails(page);
    await expect(thumbnailStatus).toHaveCount(0);
    await expect(publicationStatus).toHaveCount(0);
    const image = page.getByRole("img", {
      name: `${presentations[0]!.name}のサムネイル`,
      exact: true,
    });
    expect((await bounds(image)).height).toBeCloseTo(loadingBounds.height, 0);
  } finally {
    list.release();
    publications.release();
    thumbnails.release();
  }
});

test("shows non-interactive row skeletons while loading room presentation choices", async ({
  page,
}, testInfo) => {
  const list = pausedResponse();
  const publications = pausedResponse();
  await mockedGallery(page, {
    pending: { presentations: list.response, publications: publications.response },
  });
  try {
    await page.goto("/rooms");
    const listStatus = page.getByRole("status", {
      name: "プレゼンテーションを読み込んでいます…",
      exact: true,
    });
    await expect(listStatus.locator("article")).toHaveCount(6);
    await expect(listStatus.locator("a, button, img")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("rooms-presentation-skeleton.png"),
      fullPage: true,
    });
    list.release();
    const publicationStatus = page.getByRole("status", {
      name: /の公開情報を読み込んでいます…$/,
    });
    await expect(publicationStatus.locator("article")).toHaveCount(3);
    publications.release();
    await expect(
      page.getByRole("button", { name: `${presentations[0]!.name}を選択`, exact: true }),
    ).toBeVisible();
    await expect(publicationStatus).toHaveCount(0);
  } finally {
    list.release();
    publications.release();
  }
});

for (const outcome of [
  {
    state: "empty",
    response: { json: { presentations: [] } },
    message: "プレゼンテーションがありません。",
    alerts: 0,
  },
  {
    state: "error",
    response: { status: 503, json: { error: { code: "unavailable" } } },
    message: "通信に失敗しました。時間をおいて再取得してください。",
    alerts: 1,
  },
]) {
  test(`replaces loading skeletons with the ${outcome.state} list state`, async ({ page }) => {
    const list = pausedResponse();
    await mockedGallery(page);
    await page.route("**/presentations", async (route) => {
      await list.response;
      await route.fulfill(outcome.response);
    });
    try {
      await page.goto("/home");
      const status = page.getByRole("status", {
        name: "プレゼンテーションを読み込んでいます…",
        exact: true,
      });
      await expect(status.locator('[data-slot="skeleton"]').first()).toBeVisible();
      list.release();
      await expect(status).toHaveCount(0);
      await expect(page.getByText(outcome.message, { exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(outcome.alerts);
      await expect(page.getByText("プレゼンテーションがありません。", { exact: true })).toHaveCount(
        1 - outcome.alerts,
      );
      await expect(page.locator("article")).toHaveCount(0);
    } finally {
      list.release();
    }
  });
}

test("keeps cached cards visible while refreshing list and publication information", async ({
  page,
}) => {
  const list = pausedResponse();
  const publications = pausedResponse();
  const thumbnails = pausedResponse();
  const pending: {
    presentations?: Promise<void>;
    publications?: Promise<void>;
    thumbnails?: Promise<void>;
  } = {};
  const server = await mockedGallery(page, { pending });
  await page.goto("/home");
  await loadedThumbnails(page);
  const initialThumbnailRequests = server.thumbnailRequests.length;
  const originalImage = await page
    .getByRole("img", { name: `${presentations[0]!.name}のサムネイル`, exact: true })
    .evaluateHandle((element) => element);
  pending.presentations = list.response;
  pending.publications = publications.response;
  pending.thumbnails = thumbnails.response;
  try {
    const publicationRequest = page.waitForRequest("**/presentations/gallery-1/publication");
    await page.getByRole("button", { name: "公開情報を再取得", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "公開情報を再取得", exact: true }),
    ).toBeDisabled();
    await expect(cardFor(page, 0)).toBeVisible();
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
    list.release();
    await publicationRequest;
    await expect(cardFor(page, 0)).toBeVisible();
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
    publications.release();
    await expect(page.getByRole("button", { name: "公開情報を再取得", exact: true })).toBeEnabled();
    expect(await originalImage.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
    await loadedThumbnails(page);
    expect(server.thumbnailRequests).toHaveLength(initialThumbnailRequests);
  } finally {
    list.release();
    publications.release();
    thumbnails.release();
  }
});

test("shows three authenticated thumbnails in one desktop row and opens card details by pointer or keyboard", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const server = await mockedGallery(page);
  let sessionReads = 0;
  await page.route("**/api/auth/get-session", (route) => {
    sessionReads++;
    return route.fallback();
  });
  await page.goto("/home");
  await loadedThumbnails(page);
  expect(sessionReads).toBe(1);
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

test("reuses fresh presentation information across navigation and refreshes it on request", async ({
  page,
}) => {
  const requests: string[] = [];
  const sessionRequests: string[] = [];
  const sessionResponses: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/presentations" || path.endsWith("/publication")) requests.push(path);
    if (path === "/api/auth/get-session") sessionRequests.push(path);
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path === "/api/auth/get-session") sessionResponses.push(path);
  });
  const server = await mockedGallery(page);
  await page.goto("/home");
  await loadedThumbnails(page);
  const initialRequests = requests.length;
  expect(requests.filter((path) => path.endsWith("/publication"))).toHaveLength(3);
  await expect.poll(() => sessionResponses.length).toBe(sessionRequests.length);
  const initialSessionRequests = sessionRequests.length;
  const first = presentations[0]!;
  const nextBuildId = "build-gallery-1-v2";
  server.buildVersions.set(first.id, { buildId: nextBuildId, epoch: 2 });

  const navigation = page.getByRole("navigation", { name: "メインナビゲーション" });
  await navigation.getByRole("link", { name: "ルーム", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `${first.name}を選択`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "公開情報を再取得", exact: true })).toBeEnabled();
  await navigation.getByRole("link", { name: "ホーム", exact: true }).click();
  await expect(cardFor(page, 0)).toBeVisible();
  await expect(page.getByRole("button", { name: "公開情報を再取得", exact: true })).toBeEnabled();
  const image = page.getByRole("img", { name: `${first.name}のサムネイル`, exact: true });
  await expect(image).toHaveAttribute("src", new RegExp(`${thumbnailPath(first.id)}$`));
  expect(requests).toHaveLength(initialRequests);
  expect(sessionRequests).toHaveLength(initialSessionRequests);

  await page.getByRole("button", { name: "公開情報を再取得", exact: true }).click();
  await expect(image).toHaveAttribute(
    "src",
    new RegExp(`${thumbnailPath(first.id, nextBuildId)}$`),
  );
  expect(requests).toHaveLength(initialRequests + 4);
});

test("shares presentation and publication cache between home, details and room selection", async ({
  page,
}) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.port !== "4173" &&
      url.pathname.startsWith("/presentations") &&
      !url.pathname.endsWith("/thumbnail")
    )
      reads.push(url.pathname);
  });
  await mockedGallery(page);
  await page.goto("/home");
  await loadedThumbnails(page);
  const initialReads = reads.length;
  expect(reads.filter((path) => path.endsWith("/publication"))).toHaveLength(3);
  await cardFor(page, 0).click();
  await expect(
    page.getByRole("heading", { name: presentations[0]!.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "公開情報を再取得", exact: true })).toBeEnabled();
  expect(reads).toHaveLength(initialReads);

  await page.getByRole("link", { name: "ルームを作成", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "選択したプレゼンテーション", exact: true }),
  ).toContainText(presentations[0]!.name);
  await expect(
    page.getByRole("button", { name: `${presentations[0]!.name}を選択`, exact: true }),
  ).toBeVisible();
  expect(reads).toHaveLength(initialReads);
});

test("renders completed publications individually, bounds requests and cancels queued work on navigation", async ({
  page,
}) => {
  const items = [
    ...presentations,
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `gallery-${index + 4}`,
      name: `Gallery ${index + 4}`,
    })),
  ];
  const gates = items.map(() => pausedResponse());
  const requests: string[] = [];
  let active = 0;
  let maximum = 0;
  await mockedGallery(page, { items });
  await page.route("**/publication", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const index = items.findIndex((item) => item.id === id);
    requests.push(id);
    maximum = Math.max(maximum, ++active);
    await gates[index]!.response;
    active--;
    await route.fulfill({ json: publication(id) });
  });
  try {
    await page.goto("/home");
    await expect.poll(() => requests.length).toBe(3);
    await expect(page.getByRole("status", { name: /の公開情報を読み込んでいます…$/ })).toHaveCount(
      6,
    );
    gates[0]!.release();
    await expect(cardFor(page, 0)).toBeVisible();
    await expect.poll(() => requests.length).toBe(4);
    await expect(page.getByRole("status", { name: /の公開情報を読み込んでいます…$/ })).toHaveCount(
      5,
    );
    expect(maximum).toBe(3);

    await page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name: "デバイス", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "デバイス", exact: true })).toBeVisible();
    for (const gate of gates) gate.release();
    await page.waitForLoadState("networkidle");
    expect(requests).toHaveLength(4);

    await page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name: "ホーム", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(6);
    await expect(page.getByRole("button", { name: "公開情報を再取得", exact: true })).toBeEnabled();
    expect(requests.filter((id) => id === items[0]!.id)).toHaveLength(1);
    expect(maximum).toBe(3);
  } finally {
    for (const gate of gates) gate.release();
  }
});

test("retries an individual publication failure on revisit without refetching successful publications", async ({
  page,
}) => {
  const requests = new Map<string, number>();
  await mockedGallery(page);
  await page.route("**/publication", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const attempts = (requests.get(id) ?? 0) + 1;
    requests.set(id, attempts);
    await route.fulfill(
      id === presentations[0]!.id && attempts === 1
        ? { status: 503, json: { error: { code: "unavailable" } } }
        : { json: publication(id) },
    );
  });
  await page.goto("/home");
  await expect(page.getByRole("alert")).toContainText("通信に失敗");
  await expect(cardFor(page, 1)).toBeVisible();
  await expect(cardFor(page, 2)).toBeVisible();
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "ルーム", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `${presentations[0]!.name}を選択`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(requests.get(presentations[0]!.id)).toBe(2);
  expect(requests.get(presentations[1]!.id)).toBe(1);
  expect(requests.get(presentations[2]!.id)).toBe(1);
});

test("rechecks the session after a native thumbnail 404 and keeps the valid account's placeholder", async ({
  page,
}) => {
  const thumbnails = pausedResponse();
  let sessionReads = 0;
  await mockedGallery(page, {
    unavailable: [presentations[0]!.id],
    pending: { thumbnails: thumbnails.response },
  });
  await page.route("**/api/auth/get-session", (route) => {
    sessionReads++;
    return route.fallback();
  });
  try {
    await page.goto("/home");
    await expect(
      page.getByRole("status", { name: /のサムネイルを読み込んでいます…$/ }),
    ).toHaveCount(3);
    const initialReads = sessionReads;
    thumbnails.release();
    await expect(page.getByText("サムネイルなし", { exact: true })).toHaveCount(1);
    await expect.poll(() => sessionReads).toBe(initialReads + 1);
    await expect(cardFor(page, 0)).toBeVisible();
    await expect(page).toHaveURL(/\/home$/);
  } finally {
    thumbnails.release();
  }
});

test("redirects to login when a native thumbnail 401 exposes an expired session", async ({
  page,
}) => {
  const thumbnails = pausedResponse();
  let expired = false;
  await mockedGallery(page, { pending: { thumbnails: thumbnails.response } });
  await page.route("**/api/auth/get-session", (route) =>
    expired ? route.fulfill({ json: null }) : route.fallback(),
  );
  await page.route(`**${thumbnailPath(presentations[0]!.id)}`, async (route) => {
    await thumbnails.response;
    expired = true;
    await route.fulfill({
      status: 401,
      json: { error: { code: "unauthorized" } },
      headers: {
        "access-control-allow-origin": "http://127.0.0.1:4173",
        "access-control-allow-credentials": "true",
      },
    });
  });
  try {
    await page.goto("/home");
    await expect(
      page.getByRole("status", { name: /のサムネイルを読み込んでいます…$/ }),
    ).toHaveCount(3);
    thumbnails.release();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Login.", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "メインナビゲーション" })).toHaveCount(0);
  } finally {
    thumbnails.release();
  }
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
