import { chromium } from "../../../packages/unframe-renderer-web/node_modules/playwright-core/index.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const output = new URL("../../../.unframe/media-video-spike/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? chromium.executablePath(),
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader-webgl",
    "--autoplay-policy=document-user-activation-required",
  ],
});
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
const read = async (fn, arg) => {
  const r = await cdp.send("Runtime.evaluate", {
    expression: `(${fn.toString()})(${JSON.stringify(arg) ?? ""})`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  if (r.exceptionDetails)
    throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const wait = async (fn, arg, timeout = 30000) => {
  const start = Date.now();
  while (!(await read(fn, arg))) {
    if (Date.now() - start > timeout) throw Error("observation timeout: " + fn.toString());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
const diagnostics = [];
page.on("console", (m) => diagnostics.push({ type: m.type(), text: m.text() }));
page.on("pageerror", (e) => diagnostics.push({ type: "pageerror", text: e.message }));
const result = { browser: browser.version(), platform: process.platform, diagnostics };
try {
  await page.goto("http://127.0.0.1:5188");
  await wait(() => spikeEvents.some((e) => e.kind === "ready"), null, 180000);
  result.unauthorizedStatus = await read(async () => (await fetch("/asset.mp4")).status);
  assert.equal(result.unauthorizedStatus, 401);
  for (const override of [{ size: 1 }, { sha256: "bad" }]) {
    const error = await read(async (override) => {
      try {
        await loadVerified(override);
        return "unexpected success";
      } catch (e) {
        return e.message;
      }
    }, override);
    (result.integrityRejections ??= []).push(error);
  }
  assert.deepEqual(result.integrityRejections, ["size mismatch", "checksum mismatch"]);
  await read(() => loadVerified());
  await wait(() => spikeEvents.some((e) => e.kind === "prepared"));
  await read(() => command("Play"));
  await page.waitForTimeout(1500);
  result.beforeActivation = await read(() => ({
    activation: navigator.userActivation.hasBeenActive,
    plays: [...playResults],
    media: mediaElements.map((v) => ({ paused: v.paused, time: v.currentTime, muted: v.muted })),
  }));
  assert.equal(result.beforeActivation.activation, false);
  assert.ok(result.beforeActivation.plays.includes("NotAllowedError"));
  assert.ok(result.beforeActivation.media.every((v) => v.paused && v.time === 0));
  await page.click("#play");
  await page.waitForTimeout(1600);
  result.afterActivation = await read(() => ({
    plays: [...playResults],
    audioContextState: audioContext.state,
    audioRmsMax: Math.max(...audioEvidence),
    media: mediaElements.map((v) => ({
      paused: v.paused,
      time: v.currentTime,
      muted: v.muted,
      volume: v.volume,
      decodedAudioBytes: v.webkitAudioDecodedByteCount,
      decodedVideoBytes: v.webkitVideoDecodedByteCount,
    })),
  }));
  assert.ok(result.afterActivation.audioRmsMax > 0.01, "no decoded audio signal");
  assert.ok(
    result.afterActivation.media.some((v) => !v.paused && v.decodedAudioBytes > 0),
    "video audio did not advance",
  );
  await read(() => command("Pause"));
  await page.waitForTimeout(350);
  result.pause = await read(() => spikeEvents.filter((e) => e.kind === "sample").at(-1));
  const seeks = [];
  for (const target of [1.25, 4.1, 2.05]) {
    const start = Date.now();
    const offset = await read(() => spikeEvents.length);
    await read((target) => command("Seek", String(target)), target);
    await wait(
      (offset) => spikeEvents.slice(offset).some((e) => e.kind === "seekCompleted"),
      offset,
      15000,
    );
    const completionMs = Date.now() - start;
    await page.waitForTimeout(300);
    const observation = await read(() => spikeEvents.filter((e) => e.kind === "sample").at(-1));
    const mediaTime = await read(
      () => mediaElements.filter((v) => v.src.startsWith("blob:")).at(-1).currentTime,
    );
    seeks.push({
      target,
      mediaTime,
      completionMs,
      observed: observation.time,
      error: Math.abs(target - observation.time),
      elapsedMs: Date.now() - start,
      pixelHash: observation.pixelHash,
    });
  }
  result.seeks = seeks;
  assert.equal(
    new Set(seeks.map((s) => s.pixelHash)).size,
    3,
    "paused seeks did not produce distinct Unity textures",
  );
  assert.ok(
    seeks.every((s) => s.error <= 0.15),
    "seek error exceeds provisional 150ms spike threshold",
  );
  const samples = await read(() => spikeEvents.filter((e) => e.kind === "sample" && e.playing));
  result.distinctPlayingPixelHashes = [...new Set(samples.map((s) => s.pixelHash))];
  assert.ok(result.distinctPlayingPixelHashes.length > 1, "Unity texture did not change");
  await page.screenshot({ path: new URL("unity-video.png", output).pathname });
  await page.click("#dispose");
  await wait(() => spikeEvents.some((e) => e.kind === "revoked"));
  result.afterDispose = await read(() => ({
    media: mediaElements.map((v) => ({ paused: v.paused, src: v.src })),
    events: spikeEvents,
  }));
  assert.ok(result.afterDispose.media.every((v) => v.paused && !v.src.startsWith("blob:")));
  await page.reload();
  await wait(() => spikeEvents.some((e) => e.kind === "ready"), null, 180000);
  await read(() => loadVerified({}, "?invalid=1"));
  await wait(() => spikeEvents.some((e) => e.kind === "error"), null, 30000);
  result.invalidDecode = await read(() =>
    spikeEvents.filter((e) => e.kind === "verified" || e.kind === "error"),
  );
  assert.ok(!(await read(() => spikeEvents.some((e) => e.kind === "prepared"))));
  await page.click("#dispose");
  await wait(() => spikeEvents.some((e) => e.kind === "revoked"));
  result.invalidDispose = await read(() =>
    spikeEvents.filter((e) => e.kind === "disposed" || e.kind === "revoked"),
  );
  result.passed = true;
} catch (e) {
  result.failure = e.stack;
  result.events = await read(() => window.spikeEvents ?? []);
  result.media = await read(() =>
    (window.mediaElements ?? []).map((v) => ({
      time: v.currentTime,
      paused: v.paused,
      src: v.src,
      ready: v.readyState,
      error: v.error?.message,
    })),
  );
  process.exitCode = 1;
} finally {
  await writeFile(new URL("browser-result.json", output), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: result.passed,
        failure: result.failure,
        browser: result.browser,
        seeks: result.seeks,
        afterActivation: result.afterActivation,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
