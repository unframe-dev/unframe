import { expect, test, type Page } from "@playwright/test";
import type { PublishedPresentation } from "@unframe/contracts/presentation";

const presentation = { id: "presentation-1", name: "公開済みプレゼン" };
const publication = {
  schemaVersion: 3,
  presentationId: presentation.id,
  publicationEpoch: 3,
  publicationManifestHash: `sha256:${"a".repeat(64)}`,
  sourceDraftRevision: 1,
  buildId: "build-3",
  definitionHash: `sha256:${"b".repeat(64)}`,
  renderBundleHash: `sha256:${"c".repeat(64)}`,
  assetSetHash: `sha256:${"d".repeat(64)}`,
  contractVersions: {
    definition: 3,
    renderBundle: 2,
    assetSet: 2,
    delivery: 3,
    runtime: 3,
    progression: 2,
    projection: 2,
  },
} satisfies PublishedPresentation;
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
  await page.route("**/sessions?*", (route) =>
    route.fulfill({ json: { sessions: [], nextCursor: null } }),
  );
  await page.route("**/join-code", (route) => route.fulfill({ json: { joinCode: "ABCD-EFGH" } }));
  await page.route("**/runtime-preparation", (route) =>
    route.fulfill({ json: { state: "unassigned" } }),
  );
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
  await expect(page.getByText("未公開")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("shows current publication details and reloads a republished build", async ({ page }) => {
  await published(page);
  await page.goto("/home");
  await expect(page.getByText("Build ID: build-3")).toBeVisible();
  await page.getByRole("link", { name: "公開済みプレゼンテーションの詳細" }).click();
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
    await expect(page.getByText("未公開")).toHaveCount(0);
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
  await page.getByRole("link", { name: "公開済みプレゼンテーションの詳細" }).click();
  await page.getByRole("link", { name: "この Presentation でルームを作成" }).click();
  const create = page.getByRole("button", { name: "ルームを作成", exact: true });
  await create.dblclick();
  await expect(page).toHaveURL(/\/rooms\/room-1$/);
  const result = page.getByRole("main");
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
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await page.goto("/rooms/room-1");
  await expect(page.getByText("room-1", { exact: true })).toBeVisible();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
});

test("prepares a room, polls readiness, starts and ends exactly once through normal UI", async ({
  page,
}) => {
  let state = "Waiting";
  let preparing = false;
  let polls = 0;
  const requests: string[] = [];
  const preparation = {
    runtimeId: "runtime-1",
    assignmentEpoch: 1,
    leaseExpiresAt: "2027-10-28T00:00:00.000Z",
  };
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: { ...room, state } }));
  await page.route("**/sessions/room-1/runtime-preparation", async (route) => {
    if (route.request().method() === "POST") {
      requests.push("prepare");
      preparing = true;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ json: { ...preparation, state: "starting" } });
    } else if (!preparing) {
      await route.fulfill({ json: { state: "unassigned" } });
    } else {
      polls++;
      await route.fulfill({ json: { ...preparation, state: polls > 1 ? "ready" : "starting" } });
    }
  });
  for (const action of ["start", "end"]) {
    await page.route(`**/sessions/room-1/${action}`, async (route) => {
      requests.push(action);
      state = action === "start" ? "Presenting" : "Ended";
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ json: { ...room, state } });
    });
  }
  await page.goto("/rooms/room-1");
  await expect(page.getByRole("button", { name: "発表を開始", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "発表環境を準備", exact: true }).dblclick();
  await expect(page.getByText("発表環境を準備しています。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "発表を開始", exact: true })).toBeEnabled();
  expect(polls).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "発表を開始", exact: true }).dblclick();
  await expect(page.getByText("Presenting", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "発表を終了", exact: true }).dblclick();
  await expect(page.getByText("Ended", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "発表環境を準備", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "発表を開始", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "発表を終了", exact: true })).toHaveCount(0);
  expect(requests).toEqual(["prepare", "start", "end"]);
});

test("retries unavailable runtime preparation in the same room", async ({ page }) => {
  let requests = 0;
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  await page.route("**/sessions/room-1/runtime-preparation", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { state: "unassigned" } });
      return;
    }
    requests++;
    await route.fulfill(
      requests === 1
        ? { status: 409, json: { error: { code: "runtime_unavailable" } } }
        : {
            json: {
              state: "ready",
              runtimeId: "runtime-1",
              assignmentEpoch: 1,
              leaseExpiresAt: "2027-10-28T00:00:00.000Z",
            },
          },
    );
  });
  await page.goto("/rooms/room-1");
  await page.getByRole("button", { name: "発表環境を準備", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("利用できる発表環境がありません");
  await expect(page.getByRole("button", { name: "発表を開始", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "発表環境を準備", exact: true }).click();
  await expect(page.getByRole("button", { name: "発表を開始", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(requests).toBe(2);
  await expect(page).toHaveURL(/\/rooms\/room-1$/);
});

test("allows preparation retry after readiness polling fails", async ({ page }) => {
  let attempts = 0;
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  await page.route("**/sessions/room-1/runtime-preparation", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(
        attempts > 0
          ? { status: 503, json: { error: { code: "unavailable" } } }
          : { json: { state: "unassigned" } },
      );
    } else {
      attempts++;
      await route.fulfill({
        json: {
          state: attempts > 1 ? "ready" : "starting",
          runtimeId: "runtime-1",
          assignmentEpoch: 1,
          leaseExpiresAt: "2027-10-28T00:00:00.000Z",
        },
      });
    }
  });
  await page.goto("/rooms/room-1");
  await page.getByRole("button", { name: "発表環境を準備", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("通信に失敗");
  await expect(page.getByRole("button", { name: "発表を開始", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "発表環境を準備", exact: true }).click();
  await expect(page.getByRole("button", { name: "発表を開始", exact: true })).toBeEnabled();
  expect(attempts).toBe(2);
});

test("ended room never offers preparation or presentation actions", async ({ page }) => {
  let preparationRequests = 0;
  await page.route("**/sessions/room-1", (route) =>
    route.fulfill({ json: { ...room, state: "Ended" } }),
  );
  await page.route("**/sessions/room-1/runtime-preparation", (route) => {
    preparationRequests++;
    return route.fulfill({ json: { state: "ended" } });
  });
  await page.goto("/rooms/room-1");
  await expect(page.getByText("このルームの発表は終了しました。", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /発表環境を準備|発表を開始|発表を終了/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ルームコードを更新", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "匿名 Viewer で開く" })).toHaveCount(0);
  expect(preparationRequests).toBe(0);
});

test("returns from a created room to the owned-room list", async ({ page }) => {
  await published(page);
  await page.route("**/sessions", (route) =>
    route.fulfill({ status: 201, json: { session: room, joinCode: "ABCD-EFGH" } }),
  );
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  await page.goto(`/rooms?presentationId=${presentation.id}`);
  await page.getByRole("button", { name: "ルームを作成", exact: true }).click();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();

  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "ルーム", exact: true })
    .click();

  await expect(page).toHaveURL(/\/rooms(?:\?presentationId=)?$/);
  await expect(page.getByRole("region", { name: "ルーム作成結果" })).toHaveCount(0);
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "選択した Presentation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "この公開版からルームを作成" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/rooms\/room-1$/);
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
});

test("isolates a pending room creation from the room chooser after navigation", async ({
  page,
}) => {
  await published(page);
  let releaseResponse!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requests = 0;
  await page.route("**/sessions", async (route) => {
    requests++;
    if (requests === 1) await responseReady;
    await route.fulfill({
      status: 201,
      json: { session: room, joinCode: requests === 1 ? "OLD-CODE" : "NEW-CODE" },
    });
  });
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  await page.goto(`/rooms?presentationId=${presentation.id}`);
  await page.getByRole("button", { name: "この公開版からルームを作成" }).click();
  await page.getByRole("button", { name: "ルームを作成", exact: true }).click();
  await expect(page.getByRole("button", { name: "作成しています…" })).toBeDisabled();
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "ルーム", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "選択した Presentation" })).toHaveCount(0);
  await page.getByRole("button", { name: "この公開版からルームを作成" }).click();
  const create = page.getByRole("button", { name: "ルームを作成", exact: true });
  await expect(create).toBeEnabled();

  const oldResponse = page.waitForResponse("**/sessions");
  releaseResponse();
  await oldResponse;
  await create.click();
  await expect(page).toHaveURL(/\/rooms\/room-1$/);
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await expect(page.getByText("OLD-CODE", { exact: true })).toHaveCount(0);
  expect(requests).toBe(2);
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
    await expect(page.getByText("未公開")).toHaveCount(0);
  });
}

test("reopens an owned room through the paged list and reloads the list", async ({ page }) => {
  await published(page);
  let reloads = 0;
  await page.route("**/sessions?*", (route) => {
    reloads++;
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      json: cursor
        ? { sessions: [{ ...room, id: "room-2" }], nextCursor: null }
        : { sessions: [room], nextCursor: "room-1" },
    });
  });
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  await page.goto("/rooms");
  await page.getByRole("button", { name: "ルームをさらに表示" }).click();
  await expect(page.getByRole("link", { name: "room-2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ルーム一覧を再取得" }).click();
  await expect.poll(() => reloads).toBeGreaterThanOrEqual(4);
  await page.getByRole("link", { name: "room-1", exact: true }).click();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "匿名 Viewer で開く" })).toHaveAttribute(
    "href",
    "https://app.un-fra.me/#join=ABCD-EFGH",
  );
});

test("rotates invitations and the locally generated QR with a single submission", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  let code = "ABCD-EFGH";
  let updates = 0;
  await page.route("**/join-code", async (route) => {
    if (route.request().method() === "POST") {
      updates++;
      await new Promise((resolve) => setTimeout(resolve, 150));
      code = "JKLM-NPQR";
    }
    await route.fulfill({ json: { joinCode: code } });
  });
  await page.goto("/rooms/room-1");
  await page.getByRole("button", { name: "QR コードを生成" }).click();
  const qr = page.getByRole("img", { name: "匿名 Viewer 参加用 QR コード" });
  await expect(qr).toBeVisible();
  const previous = await qr.getAttribute("src");
  await page.getByRole("button", { name: "ルームコードを更新", exact: true }).dblclick();
  await expect(page.getByText("JKLM-NPQR", { exact: true })).toBeVisible();
  await expect(qr).not.toHaveAttribute("src", previous!);
  const url = "https://app.un-fra.me/#join=JKLM-NPQR";
  await expect(page.getByRole("link", { name: "匿名 Viewer で開く" })).toHaveAttribute("href", url);
  await page.getByRole("button", { name: "参加 URL をコピー" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  const pixels = await qr.evaluate((element) => {
    const img = element as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
    };
  });
  const { default: decodeQR } = await import("qr/decode.js");
  expect(decodeQR({ ...pixels, data: Uint8Array.from(pixels.data) })).toBe(url);
  expect(updates).toBe(1);
});

test("hides stale invitations after an unknown rotation result until explicit refetch", async ({
  page,
}) => {
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  let code = "ABCD-EFGH";
  await page.route("**/join-code", (route) => {
    if (route.request().method() === "POST") {
      code = "JKLM-NPQR";
      return route.abort("failed");
    }
    return route.fulfill({ json: { joinCode: code } });
  });
  await page.goto("/rooms/room-1");
  await page.getByRole("button", { name: "QR コードを生成" }).click();
  await page.getByRole("button", { name: "ルームコードを更新", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("再取得してから共有");
  await expect(page.getByRole("link", { name: "匿名 Viewer で開く" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "匿名 Viewer 参加用 QR コード" })).toHaveCount(0);
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "ルームコードを再取得" }).click();
  await expect(page.getByText("JKLM-NPQR", { exact: true })).toBeVisible();
});

for (const status of [401, 403]) {
  test(`does not share a code when current-code access is denied (HTTP ${status})`, async ({
    page,
  }) => {
    await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
    await page.route("**/join-code", (route) =>
      route.fulfill({ status, json: { error: { code: "forbidden" } } }),
    );
    await page.goto("/rooms/room-1");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("link", { name: "匿名 Viewer で開く" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "ルームコードを更新", exact: true }),
    ).toBeDisabled();
  });
}

test("keeps sharing blocked across navigation while a rotation is pending or uncertain", async ({
  page,
}) => {
  await published(page);
  await page.route("**/sessions/room-1", (route) => route.fulfill({ json: room }));
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let code = "ABCD-EFGH";
  await page.route("**/join-code", async (route) => {
    if (route.request().method() === "POST") {
      await waiting;
      code = "JKLM-NPQR";
      return route.abort("failed");
    }
    return route.fulfill({ json: { joinCode: code } });
  });
  await page.goto("/rooms/room-1");
  await page.getByRole("button", { name: "ルームコードを更新", exact: true }).click();
  await page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "ルーム", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "ルーム", exact: true })).toBeVisible();
  const returnedCode = page.waitForResponse(
    (response) => response.url().endsWith("/join-code") && response.request().method() === "GET",
  );
  await page.goBack();
  await returnedCode;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole("heading", { name: "ルームの詳細" })).toBeVisible();
  await expect(page.getByRole("link", { name: "匿名 Viewer で開く" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "ルームコードを更新", exact: true }),
  ).toBeDisabled();
  release();
  await expect(page.getByRole("alert")).toContainText("再取得してから共有");
  await expect(page.getByRole("link", { name: "匿名 Viewer で開く" })).toHaveCount(0);
  await page.getByRole("button", { name: "ルームコードを再取得" }).click();
  await expect(page.getByText("JKLM-NPQR", { exact: true })).toBeVisible();
});
