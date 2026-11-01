#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

// runtime must contain installed distribution packages and their declared external dependencies.
const [runtimeArg, projectArg, browserExecutable] = process.argv.slice(2);
if (!runtimeArg || !projectArg || !browserExecutable)
  throw new Error("Usage: node pack-acceptance.mjs <runtime> <project> <chromium>");
const runtime = resolve(runtimeArg);
const project = resolve(projectArg);
const executable = join(runtime, "node_modules/@unframe/cli/dist/cli.mjs");
const require = createRequire(join(runtime, "package.json"));
const { chromium } = require("playwright-core");
const { PNG } = require("pngjs");
const { default: canonicalize } = await import(
  pathToFileURL(join(runtime, "node_modules/canonicalize/lib/canonicalize.js")).href
);
const temp = await mkdtemp(join(tmpdir(), "unframe-pack-acceptance-"));
let preview;
let browser;
let server;
const run = (args, extraEnv = {}) =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: runtime,
      env: { ...process.env, ...extraEnv },
    });
    let output = "";
    child.stdout.on("data", (bytes) => {
      output += bytes;
    });
    child.stderr.on("data", (bytes) => {
      output += bytes;
    });
    child.on("error", fail);
    child.on("exit", (code) => done({ code, output }));
  });
try {
  const build = await run(["build", project]);
  assert.equal(build.code, 0, build.output);
  const dist = join(temp, "dist");
  await cp(join(project, "dist"), dist, { recursive: true });
  const manifest = JSON.parse(await readFile(join(dist, "build-manifest.json"), "utf8"));
  const assetSet = JSON.parse(await readFile(join(dist, "asset-set.json"), "utf8"));
  const requests = [];
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const path = request.url;
    requests.push({
      method: request.method,
      path,
      token: request.headers.authorization,
      size: body.length,
    });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && path.endsWith("/publication")) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "POST" && path === "/presentations") {
      response.writeHead(201).end(JSON.stringify({ id: manifest.presentationId }));
      return;
    }
    if (request.method === "POST" && path.endsWith("/builds")) {
      response
        .writeHead(201)
        .end(JSON.stringify({ buildId: manifest.buildId, assetIds: Object.keys(assetSet.assets) }));
      return;
    }
    if (request.method === "PUT") {
      response.writeHead(204).end();
      return;
    }
    if (request.method === "POST" && path.endsWith("/publications")) {
      const payload = { ...manifest, publicationEpoch: 1 };
      const publicationManifestHash = `sha256:${createHash("sha256").update(canonicalize(payload)).digest("hex")}`;
      response.writeHead(201).end(JSON.stringify({ ...payload, publicationManifestHash }));
      return;
    }
    response.writeHead(500).end();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const published = await run(
    ["publish", dist, manifest.presentationId, `http://127.0.0.1:${server.address().port}`],
    { UNFRAME_ACCESS_TOKEN: "acceptance-token" },
  );
  assert.equal(published.code, 0, published.output);
  assert(requests.every((request) => request.token === "Bearer acceptance-token"));
  assert.equal(
    requests.filter((request) => request.method === "PUT").length,
    Object.keys(assetSet.assets).length,
  );
  assert(
    requests.some((request) => request.method === "POST" && request.path.endsWith("/publications")),
  );
  const opener = join(temp, process.platform === "darwin" ? "open" : "xdg-open");
  const urlFile = join(temp, "url");
  await writeFile(opener, '#!/bin/sh\nprintf "%s" "$1" > "$UNFRAME_ACCEPTANCE_URL_FILE"\n', {
    mode: 0o700,
  });
  preview = spawn(process.execPath, [executable, "preview", dist], {
    cwd: runtime,
    env: {
      ...process.env,
      PATH: `${temp}:${process.env.PATH}`,
      UNFRAME_ACCEPTANCE_URL_FILE: urlFile,
    },
    stdio: "pipe",
  });
  let url;
  for (let attempt = 0; attempt < 200 && !url; attempt++) {
    url = await readFile(urlFile, "utf8").catch(() => "");
    if (!url) await delay(100);
  }
  assert(url, "CLI did not open the authenticated Preview URL");
  const args = process.env.UNFRAME_ACCEPTANCE_BROWSER_ARGS
    ? JSON.parse(process.env.UNFRAME_ACCEPTANCE_BROWSER_ARGS)
    : [];
  browser = await chromium.launch({ headless: true, executablePath: browserExecutable, args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    window.__unframeEvents = [];
    window.addEventListener("unframe-preview", (event) =>
      window.__unframeEvents.push(event.detail),
    );
  });
  const playerFiles = new Set();
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.ok() && path.startsWith("/unity-preview/Build/"))
      playerFiles.add(path.split("/").pop());
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(
      () => window.__unframeEvents.some((event) => event.kind === "committed"),
      null,
      { timeout: 180_000 },
    );
  } catch (error) {
    console.error("Unity notifications:", await page.evaluate(() => window.__unframeEvents));
    console.error("Preview status:", await page.locator("body").innerText());
    throw error;
  }
  for (const extension of ["loader.js", "framework.js", "data", "wasm"])
    assert(playerFiles.has(`UnframePreview.${extension}`));
  const canvas = page.locator("canvas#unity-preview-canvas");
  assert.equal(await canvas.count(), 1);
  let redPixels = 0;
  for (let attempt = 0; attempt < 60 && redPixels < 100; attempt++) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const image = PNG.sync.read(await canvas.screenshot());
    redPixels = 0;
    for (let y = Math.floor(image.height * 0.2); y < image.height * 0.65; y++) {
      for (let x = Math.floor(image.width * 0.25); x < image.width * 0.75; x++) {
        const offset = (y * image.width + x) * 4;
        if (image.data[offset] > 100 && image.data[offset + 1] < 35 && image.data[offset + 2] < 35)
          redPixels++;
      }
    }
    if (redPixels < 100) await delay(500);
  }
  assert(
    redPixels >= 100,
    `Unity did not render the fixture's red Surface panel (${redPixels} pixels)`,
  );
  const previousPlaybackEvents = await page.evaluate(
    () => window.__unframeEvents.filter((event) => event.kind === "playback").length,
  );
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(
    (previous) =>
      window.__unframeEvents.filter((event) => event.kind === "playback").length > previous,
    previousPlaybackEvents,
    { timeout: 30_000 },
  );
  console.log(
    `packed CLI build, publication, Unity display (${redPixels} red pixels) and playback: ok`,
  );
} finally {
  await browser?.close();
  preview?.kill("SIGTERM");
  if (server) await new Promise((done) => server.close(done));
  await rm(temp, { recursive: true, force: true });
}
