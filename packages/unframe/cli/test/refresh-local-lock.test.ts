import { sourceAssetPorts } from "../src/application/media-ports.js";
import { writeStyleBoundaryProjectFixture } from "./style-boundary-project-fixture.js";
import filesystem, { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { dirname, join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import * as ts from "typescript";
import { prepareReactProjectFixture } from "./react-project-fixture.js";
import { afterEach, assert, expect, it, vi } from "vite-plus/test";
import { acquireSourceLock, refreshLocalProjectLock } from "@unframe-dev/workspace-node";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("preserves lock and Dist when a new PostCSS config needs a frozen Node dependency snapshot", async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-local-style-refresh-"));
  directories.push(directory);
  await writeStyleBoundaryProjectFixture(directory);
  await mkdir(join(directory, "dist"));
  await writeFile(join(directory, "dist/build-manifest.json"), "fixed Dist generation\n");
  await writeFile(join(directory, "postcss.config.mjs"), "export default { plugins: [] };\n");
  const lock = await readFile(join(directory, "unframe.lock"));

  expect(await refreshLocalProjectLock(sourceAssetPorts, directory)).toMatchObject({
    ok: false,
    code: "cli-style-lock-update-required",
  });
  expect(await readFile(join(directory, "unframe.lock"))).toEqual(lock);
  expect(await readFile(join(directory, "dist/build-manifest.json"), "utf8")).toBe(
    "fixed Dist generation\n",
  );
});

it("prepares lock refresh without a source lease and rejects a changed captured revision", async () => {
  const fixture = await prepareReactProjectFixture();
  const directory = fixture.directory;
  directories.push(directory);
  const source = join(directory, "surface.structure.tsx");
  await writeFile(source, (await readFile(source, "utf8")) + "\n// refresh input\n");
  const previous = await readFile(join(directory, "unframe.lock"));
  const blocked = blockLibraries();
  const refresh = refreshLocalProjectLock(sourceAssetPorts, directory);
  await blocked.started;
  try {
    const lease = await acquireSourceLock(directory);
    assert(lease.ok, "Lock refresh analysis must not hold the source lease");
    try {
      const config = join(directory, "unframe.config.ts");
      await writeFile(config, (await readFile(config, "utf8")) + "\n// externally saved config\n");
    } finally {
      await lease.value.release();
    }
  } finally {
    blocked.release();
  }
  expect(await refresh).toMatchObject({ ok: false, code: "cli-output-stale" });
  expect(await readFile(join(directory, "unframe.lock"))).toEqual(previous);
}, 30_000);

const blockLibraries = () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = filesystem.readdir;
  const libraryDirectory = dirname(ts.getDefaultLibFilePath({}));
  let blocked = false;
  vi.spyOn(filesystem, "readdir").mockImplementation(async (...args) => {
    if (!blocked && args[0] === libraryDirectory) {
      blocked = true;
      started.resolve();
      await release.promise;
    }
    return Reflect.apply(original, filesystem, args);
  });
  syncBuiltinESMExports();
  return { started: started.promise, release: () => release.resolve() };
};
