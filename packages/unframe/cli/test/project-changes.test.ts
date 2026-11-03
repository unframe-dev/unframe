import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { createProjectChanges, watchProjectChanges } from "../src/author/project-changes.js";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it("retains changes across disconnect and detects a restarted Host cursor", async () => {
  const changes = createProjectChanges();
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  expect(initial.changed).toBe(true);
  changes.notify();
  const next = await changes.wait(initial.cursor);
  expect(next.changed).toBe(true);
  const restarted = createProjectChanges();
  cleanup.push(() => restarted.close());
  expect((await restarted.wait(next.cursor)).changed).toBe(true);
  const abort = new AbortController();
  const pending = changes.wait(next.cursor, abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: "cli-cancelled" });
  abort.abort();
  await rejected;
  changes.notify();
  expect((await changes.wait(next.cursor)).changed).toBe(true);
});
it("watches new nested Source, config, lock, style, assets and closure without watching generated output", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-notifications-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  let cursor = (await changes.wait()).cursor;
  for (const path of [
    "unframe.config.ts",
    "unframe.lock",
    "presentation.unframe.tsx",
    "style.css",
    "asset.png",
  ]) {
    await writeFile(join(root, path), "changed");
    const next = await changes.wait(cursor, AbortSignal.timeout(3000));
    expect(next.changed).toBe(true);
    cursor = next.cursor;
  }
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested/closure.ts"), "dependency");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(3000))).cursor;
  await writeFile(join(root, "nested/closure.ts"), "dependency changed");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(3000))).cursor;
  for (const path of [".unframe", "dist", "node_modules", ".git"]) {
    await mkdir(join(root, path));
    await writeFile(join(root, path, "generated.ts"), "output");
  }
  await writeFile(join(root, ".unframe-source.lock"), "lock");
  const stop = new AbortController();
  const waiting = changes.wait(cursor, stop.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ code: "cli-cancelled" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  stop.abort();
  await rejected;
});

it("coalesces a file event burst and closes pending observers", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-notification-burst-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      writeFile(join(root, `source-${index}.tsx`), "source"),
    ),
  );
  const next = await changes.wait(initial.cursor, AbortSignal.timeout(3000));
  const abort = new AbortController();
  const waiting = changes.wait(next.cursor, abort.signal);
  const cancelled = expect(waiting).rejects.toMatchObject({ code: "cli-cancelled" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  abort.abort();
  await cancelled;
  const closing = changes.wait(next.cursor);
  const unavailable = expect(closing).rejects.toMatchObject({ code: "author-watch-unavailable" });
  changes.close();
  await unavailable;
});

it("follows an atomically replaced Dist root and observes its assets", async () => {
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-dist-notification-"));
  cleanup.push(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "dist");
  await mkdir(root);
  const changes = await watchProjectChanges(root, "dist");
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  const { rename } = await import("node:fs/promises");
  await rename(root, join(parent, "previous"));
  await mkdir(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "build-manifest.json"), "manifest");
  const next = await changes.wait(initial.cursor, AbortSignal.timeout(3000));
  await writeFile(join(root, "assets/image.png"), "new image");
  expect((await changes.wait(next.cursor, AbortSignal.timeout(3000))).changed).toBe(true);
});

it("answers an idle heartbeat with the same cursor without inventing a project change", async () => {
  vi.useFakeTimers();
  const changes = createProjectChanges();
  try {
    const initial = await changes.wait();
    let completed = false;
    const pending = changes.wait(initial.cursor).then((result) => {
      completed = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ cursor: initial.cursor, changed: false });
  } finally {
    changes.close();
    vi.useRealTimers();
  }
});
