import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { copyProjectFixture } from "./copy-project-fixture.js";

it("copies source inputs without copying publication state or active leases", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-fixture-copy-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  try {
    await mkdir(source);
    await mkdir(join(source, ".unframe"));
    await mkdir(join(source, "dist"));
    await writeFile(join(source, ".unframe-source.lock"), "active reader");
    await writeFile(join(source, ".unframe-build.lock"), "active build");
    await writeFile(join(source, "unframe.lock"), "frozen inputs");
    await copyProjectFixture(source, destination);
    expect(await readdir(destination)).toEqual(["unframe.lock"]);
    expect(await readFile(join(destination, "unframe.lock"), "utf8")).toBe("frozen inputs");
    expect(await readFile(join(source, ".unframe-source.lock"), "utf8")).toBe("active reader");
    expect(await readdir(source)).toHaveLength(5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
