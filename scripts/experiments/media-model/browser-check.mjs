import { chromium } from "../../../packages/unframe-renderer-web/node_modules/playwright-core/index.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, resolve, sep } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const output = new URL("../../../.unframe/media-model-spike/", import.meta.url);
const root = resolve(fileURLToPath(new URL("webgl/", output)));
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".css": "text/css",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const path = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!path.startsWith(root + sep) && path !== root) {
    response.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(path);
    response
      .writeHead(200, {
        "content-type": types[extname(path)] ?? "application/octet-stream",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      })
      .end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const diagnostics = [];
const result = {
  platform: process.platform,
  renderer: "SwiftShader WebGL",
  pipeline: process.env.MEDIA_MODEL_PIPELINE ?? "fixture",
  diagnostics,
};
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader-webgl",
      "--ozone-platform=headless",
    ],
  });
  assert.ok(["fixture", "compiled"].includes(result.pipeline), "unknown pipeline");
  result.expectedChecksum =
    result.pipeline === "compiled"
      ? JSON.parse(await readFile(new URL("compiled/metadata.json", output), "utf8")).descriptor
          .checksum
      : "sha256:" +
        createHash("sha256")
          .update(await readFile(new URL("fixtures/root-stripped.glb", output)))
          .digest("hex");
  result.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on("console", (message) => diagnostics.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => diagnostics.push({ type: "pageerror", text: error.message }));
  page.on("dialog", async (dialog) => {
    diagnostics.push({ type: "dialog", text: dialog.message() });
    await dialog.dismiss();
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      diagnostics.push({
        type: "http",
        text: response.status() + " " + new URL(response.url()).pathname,
      });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.screenshot({ path: fileURLToPath(new URL("browser-start.png", output)) });
  const start = Date.now();
  while (!diagnostics.some((e) => e.text.includes("MODEL_SPIKE_ALL_PASS"))) {
    assert.ok(
      !diagnostics.some(
        (e) => e.text.includes("Exception:") || e.type === "pageerror" || e.type === "dialog",
      ),
      "Unity or browser exception",
    );
    assert.ok(Date.now() - start < 180000, "Unity startup timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  result.observedChecksum = diagnostics
    .find((e) => e.text.startsWith("MODEL_SPIKE_ASSET "))
    ?.text.trim()
    .slice("MODEL_SPIKE_ASSET ".length);
  assert.equal(
    result.observedChecksum,
    result.expectedChecksum,
    "player imported expected pipeline GLB",
  );
  result.graphics = await page.evaluate(() => {
    const gl = document.querySelector("canvas").getContext("webgl2");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  result.assertions = diagnostics
    .filter((e) => e.text.startsWith("MODEL_SPIKE_PASS"))
    .map((e) => e.text.trim());
  assert.ok(result.assertions.some((e) => e.includes("runtime bytes import")));
  assert.ok(result.assertions.some((e) => e.includes("manual crossfade mixture")));
  assert.ok(result.assertions.some((e) => e.includes("manual sample and independent morph")));
  assert.ok(
    result.assertions.some((e) => e.includes("URP opaque and opacity pixel output")),
    "missing real pixel assertion",
  );
  result.pixels = diagnostics
    .filter((e) => e.text.startsWith("MODEL_SPIKE_PIXELS"))
    .map((e) => e.text.trim());
  await page.screenshot({ path: fileURLToPath(new URL("browser.png", output)) });
  result.passed = true;
} catch (error) {
  result.failure = error.stack;
  process.exitCode = 1;
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(
    new URL(
      result.pipeline === "compiled" ? "compiled-browser-result.json" : "browser-result.json",
      output,
    ),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        passed: result.passed ?? false,
        pipeline: result.pipeline,
        checksum: result.observedChecksum,
        failure: result.failure,
        browser: result.browser,
        graphics: result.graphics,
        assertions: result.assertions,
        pixels: result.pixels,
      },
      null,
      2,
    ),
  );
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
