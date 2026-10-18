import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { refreshLocalProjectLock } from "../src/filesystem/refresh-local-lock.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("preserves lock and Dist when a new PostCSS config needs a frozen Node dependency snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-local-style-refresh-"));
  directories.push(directory);
  await cp(fileURLToPath(new URL("../../../examples/presentation/", import.meta.url)), directory, {
    recursive: true,
    filter: (path) =>
      !path.endsWith("/.unframe") &&
      !path.endsWith("/dist") &&
      !path.endsWith("/.unframe-source.lock"),
  });
  await mkdir(join(directory, "dist"));
  await writeFile(join(directory, "dist/build-manifest.json"), "fixed Dist generation\n");
  await writeFile(join(directory, "postcss.config.mjs"), "export default { plugins: [] };\n");
  const lock = await readFile(join(directory, "unframe.lock"));

  expect(await refreshLocalProjectLock(directory)).toMatchObject({
    ok: false,
    code: "cli-style-lock-update-required",
  });
  expect(await readFile(join(directory, "unframe.lock"))).toEqual(lock);
  expect(await readFile(join(directory, "dist/build-manifest.json"), "utf8")).toBe(
    "fixed Dist generation\n",
  );
});
