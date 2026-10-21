import { createHash } from "node:crypto";
import { mkdtemp, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompiledDeclarationProject } from "@unframe/unframe-compiler";
import { createFilesystemBuildCache as createCache } from "../src/filesystem/build-cache.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const temporary = async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-cache-test-"));
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

describe("native cache backend", () => {
  const createFilesystemBuildCache = (
    root: string,
    options: Parameters<typeof createCache>[1] = {},
  ) => createCache(root, options);
  it("新しいcache instanceからchecksum-addressed bytesを独立した所有権で再利用する", async () => {
    const root = await temporary();
    const value = fixture();
    await createFilesystemBuildCache(root).set(key, value);
    value.assets[Object.keys(value.assets)[0]!]![0] = 99;
    const restored = (await createFilesystemBuildCache(root).get(
      key,
    )) as CompiledDeclarationProject;
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

  it("POSIX dirfd backend publishes bytes and rejects a symlinked cache root", async () => {
    const root = await temporary();
    const errors: unknown[] = [];
    const cache = createFilesystemBuildCache(root, {
      onError: (error) => errors.push(error),
    });
    await cache.set(key, fixture());
    expect(await cache.get(key)).toMatchObject({ definitionHash: "fixture" });
    expect(errors).toEqual([]);
    const outside = await temporary();
    const linked = await temporary();
    await symlink(outside, join(linked, ".unframe"));
    await createFilesystemBuildCache(linked, {
      onError: (error) => errors.push(error),
    }).set(key, fixture());
    expect(await readdir(outside)).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("keeps directory ownership when the cache base is replaced by a symlink", async () => {
    const root = await temporary();
    const outside = await temporary();
    const base = join(root, ".unframe/cache/builds-v1");
    const cache = createFilesystemBuildCache(root, {
      onStaged: async () => {
        await rename(base, `${base}-moved`);
        await symlink(outside, base);
      },
    });
    await cache.set(key, fixture());
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(`${base}-moved`)).toEqual([key.slice(7)]);
  });
  it("rejects an invalid project root before opening cache storage", async () => {
    await expect(
      createFilesystemBuildCache("/does-not-exist/project").get(key),
    ).resolves.toBeUndefined();
  });
});
