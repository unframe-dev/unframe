import { expect, test, type Page } from "@playwright/test";

const presentation = { id: "presentation-1", name: "公開済みプレゼン" };
const publication = {
  schemaVersion: 2,
  presentationId: presentation.id,
  publicationEpoch: 3,
  publicationManifestHash: `sha256:${"a".repeat(64)}`,
  sourceDraftRevision: 1,
  buildId: "build-3",
  definitionHash: `sha256:${"b".repeat(64)}`,
  renderBundleHash: `sha256:${"c".repeat(64)}`,
  assetSetHash: `sha256:${"d".repeat(64)}`,
  contractVersions: {
    definition: 2,
    renderBundle: 2,
    assetSet: 2,
    delivery: 2,
    runtime: 2,
    progression: 1,
    projection: 1,
  },
};
const room = {
  id: "room-1",
  presentationId: presentation.id,
  state: "Waiting",
  publicationFence: {
    presentationId: presentation.id,
    publicationEpoch: 4,
    publicationManifestHash: `sha256:${"e".repeat(64)}`,
  },
};
async function published(page: Page) {
  await page.route("**/presentations", (route) =>
    route.fulfill({ json: { presentations: [presentation] } }),
  );
  await page.route(`**/presentations/${presentation.id}`, (route) =>
    route.fulfill({ json: presentation }),
  );
  await page.route("**/publication", (route) => route.fulfill({ json: publication }));
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
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
          expiresAt: "2027-08-18T00:00:00.000Z",
          token: "test-token",
          createdAt: "2026-08-17T00:00:00.000Z",
          updatedAt: "2026-08-17T00:00:00.000Z",
        },
      },
    }),
  );
});

test("distinguishes empty collection and unpublished presentation", async ({ page }) => {
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations: [] } }));
  await page.goto("/home");
  await expect(page.getByText("Presentation がありません。")).toBeVisible();
  await published(page);
  await page.route("**/publication", (route) =>
    route.fulfill({ status: 404, json: { error: { code: "not_found" } } }),
  );
  await page.getByRole("button", { name: "公開情報を再取得" }).click();
  await expect(page.getByText("公開済み Dist なし")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("shows current publication details and reloads a republished build", async ({ page }) => {
  await published(page);
  await page.goto("/home");
  await expect(page.getByText("Build ID: build-3")).toBeVisible();
  await page.getByRole("link", { name: "公開済み Dist の詳細" }).click();
  await expect(page.getByText(publication.assetSetHash, { exact: true })).toBeVisible();
  await page.route("**/publication", (route) =>
    route.fulfill({ json: { ...publication, buildId: "build-4", publicationEpoch: 4 } }),
  );
  await page.getByRole("button", { name: "公開情報を再取得" }).click();
  await expect(page.getByText("build-4", { exact: true })).toBeVisible();
  await expect(page.getByText("4", { exact: true })).toBeVisible();
});

for (const [status, message] of [
  [401, "ログインの有効期限が切れました。ログインし直してください。"],
  [403, "この情報を参照・操作する権限がありません。"],
] as const) {
  test(`distinguishes publication HTTP ${status} from unpublished`, async ({ page }) => {
    await published(page);
    await page.route("**/publication", (route) =>
      route.fulfill({ status, json: { error: { code: "failed" } } }),
    );
    await page.goto("/home");
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(page.getByText("公開済み Dist なし")).toHaveCount(0);
  });
}

test("recovers from a network failure by explicit refetch", async ({ page }) => {
  await published(page);
  await page.route("**/publication", (route) => route.abort("failed"));
  await page.goto("/home");
  await expect(page.getByRole("alert")).toContainText("通信に失敗");
  await page.unroute("**/publication");
  await page.route("**/publication", (route) => route.fulfill({ json: publication }));
  await page.getByRole("button", { name: "公開情報を再取得" }).click();
  await expect(page.getByText("Build ID: build-3")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("only loads the displayed page with at most three publication requests at once", async ({
  page,
}) => {
  const presentations = Array.from({ length: 8 }, (_, index) => ({
    id: `p-${index}`,
    name: `Presentation ${index}`,
  }));
  await page.route("**/presentations", (route) => route.fulfill({ json: { presentations } }));
  const requested: string[] = [];
  let active = 0;
  let maximum = 0;
  await page.route("**/publication", async (route) => {
    const id = route.request().url().split("/").at(-2)!;
    requested.push(id);
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setTimeout(resolve, 50));
    active--;
    await route.fulfill({ json: { ...publication, presentationId: id } });
  });
  await page.goto("/home");
  await expect(page.getByRole("article")).toHaveCount(6);
  expect(requested.sort()).toEqual(["p-0", "p-1", "p-2", "p-3", "p-4", "p-5"]);
  expect(maximum).toBeLessThanOrEqual(3);
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(requested).toContain("p-7");
});

test("creates one room, displays the server fixed publication, and never persists Join Code", async ({
  page,
}) => {
  await published(page);
  let requests = 0;
  await page.route("**/sessions", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ presentationId: presentation.id });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ status: 201, json: { session: room, joinCode: "ABCD-EFGH" } });
  });
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  await page.goto("/home");
  await page.getByRole("link", { name: "公開済み Dist の詳細" }).click();
  await page.getByRole("link", { name: "この Presentation でルームを作成" }).click();
  const create = page.getByRole("button", { name: "ルームを作成", exact: true });
  await create.dblclick();
  const result = page.getByRole("region", { name: "ルーム作成結果" });
  await expect(result.getByText("room-1", { exact: true })).toBeVisible();
  await expect(result.getByText("Waiting", { exact: true })).toBeVisible();
  await expect(result.getByText("4", { exact: true })).toBeVisible();
  await expect(
    result.getByText(room.publicationFence.publicationManifestHash, { exact: true }),
  ).toBeVisible();
  await expect(result.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  expect(page.url()).not.toContain("ABCD-EFGH");
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain("ABCD-EFGH");
  await page.reload();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toHaveCount(0);
  await page.goto("/rooms/room-1");
  await expect(page.getByText("room-1", { exact: true })).toBeVisible();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toHaveCount(0);
});

for (const status of [401, 403, 409]) {
  test(`shows room creation HTTP ${status} without claiming success`, async ({ page }) => {
    await published(page);
    await page.route("**/sessions", (route) =>
      route.fulfill({ status, json: { error: { code: "failed" } } }),
    );
    await page.goto(`/rooms?presentationId=${presentation.id}`);
    await page.getByRole("button", { name: "ルームを作成", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "ルームを作成しました" })).toHaveCount(0);
  });
}

test("does not automatically resend or allow retry after an unknown creation result", async ({
  page,
}) => {
  await published(page);
  let requests = 0;
  await page.route("**/sessions", async (route) => {
    requests++;
    await route.abort("failed");
  });
  await page.goto(`/rooms?presentationId=${presentation.id}`);
  await page.getByRole("button", { name: "ルームを作成", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ルームが作成された可能性");
  await expect(page.getByRole("button", { name: "ルームを作成", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "この公開版からルームを作成" }).click();
  await expect(page.getByRole("button", { name: "ルームを作成", exact: true })).toBeDisabled();
  expect(requests).toBe(1);
});

for (const status of [403, 404]) {
  test(`does not call a removed or inaccessible presentation unpublished (HTTP ${status})`, async ({
    page,
  }) => {
    await published(page);
    await page.route("**/publication", (route) =>
      route.fulfill({ status: 404, json: { error: { code: "not_found" } } }),
    );
    await page.route(`**/presentations/${presentation.id}`, (route) =>
      route.fulfill({ status, json: { error: { code: "not_found" } } }),
    );
    await page.goto("/home");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("公開済み Dist なし")).toHaveCount(0);
  });
}
