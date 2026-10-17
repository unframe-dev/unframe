import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";

test("inspects the compiled showcase flow without changing Source, builds or Preview", async ({
  page,
}, testInfo) => {
  const { stdout } = await promisify(execFile)(
    "bun",
    [join(import.meta.dirname, "showcase-snapshot.mjs")],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const snapshot = JSON.parse(stdout) as ProjectSnapshot;
  const writes: string[] = [];
  await page.route("**/unity-preview/Build/UnframePreview.loader.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.timelinePreviewMessages = [];
      window.createUnityInstance = async () => ({
        SendMessage: (_target, method, value) => {
          window.timelinePreviewMessages.push(method);
          if (method === 'Prepare') window.dispatchEvent(new CustomEvent('unframe-preview', {detail: {kind:'prepared', requestId:JSON.parse(value).requestId, buildIdentity:'showcase-build'}}));
          if (method === 'Commit') window.dispatchEvent(new CustomEvent('unframe-preview', {detail: {kind:'committed', requestId:value, buildIdentity:'showcase-build'}}));
        }, Quit: async () => {}
      });`,
    }),
  );
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") writes.push(path);
    if (path === "/api/project") return route.fulfill({ json: snapshot });
    if (path === "/api/publication-auth")
      return route.fulfill({ json: { status: "unconfigured" } });
    if (path === "/api/builds")
      return route.fulfill({
        json: {
          buildId: "showcase",
          revision: snapshot.revision,
          channel: "dev",
          generationId: "f".repeat(32),
          status: "succeeded",
          diagnostics: [],
          artifacts: [],
        },
      });
    if (path === "/api/previews")
      return route.fulfill({
        json: {
          requestId: route.request().postDataJSON().requestId,
          sourceRevision: snapshot.revision,
          buildManifest: JSON.stringify({ buildId: "showcase-build" }),
        },
      });
    if (path === "/api/preview-display") return route.fulfill({ status: 204 });
    return route.abort();
  });
  await page.goto(`/editor.html#token=${"a".repeat(64)}`);
  await expect(page.getByText("表示 build identity: showcase-build")).toBeVisible();
  const beforeWrites = [...writes];
  const beforeMessages = await page.evaluate(() => Reflect.get(window, "timelinePreviewMessages"));
  const panel = page.getByRole("region", { name: "Timelines", exact: true });
  await expect(panel).toContainText(`保存 revision: ${snapshot.revision}`);
  const edges = panel.getByRole("list", { name: "Cue の遷移" });
  const steps = ["cover", "problem", "system", "workflow", "closing"];
  for (const [index, step] of steps.entries()) {
    const next = steps[(index + 1) % steps.length]!;
    await expect(
      edges.getByRole("listitem").filter({ hasText: `${step} → Step ${next} / Cue next-${step}` }),
    ).toBeVisible();
    await panel.getByRole("button", { name: `Step ${step}`, exact: true }).click();
    const cues = panel.getByRole("region", { name: "Cue 一覧" });
    await expect(cues.getByRole("button")).toHaveCount(2);
    await expect(cues.getByRole("button").first()).toHaveAccessibleName(`Cue next-${step}`);
  }
  await panel.getByRole("button", { name: "Step cover", exact: true }).focus();
  await page.keyboard.press("Enter");
  await panel.getByRole("button", { name: "Cue next-cover", exact: true }).focus();
  await page.keyboard.press("Space");
  const actions = panel.getByRole("list", { name: "Actions" });
  await expect(actions).toContainText("surface.setState");
  await expect(actions).toContainText("showcase:problem");
  await expect(actions).toContainText("timeline.play");
  const timeline = panel.getByRole("region", { name: "Cue のアニメーション時間軸" });
  await expect(timeline).toContainText("showcase:focus");
  await expect(timeline).toContainText("nonBlocking: 完了を待たずに遷移");
  await expect(timeline).toContainText("opacity");
  await expect(timeline.getByRole("img")).toHaveAccessibleName("Cue 発火から 0–600 ms");
  const firstKey = timeline.getByRole("button", { name: "Cue 発火から 0 ms", exact: true });
  await firstKey.focus();
  await page.keyboard.press("Enter");
  const details = timeline.getByRole("region", { name: "選択したキーフレーム" });
  await expect(details).toContainText("0.72");
  await expect(details).toContainText("cubicOut");
  await timeline.getByLabel("時間軸のズーム").selectOption("4");
  await timeline.getByRole("button", { name: "Cue 発火から 600 ms", exact: true }).click();
  await expect(details.locator("dd").nth(1)).toHaveText("1");
  await timeline.getByLabel("時間軸のズーム").selectOption("1");
  await firstKey.click();
  await panel.screenshot({ path: testInfo.outputPath("showcase-timeline.png") });
  expect(writes).toEqual(beforeWrites);
  expect(await page.evaluate(() => Reflect.get(window, "timelinePreviewMessages"))).toEqual(
    beforeMessages,
  );
  await expect(
    page.getByText(`表示 mode: dev / 表示 revision: ${snapshot.revision}`),
  ).toBeVisible();
});
