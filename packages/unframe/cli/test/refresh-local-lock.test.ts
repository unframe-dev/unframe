import { sourceAssetPorts } from "../src/application/media-ports.js";
import { writeStyleBoundaryProjectFixture } from "./style-boundary-project-fixture.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { refreshLocalProjectLock } from "@unframe/workspace-node";

const directories: string[] = [];
afterEach(async () => {
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
