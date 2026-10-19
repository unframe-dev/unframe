import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const repository = resolve(import.meta.dirname, "../../..");
const { PNG } = createRequire(join(repository, "packages/unframe-renderer-web/package.json"))(
  "pngjs",
) as {
  PNG: { sync: { read(bytes: Buffer): { data: Buffer } } };
};
const changedPixels = (first: Buffer, second: Buffer) => {
  const a = PNG.sync.read(first).data,
    b = PNG.sync.read(second).data;
  let count = 0;
  for (let index = 0; index < a.length; index += 4)
    if (a[index] !== b[index] || a[index + 1] !== b[index + 1] || a[index + 2] !== b[index + 2])
      count++;
  return count;
};

test.use({ trace: "off" });

test("copied Dist renders models and plays video without the source project @actual-webgl", async ({
  page,
}) => {
  test.skip(
    process.env["UNFRAME_REAL_WEBGL"] !== "1",
    "Requires the Unity WebGL player and media toolchain.",
  );
  test.setTimeout(360_000);
  const child = spawn(
    "bun",
    [join(repository, "packages/unframe-cli/test/copied-dist-webgl-host.ts")],
    { cwd: repository, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const builds: string[] = [],
    mediaTypes: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(dist-builds|builds)(\/|$)/.test(new URL(request.url()).pathname))
      builds.push(request.url());
  });
  page.on("response", (response) => {
    if (response.url().includes("/assets/"))
      mediaTypes.push(response.headers()["content-type"] ?? "");
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const videos = new Set<HTMLVideoElement>();
    const play = HTMLMediaElement.prototype.play;
    (window as Window & { __distVideos?: Set<HTMLVideoElement> }).__distVideos = videos;
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLVideoElement) videos.add(this);
      return play.call(this);
    };
  });
  try {
    const host = await new Promise<{ origin: string; token: string }>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        for (const line of output.split("\n")) {
          try {
            const value = JSON.parse(line);
            if (value.origin && value.token) resolve(value);
          } catch {
            /* The CLI may report build progress before the host starts. */
          }
        }
      });
      child.once("exit", (code) => reject(new Error(`Host exited ${code}: ${stderr}`)));
    });
    await page.goto(`${host.origin}/dist-preview#token=${host.token}`);
    await expect(
      page.getByRole("heading", { name: "Unframe Dist Preview", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          const body = await page.locator("body").innerText();
          if (body.includes("Preview 失敗:")) throw new Error(body);
          return /表示 build identity: build:/.test(body);
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    expect(mediaTypes).toContain("model/gltf-binary");
    expect(mediaTypes).toContain("video/mp4");
    await expect(page.getByRole("button", { name: "本番 build", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dev Preview", exact: true })).toHaveCount(0);
    const playback = page.getByRole("group", { name: "Preview 再生" });
    const canvas = page.locator('canvas[aria-label="Unity Preview"]');
    const initial = await canvas.screenshot();
    await playback.getByRole("button", { name: "再生", exact: true }).click();
    await expect
      .poll(async () => changedPixels(initial, await canvas.screenshot()), { timeout: 10_000 })
      .toBeGreaterThan(30);
    await playback.getByRole("button", { name: "videoPlay", exact: true }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [
              ...((window as Window & { __distVideos?: Set<HTMLVideoElement> }).__distVideos ?? []),
            ].some((video) => video.videoWidth > 0 && video.currentTime > 0.25 && !video.paused),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.getByRole("button", { name: "一時停止", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          [
            ...((window as Window & { __distVideos?: Set<HTMLVideoElement> }).__distVideos ?? []),
          ].every((video) => video.paused),
        ),
      )
      .toBe(true);
    expect(builds).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await exited;
    }
  }
});
