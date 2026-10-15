import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

test.use({ trace: "off" });
const repository = resolve(import.meta.dirname, "../../..");
const { PNG } = createRequire(join(repository, "packages/unframe-renderer-web/package.json"))(
  "pngjs",
) as {
  PNG: { sync: { read(bytes: Buffer): { width: number; height: number; data: Buffer } } };
};
function pixels(bytes: Buffer) {
  const image = PNG.sync.read(bytes);
  const colors = new Map<string, number>();
  let minX = image.width,
    minY = image.height,
    maxX = -1,
    maxY = -1;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const color = [image.data[offset], image.data[offset + 1], image.data[offset + 2]].join(",");
    colors.set(color, (colors.get(color) ?? 0) + 1);
    if (
      image.data[offset + 1]! > image.data[offset]! + 20 &&
      image.data[offset + 1]! > image.data[offset + 2]! + 20
    ) {
      const x = (offset / 4) % image.width,
        y = Math.floor(offset / 4 / image.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    image,
    colors,
    varied: image.width * image.height - Math.max(...colors.values()),
    greenAspect: maxX >= minX ? (maxX - minX + 1) / (maxY - minY + 1) : 0,
  };
}

for (const kind of ["structured", "opaque"] as const)
  test(`actual Unity WebGL loads real ${kind} Compiler artifacts in Dev and Dist @actual-webgl`, async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env["UNFRAME_REAL_WEBGL"] !== "1",
      "Requires built Unity WebGL and the delegated opaque capture scope.",
    );
    test.setTimeout(300_000);
    const child = spawn(
      "bun",
      [join(repository, "packages/unframe-cli/test/local-editor-webgl-host.ts")],
      {
        cwd: repository,
        env: { ...process.env, UNFRAME_WEBGL_FIXTURE: kind },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const host = await new Promise<{ origin: string; token: string; directory: string }>(
      (resolve, reject) => {
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          for (const line of output.split("\n")) {
            try {
              const value = JSON.parse(line);
              if (value.origin && value.token) resolve(value);
            } catch {}
          }
        });
        child.once("exit", (code) => reject(new Error(`Host exited ${code}: ${stderr}`)));
      },
    );
    const directory = host.directory;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const assetMetrics: { partialAlpha: number; transparent: number }[] = [];
    const assetChecks: Promise<void>[] = [];
    const assetsFetched: { path: string; status: number; length: string | undefined }[] = [];
    page.on("response", (response) => {
      if (
        new URL(response.url()).pathname.startsWith("/api/previews/") &&
        response.url().includes("/assets/")
      ) {
        assetChecks.push(
          response.body().then((bytes) => {
            const data = PNG.sync.read(bytes).data;
            let partialAlpha = 0,
              transparent = 0;
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] === 0) transparent++;
              else if (data[i]! < 255) partialAlpha++;
            }
            assetMetrics.push({ partialAlpha, transparent });
          }),
        );
        assetsFetched.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
          length: response.headers()["content-length"],
        });
      }
    });
    try {
      await page.goto(`${host.origin}/#token=${host.token}`);
      await expect
        .poll(
          async () => {
            const text = await page.locator("body").innerText();
            if (text.includes("Preview 失敗:")) throw new Error(text);
            return /表示 build identity: build:/.test(text);
          },
          { timeout: 120_000 },
        )
        .toBe(true);
      await expect(page.getByText(/表示 mode: dev/)).toBeVisible();
      const canvas = page.locator('canvas[aria-label="Unity Preview"]');
      const dev = await canvas.screenshot({ path: testInfo.outputPath(`${kind}-dev.png`) });
      expect(pixels(dev).varied, JSON.stringify(errors)).toBeGreaterThan(500);
      expect(assetsFetched.length).toBeGreaterThan(0);
      await Promise.all(assetChecks);
      if (kind === "opaque") {
        expect(pixels(dev).greenAspect).toBeGreaterThan(2.3);
        expect(pixels(dev).greenAspect).toBeLessThan(2.7);
        expect(assetMetrics.some((item) => item.partialAlpha > 1000)).toBe(true);
        expect(assetMetrics.some((item) => item.transparent > 1000)).toBe(true);
        const before = await page.getByText(/表示 build identity: build:/).innerText();
        await page.getByRole("button", { name: "hero-one", exact: true }).click();
        await page
          .getByRole("group", { name: "position", exact: true })
          .getByRole("spinbutton")
          .first()
          .fill("-1.2");
        await page.getByRole("button", { name: "Transform を保存" }).click();
        await expect
          .poll(
            async () => {
              const text = await page.locator("body").innerText();
              if (/保存競合:|保存失敗:|Preview 失敗:/.test(text)) throw new Error(text);
              return page.getByText(/表示 build identity: build:/).innerText();
            },
            {
              timeout: 120_000,
            },
          )
          .not.toBe(before);
        const moved = await canvas.screenshot({ path: testInfo.outputPath("opaque-moved.png") });
        const first = pixels(dev).image,
          second = pixels(moved).image;
        let changed = 0;
        for (let i = 0; i < first.data.length; i += 4)
          if (
            first.data[i] !== second.data[i] ||
            first.data[i + 1] !== second.data[i + 1] ||
            first.data[i + 2] !== second.data[i + 2]
          )
            changed++;
        expect(changed).toBeGreaterThan(500);
        expect(pixels(moved).greenAspect).toBeGreaterThan(3.6);
        expect(pixels(moved).greenAspect).toBeLessThan(4.1);
        const evidence = join(repository, ".unframe/actual-webgl-evidence");
        await mkdir(evidence, { recursive: true });
        await writeFile(join(evidence, "opaque-moved.png"), moved);
      }
      await page.getByRole("button", { name: "本番 build" }).click();
      await expect(
        page.getByText("Dist build 完了。Dist Preview を読み込んで確認してください。"),
      ).toBeVisible({ timeout: 120_000 });
      const distManifest = JSON.parse(
        await readFile(join(directory, "dist/build-manifest.json"), "utf8"),
      );
      await page.getByRole("button", { name: "Dist Preview", exact: true }).click();
      await expect(page.getByText(/表示 mode: dist/)).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText(`表示 build identity: ${distManifest.buildId}`)).toBeVisible();
      const dist = await canvas.screenshot({ path: testInfo.outputPath(`${kind}-dist.png`) });
      expect(pixels(dist).varied, JSON.stringify(errors)).toBeGreaterThan(500);
      if (kind === "opaque") {
        expect(pixels(dist).greenAspect).toBeGreaterThan(3.6);
        expect(pixels(dist).greenAspect).toBeLessThan(4.1);
      }

      const evidence = join(repository, ".unframe/actual-webgl-evidence");
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, `${kind}-dev.png`), dev);
      await writeFile(join(evidence, `${kind}-dist.png`), dist);
      await testInfo.attach(`${kind}-dev`, { body: dev, contentType: "image/png" });
      await testInfo.attach(`${kind}-dist`, { body: dist, contentType: "image/png" });
    } finally {
      await testInfo.attach("browser-diagnostics", {
        body: JSON.stringify({ errors, assetsFetched, assetMetrics }),
        contentType: "application/json",
      });
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  });
