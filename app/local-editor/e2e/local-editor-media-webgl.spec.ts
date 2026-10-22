import { test, expect } from "@playwright/test";
import type { PreviewPlaybackResponse } from "@unframe/unframe-cli/author-contract";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

test.use({ trace: "off" });

const repository = resolve(import.meta.dirname, "../../..");
const { PNG } = createRequire(join(repository, "packages/unframe-renderer-web/package.json"))(
  "pngjs",
) as {
  PNG: { sync: { read(bytes: Buffer): { width: number; height: number; data: Buffer } } };
};
const changedPixels = (a: Buffer, b: Buffer) => {
  const first = PNG.sync.read(a),
    second = PNG.sync.read(b);
  let count = 0;
  for (let i = 0; i < first.data.length; i += 4)
    if (
      first.data[i] !== second.data[i] ||
      first.data[i + 1] !== second.data[i + 1] ||
      first.data[i + 2] !== second.data[i + 2]
    )
      count++;
  return count;
};

test("actual Unity WebGL displays Model clips and plays Video in Dev and Dist @actual-webgl", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env["UNFRAME_REAL_WEBGL"] !== "1",
    "Requires built Unity WebGL and delegated capture scope.",
  );
  test.setTimeout(360_000);
  const child = spawn(
    "bun",
    [join(repository, "packages/unframe-cli/test/local-editor-webgl-host.ts")],
    {
      cwd: repository,
      env: { ...process.env, UNFRAME_WEBGL_FIXTURE: "media" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const host = await new Promise<{ origin: string; token: string }>((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      for (const line of output.split("\n"))
        try {
          const value = JSON.parse(line);
          if (value.origin && value.token) resolve(value);
        } catch {}
    });
    child.once("exit", (code) => reject(new Error(`Host exited ${code}: ${stderr}`)));
  });
  const errors: string[] = [],
    states: PreviewPlaybackResponse[] = [],
    assets: { path: string; mediaType: string }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(message.text());
      process.stderr.write(`Browser: ${message.text()}\n`);
    }
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/api/previews") && response.status() === 200)
      void response.json().then(async (value) => {
        await mkdir(join(repository, ".unframe/actual-webgl-evidence"), { recursive: true });
        await writeFile(
          join(repository, ".unframe/actual-webgl-evidence/media-envelope.json"),
          JSON.stringify(value, null, 2),
        );
      });
    if (response.url().includes("/assets/"))
      assets.push({ path: response.url(), mediaType: response.headers()["content-type"] ?? "" });
    if (response.url().endsWith("/api/preview-playback"))
      void response
        .json()
        .then((value) => states.push(value))
        .catch(() => {});
  });
  await page.addInitScript(() => {
    const videos = new Set<HTMLVideoElement>();
    const play = HTMLMediaElement.prototype.play;
    (window as Window & { __mediaVideos?: Set<HTMLVideoElement> }).__mediaVideos = videos;
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLVideoElement) videos.add(this);
      return play.call(this);
    };
  });
  const video = () =>
    page.evaluate(() =>
      [...((window as Window & { __mediaVideos?: Set<HTMLVideoElement> }).__mediaVideos ?? [])].map(
        (v) => ({
          time: v.currentTime,
          paused: v.paused,
          muted: v.muted,
          ready: v.readyState,
          width: v.videoWidth,
          height: v.videoHeight,
          audioBytes:
            (v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number })
              .webkitAudioDecodedByteCount ?? 0,
        }),
      ),
    );
  const cdp = await page.context().newCDPSession(page);
  const inspectWithoutGesture = async (expression: string) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      userGesture: false,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value as unknown;
  };
  try {
    await page.goto(`${host.origin}/#token=${host.token}`);
    await expect
      .poll(
        async () => {
          const text = String(await inspectWithoutGesture("document.body.innerText"));
          if (text.includes("Preview 失敗:")) throw new Error(text);
          return /表示 build identity: build:/.test(text);
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    const canvas = page.locator('canvas[aria-label="Unity Preview"]');
    const input = (cue: string) =>
      page
        .getByRole("group", { name: "Preview 再生" })
        .getByRole("button", { name: cue, exact: true });
    const noGestureClick = (label: string) =>
      cdp.send("Runtime.evaluate", {
        expression: `Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`,
        userGesture: false,
      });
    await expect
      .poll(async () =>
        inspectWithoutGesture(
          'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "再生" && !button.disabled)',
        ),
      )
      .toBe(true);
    expect(await inspectWithoutGesture("navigator.userActivation.hasBeenActive")).toBe(false);
    await noGestureClick("再生");
    await expect
      .poll(async () =>
        inspectWithoutGesture(
          'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "videoPlay" && !button.disabled)',
        ),
      )
      .toBe(true);
    expect(await inspectWithoutGesture("navigator.userActivation.hasBeenActive")).toBe(false);
    await noGestureClick("videoPlay");
    await expect
      .poll(
        async () =>
          String(await inspectWithoutGesture("document.body.innerText")).includes(
            "再生失敗: video-user-activation-required",
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: "再生", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "再生", exact: true }).click();
    await expect
      .poll(async () => (await video()).some((v) => !v.paused && v.time > 0.1))
      .toBe(true);
    await page.getByRole("button", { name: "一時停止", exact: true }).click();
    await expect.poll(async () => (await video()).every((v) => v.paused)).toBe(true);
    const frozenTimes = (await video()).map((v) => v.time);
    await page.waitForTimeout(350);
    expect((await video()).map((v) => v.time)).toEqual(frozenTimes);
    await page.getByRole("button", { name: "リセット", exact: true }).click();
    const initial = await canvas.screenshot({ path: testInfo.outputPath("media-initial.png") });
    await page.getByRole("button", { name: "再生", exact: true }).click();
    await expect(input("modelPause")).toBeEnabled();
    await expect
      .poll(() => states.some((value) => value.state?.activeRuns?.some((run) => run.modelClip)))
      .toBe(true);
    await expect
      .poll(async () => changedPixels(initial, await canvas.screenshot()))
      .toBeGreaterThan(30);
    await input("modelPause").click();
    await expect
      .poll(() =>
        states
          .at(-1)
          ?.state?.activeRuns?.filter((run) => run.modelClip)
          .every((run) => run.modelClip?.single?.playback?.paused),
      )
      .toBe(true);
    await input("modelResume").click();
    await input("videoPlay").click();
    await expect
      .poll(async () => (await video()).some((v) => v.ready >= 2 && v.time > 0.2 && !v.paused), {
        timeout: 30_000,
      })
      .toBe(true);
    expect((await video()).some((v) => v.width === 320 && v.height === 180 && !v.muted)).toBe(true);
    await expect
      .poll(async () => (await video()).some((v) => v.audioBytes > 0), { timeout: 10_000 })
      .toBe(true);
    const playing = await canvas.screenshot({ path: testInfo.outputPath("media-playing.png") });
    await expect
      .poll(async () => changedPixels(playing, await canvas.screenshot()))
      .toBeGreaterThan(100);
    await input("videoPause").click();
    await expect.poll(async () => (await video()).every((v) => v.paused)).toBe(true);
    await input("videoSeek").click();
    await expect
      .poll(async () => (await video()).some((v) => Math.abs(v.time - 0.25) < 0.12))
      .toBe(true);
    await input("modelFade").click();
    await expect
      .poll(() =>
        states.some((value) => value.state?.activeRuns?.some((run) => run.modelClip?.crossfade)),
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          states
            .at(-1)
            ?.state?.modelClipStates?.some((state) => state.heldClip?.clipId === "clip-1"),
        { timeout: 10_000 },
      )
      .toBe(true);
    await input("loopOn").click();
    await expect
      .poll(() =>
        states.at(-1)?.state.surfaceStates?.some((state) => state.stateId === "video:loop"),
      )
      .toBe(true);
    await input("videoPlay").click();
    await expect
      .poll(async () => (await video()).some((v) => v.time > 4.8 && !v.paused), { timeout: 10_000 })
      .toBe(true);
    await expect
      .poll(async () => (await video()).some((v) => v.time < 1.5 && !v.paused), { timeout: 5_000 })
      .toBe(true);
    expect(states.at(-1)?.state.mediaStates?.some((state) => state.active)).toBe(true);
    await input("loopOff").click();
    await expect
      .poll(() =>
        states.at(-1)?.state.surfaceStates?.some((state) => state.stateId === "video:default"),
      )
      .toBe(true);
    await input("videoSeek").click();
    await input("videoPlay").click();
    await expect
      .poll(() => states.at(-1)?.state.mediaStates?.some((state) => state.active))
      .toBe(true);
    await expect
      .poll(
        () =>
          states.at(-1)?.state.mediaStates?.every((state) => state.stopped?.heldPositionMs === 0),
        { timeout: 10_000 },
      )
      .toBe(true);
    await page.getByRole("button", { name: "一時停止", exact: true }).click();
    await expect.poll(async () => (await video()).every((v) => v.paused)).toBe(true);
    await page.getByRole("button", { name: "リセット", exact: true }).click();
    await expect
      .poll(() => states.at(-1)?.state?.modelClipStates?.every((state) => state.defaultPose))
      .toBe(true);
    await page.getByRole("button", { name: "本番 build" }).click();
    await expect(
      page.getByText("Dist build 完了。Dist Preview を読み込んで確認してください。"),
    ).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Dist Preview", exact: true }).click();
    await expect(page.getByText(/表示 mode: dist/)).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "再生", exact: true }).click();
    await input("videoPlay").click();
    await expect
      .poll(async () => (await video()).some((v) => !v.paused && v.time > 0.2), { timeout: 30_000 })
      .toBe(true);
    const dist = await canvas.screenshot({ path: testInfo.outputPath("media-dist.png") });
    const evidence = join(repository, ".unframe/actual-webgl-evidence");
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "media-dev.png"), playing);
    await writeFile(join(evidence, "media-dist.png"), dist);
    expect(assets.some((asset) => asset.mediaType === "model/gltf-binary")).toBe(true);
    expect(assets.some((asset) => asset.mediaType === "video/mp4")).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach("media-diagnostics", {
      body: JSON.stringify({
        errors,
        states: states.slice(-5),
        videos: await video(),
        assets,
        stderr,
      }),
      contentType: "application/json",
    });
    await mkdir(join(repository, ".unframe/actual-webgl-evidence"), { recursive: true });
    await writeFile(
      join(repository, ".unframe/actual-webgl-evidence/media-diagnostics.json"),
      JSON.stringify(
        { errors, states: states.slice(-5), videos: await video(), assets, stderr },
        null,
        2,
      ),
    );
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
});
