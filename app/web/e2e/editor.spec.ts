import { expect, test } from "@playwright/test";
import type { BuildJob, ProjectSnapshot } from "@unframe/unframe-cli/author-contract";

const token = "a".repeat(64);
test("saves Source and reloads Dev and Dist through the Host with a Unity bridge fixture", async ({
  page,
}) => {
  let current: ProjectSnapshot = {
    revision: "r1",
    sourceHash: "s1",
    irHash: "i1",
    definition: null,
    diagnostics: [],
    instances: [
      {
        instanceId: "hero",
        surfaceId: "hero",
        props: { title: { type: "string", value: "Original", editable: true } },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        transformEditable: true,
      },
    ],
  };
  let builds = 0;
  const loaded: string[] = [];
  const jobs = new Map<string, BuildJob>();
  await page.route("**/unity-preview/Build/UnframePreview.loader.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.createUnityInstance = async () => ({
      SendMessage: (_target, method, value) => {
        if (method === 'Prepare') { const envelope = JSON.parse(value); window.dispatchEvent(new CustomEvent('unframe-preview', {detail: {kind:'prepared', requestId:envelope.requestId, buildIdentity:'fixture-build'}})); }
        if (method === 'Commit') window.dispatchEvent(new CustomEvent('unframe-preview', {detail: {kind:'committed', requestId:value, buildIdentity:'fixture-build'}}));
      }, Quit: async () => {}
    });`,
    }),
  );
  await page.route("**/api/**", async (route) => {
    expect(route.request().headers()["authorization"]).toBe(`Bearer ${token}`);
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/publication-auth")
      return route.fulfill({ json: { status: "unconfigured" } });
    if (path === "/api/project" && method === "PATCH") {
      const request = route.request().postDataJSON();
      current = structuredClone(current);
      current.revision = `r${Number(current.revision.slice(1)) + 1}`;
      current.irHash = current.revision;
      current.instances[0]!.props["title"]!.value = request.command.value;
      return route.fulfill({
        json: {
          revision: current.revision,
          sourceHash: current.sourceHash,
          irHash: current.irHash,
          commandId: request.commandId,
        },
      });
    }
    if (path === "/api/project") return route.fulfill({ json: current });
    if (path === "/api/builds") {
      builds++;
      const job: BuildJob = {
        buildId: String(builds),
        revision: current.revision,
        channel: "dev",
        generationId: "f".repeat(32),
        status: "succeeded",
        diagnostics: [],
        artifacts: [],
      };
      jobs.set(job.buildId, job);
      return route.fulfill({ json: job });
    }
    if (path === "/api/previews") {
      const request = route.request().postDataJSON();
      loaded.push(request.channel);
      return route.fulfill({
        json: {
          requestId: request.requestId,
          buildManifest: JSON.stringify({ buildId: "fixture-build" }),
          ...(request.channel === "dev"
            ? { sourceRevision: jobs.get(request.buildId)?.revision }
            : {}),
        },
      });
    }
    if (path === "/api/preview-display") return route.fulfill({ status: 204 });
    return route.abort();
  });
  await page.goto(`/editor.html#token=${token}`);
  await expect(page.getByText("表示 build identity: fixture-build")).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await page.getByRole("button", { name: "hero", exact: true }).click();
  await page.getByLabel("title").fill("Saved");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存 revision: r2")).toBeVisible();
  await expect(page.getByText("表示 mode: dev / 表示 revision: r2")).toBeVisible();
  const beforeDist = builds;
  await page.getByRole("button", { name: "Dist Preview", exact: true }).click();
  await expect(page.getByText("表示 mode: dist / 表示 revision: Dist / なし")).toBeVisible();
  expect(builds).toBe(beforeDist);
  expect(loaded).toEqual(["dev", "dev", "dist"]);
});
