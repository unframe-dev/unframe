import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { CompiledDeclarationProject } from "@unframe/unframe-compiler";
import { createFilesystemBuildCache } from "../src/filesystem/build-cache.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "unframe-cache-test-"));
  roots.push(root);
  return root;
};
const key = `sha256:${"a".repeat(64)}`;
const fixture = () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    assets: { [checksum]: bytes },
    assetSet: { assets: { [checksum]: { checksum, encodedSizeBytes: 4 } } },
    definitionHash: "fixture",
  } as unknown as CompiledDeclarationProject;
};

it("新しいcache instanceからchecksum-addressed bytesを独立した所有権で再利用する", async () => {
  const root = await temporary();
  const value = fixture();
  await createFilesystemBuildCache(root).set(key, value);
  value.assets[Object.keys(value.assets)[0]!]![0] = 99;
  const restored = (await createFilesystemBuildCache(root).get(key)) as CompiledDeclarationProject;
  expect(Object.values(restored.assets)[0]).toEqual(new Uint8Array([1, 2, 3, 4]));
  Object.values(restored.assets)[0]![0] = 88;
  expect(
    Object.values(
      ((await createFilesystemBuildCache(root).get(key)) as CompiledDeclarationProject).assets,
    )[0],
  ).toEqual(new Uint8Array([1, 2, 3, 4]));
});

it("破損したbinaryはcache missになりchecksum外の名前を読まない", async () => {
  const root = await temporary();
  const value = fixture();
  const cache = createFilesystemBuildCache(root);
  await cache.set(key, value);
  await writeFile(
    join(
      root,
      ".unframe/cache/builds-v1",
      key.slice(7),
      `${Object.keys(value.assets)[0]!.slice(7)}.bin`,
    ),
    new Uint8Array([9]),
  );
  expect(await cache.get(key)).toBeUndefined();
  expect(await cache.get("../../escape")).toBeUndefined();
});

it.each(["cancel", "failure"])("%s時にstagingを除去して未完成entryを公開しない", async (mode) => {
  const root = await temporary();
  const controller = new AbortController();
  const cache = createFilesystemBuildCache(root, {
    signal: controller.signal,
    onStaged: () => {
      if (mode === "cancel") controller.abort();
      else throw new Error("disk failure");
    },
  });
  await cache.set(key, fixture());
  expect(await createFilesystemBuildCache(root).get(key)).toBeUndefined();
  expect(await readdir(join(root, ".unframe/cache/builds-v1"))).toEqual([]);
});

it("cacheのsymlink先へwriteせず変更しない", async () => {
  const root = await temporary();
  const outside = await temporary();
  await symlink(outside, join(root, ".unframe"));
  await createFilesystemBuildCache(root).set(key, fixture());
  expect(await readdir(outside)).toEqual([]);
});

it("entry上限を超えると古い完成entryだけをcleanupする", async () => {
  const root = await temporary();
  const cache = createFilesystemBuildCache(root, { maxEntries: 1 });
  await cache.set(key, fixture());
  const second = `sha256:${"b".repeat(64)}`;
  await cache.set(second, fixture());
  expect(await cache.get(key)).toBeUndefined();
  expect(await cache.get(second)).toBeDefined();
  expect(await readdir(join(root, ".unframe/cache/builds-v1"))).toEqual([second.slice(7)]);
});

it("破損した完成entryを再build結果で置き換える", async () => {
  const root = await temporary();
  const value = fixture();
  const cache = createFilesystemBuildCache(root);
  await cache.set(key, value);
  await writeFile(join(root, ".unframe/cache/builds-v1", key.slice(7), "entry.json"), "broken");
  expect(await cache.get(key)).toBeUndefined();
  await cache.set(key, value);
  expect(await cache.get(key)).toBeDefined();
  expect(await readdir(join(root, ".unframe/cache/builds-v1"))).toEqual([key.slice(7)]);
});

it("checksum不一致の成果物を保存せずstagingを回収する", async () => {
  const root = await temporary();
  const value = fixture();
  Object.values(value.assets)[0]![0] = 99;
  await createFilesystemBuildCache(root).set(key, value);
  expect(await createFilesystemBuildCache(root).get(key)).toBeUndefined();
  expect(await readdir(join(root, ".unframe/cache/builds-v1"))).toEqual([]);
});
