import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as base, type Page, type Route } from "@playwright/test";
import { hashCanonicalJsonPayload } from "@unframe/artifacts";
import type { PublishedPresentation } from "@unframe/contracts/presentation";
import { distFixture } from "../src/features/publication/test-support/dist-fixture";

type Dist = { directory: string; fixture: ReturnType<typeof distFixture> };
const test = base.extend<{ dist: Dist }>({
  dist: async ({ baseURL }, use) => {
    if (!baseURL || new URL(baseURL).hostname !== "127.0.0.1")
      throw new Error("Dist upload tests require a loopback application URL.");
    const root = await mkdtemp(join(tmpdir(), "unframe-console-dist-"));
    const directory = join(root, "dist");
    const fixture = distFixture();
    try {
      for (const [path, bytes] of fixture.rawFiles) {
        const destination = join(directory, path);
        await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, bytes);
      }
      await use({ directory, fixture });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
});

const publication = (
  dist: Dist,
  epoch: number,
  buildId = dist.fixture.artifacts.buildManifest.buildId,
): PublishedPresentation => {
  const payload = { ...dist.fixture.artifacts.buildManifest, buildId, publicationEpoch: epoch };
  return { ...payload, publicationManifestHash: hashCanonicalJsonPayload(payload) };
};
type RecordedRequest = { path: string; method: string; body: Buffer | null };
async function remote(page: Page, dist: Dist) {
  const id = dist.fixture.artifacts.buildManifest.presentationId;
  const apiPath = `/presentations/${encodeURIComponent(id)}`;
  const state = {
    exists: false,
    current: null as PublishedPresentation | null,
    readError: undefined as number | undefined,
    requests: [] as RecordedRequest[],
    uploadedAssets: new Set<string>(),
    publicationRequests: 0,
    onPublication: undefined as ((route: Route) => Promise<void>) | undefined,
  };
  await page.route("**/presentations**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).port === "4173") return route.continue();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    state.requests.push({ path, method, body: request.postDataBuffer() });
    if (method === "GET" && path === "/presentations")
      return route.fulfill({
        json: {
          presentations: state.current
            ? [{ id, name: dist.fixture.artifacts.definition.metadata.title }]
            : [],
        },
      });
    if (method === "GET" && state.readError)
      return route.fulfill({
        status: state.readError,
        json: { error: { code: "request_failed" } },
      });
    if (method === "GET" && path === apiPath)
      return state.exists
        ? route.fulfill({ json: { id, name: "既存のプレゼンテーション" } })
        : route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
    if (method === "GET" && path === `${apiPath}/publication`)
      return state.current
        ? route.fulfill({ json: state.current })
        : route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
    if (
      method === "GET" &&
      state.current &&
      path === `${apiPath}/builds/${encodeURIComponent(state.current.buildId)}/thumbnail`
    )
      return route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
    if (method === "POST" && path === "/presentations") {
      expect(request.postDataJSON()).toEqual({
        id,
        name: dist.fixture.artifacts.definition.metadata.title,
      });
      state.exists = true;
      return route.fulfill({ status: 201, json: { id } });
    }
    if (method === "POST" && path === `${apiPath}/builds`) {
      const envelope = request.postDataJSON();
      for (const [field, artifact] of Object.entries({
        definitionJson: dist.fixture.artifacts.definition,
        renderBundleJson: dist.fixture.artifacts.renderBundle,
        assetSetJson: dist.fixture.artifacts.assetSet,
        buildManifestJson: dist.fixture.artifacts.buildManifest,
      })) {
        expect(JSON.parse(envelope[field])).toEqual(artifact);
      }
      return route.fulfill({
        status: 201,
        json: {
          buildId: dist.fixture.artifacts.buildManifest.buildId,
          assetIds: Object.keys(dist.fixture.artifacts.assetSet.assets),
        },
      });
    }
    if (method === "PUT" && path.includes("/assets/")) {
      const assetId = decodeURIComponent(path.split("/").at(-1)!);
      const descriptor = dist.fixture.artifacts.assetSet.assets[assetId];
      expect(descriptor).toBeDefined();
      const body = request.postDataBuffer();
      expect(body).not.toBeNull();
      expect(body!.byteLength).toBe(descriptor!.encodedSizeBytes);
      expect(request.headers()["content-type"]).toBe(descriptor!.mediaType);
      expect(`sha256:${createHash("sha256").update(body!).digest("hex")}`).toBe(
        descriptor!.checksum,
      );
      state.uploadedAssets.add(assetId);
      return route.fulfill({ status: 204 });
    }
    if (method === "POST" && path === `${apiPath}/publications`) {
      state.publicationRequests++;
      if (state.onPublication) return state.onPublication(route);
      state.current = publication(dist, (state.current?.publicationEpoch ?? 0) + 1);
      return route.fulfill({ status: 201, json: state.current });
    }
    await route.abort();
    throw new Error(`Unexpected mocked publication request: ${method} ${path}`);
  });
  return state;
}
const chooseDist = async (page: Page, dist: Dist) => {
  await page.goto("/publish");
  await page.getByLabel("Dist フォルダ", { exact: true }).setInputFiles(dist.directory);
};
const leaveAndReturn = async (page: Page) => {
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "ホーム", exact: true })
    .click();
  await page.getByRole("link", { name: "プレゼンテーションを公開", exact: true }).click();
};

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
    if (url.port === "8787" && !["GET", "HEAD"].includes(route.request().method()))
      return route.abort();
    return route.continue();
  });
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: { id: "upload-user", name: "テストユーザー", emailVerified: true },
        session: { id: "upload-session", expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    }),
  );
  await page.route("**/presentations**", (route) => {
    if (new URL(route.request().url()).port === "4173") return route.continue();
    if (route.request().method() !== "GET") return route.abort();
    return new URL(route.request().url()).pathname === "/presentations"
      ? route.fulfill({ json: { presentations: [] } })
      : route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
  });
});

test("opens Dist publication from the presentation list", async ({ page }) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "プレゼンテーションを公開", exact: true }).click();
  await expect(page.getByRole("heading", { name: "プレゼンテーションを公開" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dist フォルダを選択" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "公開する", exact: true })).toHaveCount(0);
});

test("confirms a new Dist before writing and publishes every validated asset exactly once", async ({
  page,
  dist,
}, testInfo) => {
  const server = await remote(page, dist);
  await chooseDist(page, dist);
  await expect(page.getByText("新規公開します。", { exact: true })).toBeVisible();
  expect(server.requests.every(({ method }) => method === "GET")).toBe(true);
  await testInfo.attach("Dist publication confirmation", {
    body: await page.screenshot({
      path: testInfo.outputPath("dist-confirmation.png"),
      fullPage: true,
    }),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "公開する", exact: true }).dblclick();
  await expect(page.getByText("公開しました。", { exact: true })).toBeVisible();
  expect(server.publicationRequests).toBe(1);
  expect([...server.uploadedAssets].sort()).toEqual(
    Object.keys(dist.fixture.artifacts.assetSet.assets).sort(),
  );
  const submitted = server.requests.find(({ path }) => path.endsWith("/publications"));
  expect(JSON.parse(submitted!.body!.toString())).toEqual({
    buildId: dist.fixture.artifacts.buildManifest.buildId,
    expectedPublicationFence: null,
  });
  await expect(page.getByRole("link", { name: "プレゼンテーションを開く" })).toHaveAttribute(
    "href",
    `/presentations/${dist.fixture.artifacts.buildManifest.presentationId}`,
  );
  await testInfo.attach("Dist publication completed", {
    body: await page.screenshot({
      path: testInfo.outputPath("dist-completed.png"),
      fullPage: true,
    }),
    contentType: "image/png",
  });
});

test("shows an existing publication update and sends its confirmed fence", async ({
  page,
  dist,
}) => {
  const server = await remote(page, dist);
  server.exists = true;
  server.current = publication(dist, 4, "old-build");
  const confirmed = {
    presentationId: server.current.presentationId,
    publicationEpoch: server.current.publicationEpoch,
    publicationManifestHash: server.current.publicationManifestHash,
  };
  await chooseDist(page, dist);
  await expect(
    page.getByText("公開済みプレゼンテーションを更新します。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("更新先：既存のプレゼンテーション")).toBeVisible();
  const readsBeforeConfirmation = server.requests.filter(({ method }) => method === "GET").length;
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page.getByText("公開しました。", { exact: true })).toBeVisible();
  const submitted = server.requests.find(({ path }) => path.endsWith("/publications"));
  expect(JSON.parse(submitted!.body!.toString()).expectedPublicationFence).toEqual(confirmed);
  expect(server.requests.filter(({ method }) => method === "GET")).toHaveLength(
    readsBeforeConfirmation,
  );
});

for (const defect of ["missing", "tampered"] as const) {
  test(`rejects a ${defect} Dist before reading the publication target`, async ({ page, dist }) => {
    const server = await remote(page, dist);
    if (defect === "missing") await unlink(join(dist.directory, "asset-set.json"));
    else {
      const [path, original] = [...dist.fixture.rawFiles].find(([path]) =>
        path.startsWith("assets/"),
      )!;
      const corrupted = original.slice();
      corrupted[0] = corrupted[0]! ^ 1;
      await writeFile(join(dist.directory, path), corrupted);
    }
    await chooseDist(page, dist);
    await expect(page.getByRole("alert")).toContainText(
      defect === "missing" ? "必要なファイルがありません" : "内容を検証できません",
    );
    await expect(page.getByRole("button", { name: "公開する", exact: true })).toHaveCount(0);
    expect(server.requests).toEqual([]);
  });
}

test("does not retry a conflicting publication until the user confirms its target again", async ({
  page,
  dist,
}) => {
  const server = await remote(page, dist);
  server.onPublication = (route) =>
    route.fulfill({ status: 409, json: { error: { code: "conflict" } } });
  await chooseDist(page, dist);
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("未終了のルーム");
  await expect(page.getByRole("button", { name: "公開先を再確認" })).toBeVisible();
  await expect(page.getByRole("button", { name: "公開する", exact: true })).toHaveCount(0);
  expect(server.publicationRequests).toBe(1);
});

test("keeps an unknown result blocked across navigation and unsuccessful or stale checks", async ({
  page,
  dist,
}) => {
  const server = await remote(page, dist);
  server.exists = true;
  server.current = publication(dist, 3, "old-build");
  server.onPublication = (route) => route.abort("failed");
  await chooseDist(page, dist);
  await page.getByRole("button", { name: "公開する", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("公開された可能性");
  await expect(page.getByRole("button", { name: "Dist フォルダを選び直す" })).toBeDisabled();
  await leaveAndReturn(page);
  await expect(page.getByRole("button", { name: "公開情報を確認" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dist フォルダを選び直す" })).toBeDisabled();
  server.readError = 503;
  await page.getByRole("button", { name: "公開情報を確認" }).click();
  await expect(page.getByRole("button", { name: "公開情報を確認" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "公開する", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dist フォルダを選び直す" })).toBeDisabled();
  server.readError = undefined;
  await page.getByRole("button", { name: "公開情報を確認" }).click();
  await expect(page.getByRole("button", { name: "公開情報を確認" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "公開する", exact: true })).toHaveCount(0);
  server.current = publication(dist, 4);
  await page.getByRole("button", { name: "公開情報を確認" }).click();
  await expect(
    page.getByText("この Dist はすでに公開されています。", { exact: true }),
  ).toBeVisible();
  expect(server.publicationRequests).toBe(1);
});

test("retains an in-flight publication across route changes and refreshes the active list on completion", async ({
  page,
  dist,
}) => {
  const server = await remote(page, dist);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.onPublication = async (route) => {
    await gate;
    server.current = publication(dist, 1);
    await route.fulfill({ status: 201, json: server.current });
  };
  try {
    await chooseDist(page, dist);
    await page.getByRole("button", { name: "公開する", exact: true }).click();
    await expect.poll(() => server.publicationRequests).toBe(1);
    await leaveAndReturn(page);
    await expect(page.getByRole("button", { name: "公開しています…", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Dist フォルダを選び直す" })).toBeDisabled();
    const listResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).port !== "4173" &&
        new URL(response.url()).pathname === "/presentations" &&
        response.request().method() === "GET",
    );
    await page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name: "ホーム", exact: true })
      .click();
    await listResponse;
    await expect(page.getByText("プレゼンテーションがありません。", { exact: true })).toBeVisible();
    const previousReads = server.requests.filter(
      ({ path, method }) => path === "/presentations" && method === "GET",
    ).length;
    release();
    await expect(
      page.getByRole("heading", {
        name: dist.fixture.artifacts.definition.metadata.title,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("サムネイルなし", { exact: true })).toBeVisible();
    expect(
      server.requests.filter(({ path, method }) => path === "/presentations" && method === "GET")
        .length,
    ).toBeGreaterThan(previousReads);
    await page.getByRole("link", { name: "プレゼンテーションを公開", exact: true }).click();
    await expect(page.getByText("公開しました。", { exact: true })).toBeVisible();
    expect(server.publicationRequests).toBe(1);
  } finally {
    release();
  }
});
