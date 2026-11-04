import { mkdtemp, rm, writeFile, symlink, mkdir, realpath, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createStaticAssetStore } from "../src/author/static-assets.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const setup = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "unframe-static-")));
  roots.push(root);
  await writeFile(join(root, "player.data"), "first");
  return { root, asset: { root, relative: "player.data", mediaType: "application/octet-stream" } };
};
it("loads only requested files and reuses a content-identified snapshot", async () => {
  const { root, asset } = await setup();
  await using store = createStaticAssetStore();
  const first = await store.get(asset);
  await using firstHandle = first.handle;
  expect(first.etag).toMatch(/^"[a-f0-9]{64}"$/);
  expect(await firstHandle.readFile()).toEqual(Buffer.from("first"));
  const reused = await store.get(asset);
  await using _reusedHandle = reused.handle;
  expect(reused.etag).toBe(first.etag);
  await writeFile(join(root, "player.data"), "other");
  const second = await store.get(asset);
  await using secondHandle = second.handle;
  expect(second.etag).not.toBe(first.etag);
  expect(await secondHandle.readFile()).toEqual(Buffer.from("other"));
});
it("keeps a requested snapshot stable when the original changes", async () => {
  const { root, asset } = await setup();
  await using store = createStaticAssetStore();
  const first = await store.get(asset);
  await using firstHandle = first.handle;
  await writeFile(join(root, "player.data"), "changed after hashing");
  expect(await firstHandle.readFile()).toEqual(Buffer.from("first"));
});
it("rejects files replaced with symbolic links", async () => {
  const { root, asset } = await setup();
  await using store = createStaticAssetStore();
  const initial = await store.get(asset);
  await initial.handle.close();
  await rm(join(root, "player.data"));
  await symlink("target.data", join(root, "player.data"));
  await writeFile(join(root, "target.data"), "secret");
  await expect(store.get(asset)).rejects.toThrow();
});
it("rejects a symbolic link in an asset subdirectory", async () => {
  const { root } = await setup();
  await mkdir(join(root, "inside"));
  await writeFile(join(root, "inside", "secret"), "secret");
  await symlink("inside", join(root, "link"));
  await using store = createStaticAssetStore();
  await expect(
    store.get({ root, relative: "link/secret", mediaType: "text/plain" }),
  ).rejects.toThrow();
});

it("rejects a replaced asset root instead of following its link", async () => {
  const { root, asset } = await setup();
  const replacement = await realpath(await mkdtemp(join(tmpdir(), "unframe-replacement-")));
  roots.push(replacement);
  await writeFile(join(replacement, "player.data"), "secret");
  await using store = createStaticAssetStore();
  await rm(root, { recursive: true });
  await symlink(replacement, root);
  await expect(store.get(asset)).rejects.toThrow();
});
it("allows retry after cancellation and closes pending requests", async () => {
  const { asset } = await setup();
  const store = createStaticAssetStore();
  await expect(store.get(asset, AbortSignal.abort())).rejects.toThrow();
  const retried = await store.get(asset);
  await retried.handle.close();
  const pending = store.get(asset);
  const rejection = expect(pending).rejects.toThrow();
  await store.close();
  await rejection;
  await expect(store.get(asset)).rejects.toThrow("closed");
});

it("rejects a file modified while copying and retries with its new content", async () => {
  const { root, asset } = await setup();
  const file = await open(join(root, "player.data"), "r");
  const prototype = Object.getPrototypeOf(file) as typeof file;
  await file.close();
  const read = prototype.read;
  vi.spyOn(prototype, "read").mockImplementationOnce(async function (
    this: typeof file,
    ...args: Parameters<typeof read>
  ) {
    const result = await Reflect.apply(read, this, args);
    await writeFile(join(root, "player.data"), "other");
    return result;
  });
  await using store = createStaticAssetStore();
  await expect(store.get(asset)).rejects.toThrow("changed during reading");
  const retried = await store.get(asset);
  await using handle = retried.handle;
  expect(await handle.readFile()).toEqual(Buffer.from("other"));
});
it("does not read the source again when its metadata remains unchanged", async () => {
  const { asset } = await setup();
  await using store = createStaticAssetStore();
  const first = await store.get(asset);
  const prototype = Object.getPrototypeOf(first.handle) as typeof first.handle;
  await first.handle.close();
  const read = vi.spyOn(prototype, "read");
  const second = await store.get(asset);
  await second.handle.close();
  expect(read).not.toHaveBeenCalled();
});

it("cancels an in-progress copy and can serve the same file afterwards", async () => {
  const { root, asset } = await setup();
  await writeFile(join(root, "player.data"), Buffer.alloc(128 * 1024, 7));
  const file = await open(join(root, "player.data"), "r");
  const prototype = Object.getPrototypeOf(file) as typeof file;
  await file.close();
  const read = prototype.read;
  const controller = new AbortController();
  vi.spyOn(prototype, "read").mockImplementationOnce(async function (
    this: typeof file,
    ...args: Parameters<typeof read>
  ) {
    const result = await Reflect.apply(read, this, args);
    controller.abort();
    return result;
  });
  await using store = createStaticAssetStore();
  await expect(store.get(asset, controller.signal)).rejects.toThrow();
  const retried = await store.get(asset);
  await using handle = retried.handle;
  expect(retried.size).toBe(131072n);
  expect(await handle.readFile()).toEqual(Buffer.alloc(128 * 1024, 7));
});
