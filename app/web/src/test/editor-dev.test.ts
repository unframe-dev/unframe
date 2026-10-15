// @vitest-environment node
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import editorConfig from "../../vite.editor.config";

let vite: ViteDevServer | undefined;
let cacheDir: string | undefined;
const upstream = createHttpServer((request, response) => {
  if (request.url?.startsWith("/unity-preview/")) {
    response.setHeader("Content-Type", "application/wasm");
    response.end(Buffer.from([0, 97, 115, 109]));
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      path: request.url,
      host: request.headers.host,
      origin: request.headers.origin,
      authorization: request.headers.authorization,
      method: request.method,
    }),
  );
});

afterEach(async () => {
  await vite?.close();
  vite = undefined;
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  cacheDir = undefined;
});

it("serves the Editor before the CLI is available and proxies only its API and Unity player", async () => {
  expect(editorConfig.cacheDir).toBe("node_modules/.vite-editor");
  expect(editorConfig.server).toMatchObject({ host: "127.0.0.1", port: 5174, strictPort: true });
  expect(Object.keys(editorConfig.server?.proxy ?? {})).toEqual(["/api", "/unity-preview"]);
  expect(editorConfig.server?.proxy?.["/api"]).toMatchObject({
    target: "http://127.0.0.1:5175",
    changeOrigin: true,
  });
  expect(editorConfig.server?.proxy?.["/unity-preview"]).toMatchObject({
    target: "http://127.0.0.1:5175",
    changeOrigin: true,
  });
  // The allocated ports keep this check independent of running development servers.
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  assert(upstreamAddress && typeof upstreamAddress === "object");
  const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  cacheDir = await mkdtemp(join(tmpdir(), "unframe-editor-dev-test-"));
  vite = await createServer({
    ...editorConfig,
    configFile: false,
    cacheDir,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      ...editorConfig.server,
      port: 0,
      proxy: {
        "/api": { ...(editorConfig.server?.proxy?.["/api"] as object), target: upstreamOrigin },
        "/unity-preview": {
          ...(editorConfig.server?.proxy?.["/unity-preview"] as object),
          target: upstreamOrigin,
        },
      },
    },
  });
  await vite.listen();
  const webAddress = vite.httpServer?.address();
  assert(webAddress && typeof webAddress === "object");
  const webOrigin = `http://127.0.0.1:${webAddress.port}`;
  const editor = await fetch(`${webOrigin}/editor.html`);
  expect(editor.status).toBe(200);
  expect(await editor.text()).toContain("/src/features/editor/main.tsx");
  const hmr = await fetch(`${webOrigin}/@vite/client`);
  expect(hmr.status).toBe(200);
  await new Promise<void>((resolve) =>
    upstream.listen(Number(new URL(upstreamOrigin).port), "127.0.0.1", resolve),
  );
  const api = await fetch(`${webOrigin}/api/project`, {
    method: "PATCH",
    headers: { Origin: webOrigin, Authorization: "Bearer development-token" },
  });
  expect(await api.json()).toEqual({
    path: "/api/project",
    host: new URL(upstreamOrigin).host,
    origin: webOrigin,
    authorization: "Bearer development-token",
    method: "PATCH",
  });
  const wasm = await fetch(`${webOrigin}/unity-preview/Build/UnframePreview.wasm`);
  expect(wasm.headers.get("Content-Type")).toBe("application/wasm");
  expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
});
