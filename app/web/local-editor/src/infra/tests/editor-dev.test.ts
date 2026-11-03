// @vitest-environment node
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { afterEach, assert, expect, it, vi } from "vite-plus/test";
import { createServer, type ViteDevServer } from "vite";
import editorConfig from "../../../vite.config";
import { authorHostStartup } from "../../../dev/author-host-startup";

let vite: ViteDevServer | undefined;
let cacheDir: string | undefined;
const received: string[] = [];
const upstream = createHttpServer(async (request, response) => {
  received.push(request.url ?? "");
  if (request.url?.startsWith("/unity-preview/")) {
    response.setHeader("Content-Type", "application/wasm");
    response.end(Buffer.from([0, 97, 115, 109]));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      path: request.url,
      host: request.headers.host,
      origin: request.headers.origin,
      authorization: request.headers.authorization,
      method: request.method,
      body: Buffer.concat(chunks).toString("utf8"),
    }),
  );
});

afterEach(async () => {
  await vite?.close();
  vite = undefined;
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  received.length = 0;
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  cacheDir = undefined;
  vi.restoreAllMocks();
});

async function editor(timeoutMilliseconds?: number) {
  // Allocated ports keep these checks independent of running development servers.
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  assert(upstreamAddress && typeof upstreamAddress === "object");
  const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  cacheDir = await mkdtemp(join(tmpdir(), "unframe-editor-dev-test-"));
  vite = await createServer({
    ...editorConfig,
    ...(timeoutMilliseconds === undefined
      ? {}
      : { plugins: [authorHostStartup(timeoutMilliseconds)] }),
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
  const errors = vi.spyOn(vite.config.logger, "error");
  await vite.listen();
  const address = vite.httpServer?.address();
  assert(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    upstreamOrigin,
    errors,
    startHost: () =>
      new Promise<void>((resolve) => upstream.listen(upstreamAddress.port, "127.0.0.1", resolve)),
  };
}

it("serves UI and HMR while holding API writes and Player reads until the CLI is ready", async () => {
  expect(editorConfig.cacheDir).toBe("node_modules/.vite-editor");
  expect(editorConfig.server).toMatchObject({ host: "127.0.0.1", port: 5174, strictPort: true });
  expect(Object.keys(editorConfig.server?.proxy ?? {})).toEqual(["/api", "/unity-preview"]);
  const { origin, upstreamOrigin, startHost, errors } = await editor();
  const body = JSON.stringify({ title: "起動待ち", content: "x".repeat(65536) });
  const pendingApi = fetch(`${origin}/api/project`, {
    method: "PATCH",
    headers: {
      Origin: origin,
      Authorization: "Bearer development-token",
      "Content-Type": "application/json",
    },
    body,
  });
  const pendingWasm = fetch(`${origin}/unity-preview/Build/UnframePreview.wasm`);
  expect(await Promise.race([pendingApi.then(() => "returned"), delay(100, "waiting")])).toBe(
    "waiting",
  );
  expect(await Promise.race([pendingWasm.then(() => "returned"), delay(100, "waiting")])).toBe(
    "waiting",
  );
  const page = await fetch(`${origin}/`);
  expect(await page.text()).toContain("/src/app/main.tsx");
  expect((await fetch(`${origin}/@vite/client`)).status).toBe(200);
  await startHost();
  const api = await pendingApi;
  expect(await api.json()).toEqual({
    path: "/api/project",
    host: new URL(upstreamOrigin).host,
    origin,
    authorization: "Bearer development-token",
    method: "PATCH",
    body,
  });
  const wasm = await pendingWasm;
  expect(wasm.headers.get("Content-Type")).toBe("application/wasm");
  expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
  expect(received.sort()).toEqual(["/api/project", "/unity-preview/Build/UnframePreview.wasm"]);
  expect(errors).not.toHaveBeenCalled();
});

it("returns a no-store 503 if the CLI does not become ready within the startup limit", async () => {
  const { origin, errors } = await editor(100);
  const response = await fetch(`${origin}/api/editor-session`, {
    method: "POST",
    headers: { "x-unframe-editor": "1" },
  });
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Retry-After")).toBe("1");
  expect(await response.json()).toMatchObject({ code: "author-host-unavailable" });
  expect(received).toEqual([]);
  expect(errors).not.toHaveBeenCalled();
});

it("does not forward a request cancelled while waiting for the CLI", async () => {
  const { origin, startHost, errors } = await editor();
  const abort = new AbortController();
  const pending = fetch(`${origin}/api/project`, {
    method: "PATCH",
    body: "cancelled",
    signal: abort.signal,
  }).then(
    () => "returned",
    (error: Error) => error.name,
  );
  expect(await Promise.race([pending, delay(100, "waiting")])).toBe("waiting");
  abort.abort();
  expect(await pending).toBe("AbortError");
  await startHost();
  expect((await fetch(`${origin}/api/publication-auth`)).status).toBe(200);
  expect(received).toEqual(["/api/publication-auth"]);
  expect(errors).not.toHaveBeenCalled();
});

it("closes the development server without waiting for the CLI startup deadline", async () => {
  const { origin } = await editor();
  const abort = new AbortController();
  const pending = fetch(`${origin}/api/project`, { signal: abort.signal }).catch(() => null);
  expect(await Promise.race([pending.then(() => "returned"), delay(100, "waiting")])).toBe(
    "waiting",
  );
  assert(vite);
  const closing = vite.close();
  try {
    expect(await Promise.race([closing.then(() => "closed"), delay(1000, "waiting")])).toBe(
      "closed",
    );
  } finally {
    abort.abort();
    await closing;
    vite = undefined;
    await pending;
  }
});
