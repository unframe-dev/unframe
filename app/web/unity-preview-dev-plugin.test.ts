// @vitest-environment node

import { createServer, request, type Server } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUnityPreviewMiddleware } from "./unity-preview-dev-plugin";

let root: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "unframe-unity-preview-"));
  server = createServer((req, res) => {
    void createUnityPreviewMiddleware(root)(req, res, () => {
      res.statusCode = 200;
      res.end("SPA fallback");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(root, { recursive: true, force: true });
});

describe("Unity preview development middleware", () => {
  it("serves the Unity index and build assets with their content types", async () => {
    await writeFile(join(root, "index.html"), "<html>Unity</html>");
    await mkdir(join(root, "Build"));
    await writeFile(join(root, "Build", "preview.wasm"), "wasm bytes");
    await writeFile(join(root, "Build", "preview.loader.js"), "loader");
    await writeFile(join(root, "Build", "preview.data"), "data");
    await writeFile(join(root, "style.css"), "style");
    await writeFile(join(root, "icon.png"), "png");

    const index = await fetch(`${baseUrl}/unity-preview/`);
    const wasm = await fetch(`${baseUrl}/unity-preview/Build/preview.wasm`);

    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toBe("<html>Unity</html>");
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect(await wasm.text()).toBe("wasm bytes");
    for (const [path, contentType] of [
      ["Build/preview.loader.js", "text/javascript"],
      ["Build/preview.data", "application/octet-stream"],
      ["style.css", "text/css"],
      ["icon.png", "image/png"],
    ]) {
      const response = await fetch(`${baseUrl}/unity-preview/${path}`);
      expect(response.headers.get("content-type")).toContain(contentType);
    }
  });

  it("returns 404 for missing assets instead of the SPA fallback", async () => {
    const response = await fetch(`${baseUrl}/unity-preview/index.html`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("SPA fallback");
  });

  it("serves HEAD without a body and rejects other methods", async () => {
    await writeFile(join(root, "index.html"), "<html>Unity</html>");

    const head = await fetch(`${baseUrl}/unity-preview/index.html`, { method: "HEAD" });
    const post = await fetch(`${baseUrl}/unity-preview/index.html`, { method: "POST" });

    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toContain("text/html");
    expect(await head.text()).toBe("");
    expect(post.status).toBe(405);
  });

  it("rejects encoded path traversal", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const call = request(
        {
          hostname: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          path: "/unity-preview/%2e%2e/secret.txt",
          method: "GET",
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode ?? 0));
        },
      );
      call.on("error", reject);
      call.end();
    });

    expect(status).toBe(400);
  });

  it("does not follow a symlink outside the build directory", async () => {
    const outside = await mkdtemp(join(tmpdir(), "unframe-unity-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(join(outside, "secret.txt"), join(root, "escaped.txt"));

      const response = await fetch(`${baseUrl}/unity-preview/escaped.txt`);

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("secret");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
