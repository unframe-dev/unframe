import { expect, test, type Page } from "@playwright/test";

const session = {
  user: {
    id: "loading-user",
    name: "テストユーザー",
    email: "test@example.com",
    emailVerified: true,
  },
  session: { id: "loading-session", expiresAt: "2099-01-01T00:00:00.000Z" },
};

async function mockSession(page: Page) {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: session }));
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
}

test("shows device-shaped skeletons until the initial request completes and keeps content during refresh", async ({
  page,
}) => {
  await mockSession(page);
  let release!: () => void;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/list-sessions", async (route) => {
    await gate;
    await route.fulfill({
      json: [
        {
          id: "device-1",
          assurance: "device",
          userAgent: "Quest test",
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ],
    });
  });
  await page.goto("/devices");
  const loading = page.getByRole("status", { name: "デバイスを読み込んでいます…" });
  await expect(loading).toBeVisible();
  await expect(loading.locator('[data-slot="skeleton"]').first()).toBeVisible();
  await expect(page.getByText("認証済みのデバイスはありません。")).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { name: "Quest test" })).toBeVisible();
  await expect(loading).toHaveCount(0);
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "デバイス一覧を再取得" }).click();
  await expect(page.getByRole("heading", { name: "Quest test" })).toBeVisible();
  await expect(loading).toHaveCount(0);
  release();
});

for (const example of [
  {
    name: "owned rooms",
    path: "/rooms",
    request: "**/sessions?*",
    label: "ルーム一覧を読み込んでいます…",
    response: { sessions: [], nextCursor: null },
    ready: "作成したルームはありません。",
  },
  {
    name: "room details",
    path: "/rooms/room-1",
    request: "**/sessions/room-1",
    label: "ルームを読み込んでいます…",
    response: {
      id: "room-1",
      presentationId: "presentation-1",
      state: "Ended",
      publicationFence: null,
    },
    ready: "このルームの発表は終了しました。",
  },
  {
    name: "room invitation",
    path: "/rooms/room-1",
    request: "**/sessions/room-1/join-code",
    label: "ルームコードを読み込んでいます…",
    response: { joinCode: "ABCD-EFGH" },
    ready: "ABCD-EFGH",
  },
  {
    name: "runtime preparation",
    path: "/rooms/room-1",
    request: "**/sessions/room-1/runtime-preparation",
    label: "発表環境を読み込んでいます…",
    response: {
      state: "ready",
      runtimeId: "runtime-1",
      assignmentEpoch: 1,
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    },
    ready: "発表環境の準備ができました。",
  },
  {
    name: "presentation details",
    path: "/presentations/presentation-1",
    request: "**/presentations/presentation-1",
    label: "公開情報を読み込んでいます…",
    response: { id: "presentation-1", name: "Loading presentation" },
    ready: "未公開",
  },
  {
    name: "room selection",
    path: "/rooms?presentationId=presentation-1",
    request: "**/presentations/presentation-1",
    label: "公開情報を読み込んでいます…",
    response: { id: "presentation-1", name: "Loading presentation" },
    ready: "未公開",
  },
]) {
  test(`replaces ${example.name} skeletons with the fetched content`, async ({ page }) => {
    await mockSession(page);
    await page.route("**/sessions?*", (route) =>
      route.fulfill({ json: { sessions: [], nextCursor: null } }),
    );
    await page.route("**/sessions/room-1", (route) =>
      route.fulfill({
        json: {
          id: "room-1",
          presentationId: "presentation-1",
          state: "Waiting",
          publicationFence: null,
        },
      }),
    );
    await page.route("**/sessions/room-1/runtime-preparation", (route) =>
      route.fulfill({ json: { state: "unassigned" } }),
    );
    await page.route("**/presentations/presentation-1/publication", (route) =>
      route.fulfill({ status: 404, json: { error: { code: "not_found" } } }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(example.request, async (route) => {
      if (route.request().isNavigationRequest()) return route.continue();
      await gate;
      await route.fulfill({ json: example.response });
    });
    try {
      await page.goto(example.path);
      const loading = page.getByRole("status", { name: example.label, exact: true });
      await expect(loading).toBeVisible();
      await expect(loading.locator('[data-slot="skeleton"]').first()).toBeVisible();
      release();
      await expect(page.getByText(example.ready, { exact: true })).toBeVisible();
      await expect(loading).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("reuses the canonical session when opening profile settings", async ({ page }, testInfo) => {
  await mockSession(page);
  let requests = 0;
  await page.route("**/api/auth/get-session", (route) => {
    requests++;
    return route.fulfill({ json: session });
  });
  await page.goto("/home");
  await expect(page.getByText("プレゼンテーションがありません。", { exact: true })).toBeVisible();
  const previousRequests = requests;
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "設定", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "名前", exact: true })).toHaveValue(
    session.user.name,
  );
  await expect(page.getByRole("status", { name: "プロフィールを読み込んでいます…" })).toHaveCount(
    0,
  );
  expect(requests).toBe(previousRequests);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: testInfo.outputPath("profile-cached-mobile.png"), fullPage: true });
});

test("replaces security settings skeletons when account data arrives", async ({ page }) => {
  await mockSession(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/list-accounts", async (route) => {
    await gate;
    await route.fulfill({ json: [{ id: "account-1", providerId: "credential" }] });
  });
  try {
    await page.goto("/settings/security");
    const loading = page.getByRole("status", { name: "認証設定を読み込み中…" });
    await expect(loading).toBeVisible();
    await expect(page.getByLabel("現在のパスワード", { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByLabel("新しいパスワード", { exact: true })).toBeVisible();
    await expect(loading).toHaveCount(0);
  } finally {
    release();
  }
});

test("shows a skeleton while checking the session on the public device page", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await gate;
    await route.fulfill({ json: session });
  });
  try {
    await page.goto("/device");
    const loading = page.getByRole("status", { name: "ログイン状態を確認しています…" });
    await expect(loading).toBeVisible();
    await expect(page.getByRole("textbox", { name: "ユーザーコード" })).toHaveCount(0);
    release();
    await expect(page.getByRole("textbox", { name: "ユーザーコード" })).toBeVisible();
    await expect(loading).toHaveCount(0);
  } finally {
    release();
  }
});

for (const status of [200, 503]) {
  test(`ends device skeletons after HTTP ${status} without confusing an empty or failed result with loading`, async ({
    page,
  }) => {
    await mockSession(page);
    await page.route("**/api/auth/list-sessions", (route) =>
      route.fulfill({ status, json: status === 200 ? [] : { code: "unavailable" } }),
    );
    await page.goto("/devices");
    await expect(page.getByRole("status", { name: "デバイスを読み込んでいます…" })).toHaveCount(0);
    if (status === 200) {
      await expect(
        page.getByText("認証済みのデバイスはありません。", { exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("alert")).toContainText("デバイスを読み込めませんでした。");
    }
  });
}
