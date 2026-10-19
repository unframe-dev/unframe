import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, expect, it } from "vitest";
import { acquireSourceLock } from "../src/filesystem/source-lock.js";
import { copyProjectFixture } from "./project-fixture.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("copies project inputs without inheriting another project's leases or output", async () => {
  const source = await mkdtemp(join(tmpdir(), "unframe-fixture-source-"));
  const target = await mkdtemp(join(tmpdir(), "unframe-fixture-target-"));
  directories.push(source, target);
  await writeFile(join(source, "unframe.lock"), "frozen source lock");
  await writeFile(join(source, ".unframe-build.lock"), "active build lease");
  await mkdir(join(source, ".unframe"));
  await mkdir(join(source, "dist"));
  await mkdir(join(source, "assets/dist"), { recursive: true });
  await writeFile(join(source, "assets/dist/model.glb"), "nested asset");
  const lease = await acquireSourceLock(source);
  assert(lease.ok);
  try {
    await copyProjectFixture(source, target);
    expect(await readdir(target)).toEqual(["assets", "unframe.lock"]);
    expect(await readFile(join(target, "unframe.lock"), "utf8")).toBe("frozen source lock");
    expect(await readFile(join(target, "assets/dist/model.glb"), "utf8")).toBe("nested asset");
    const ownLease = await acquireSourceLock(target);
    assert(ownLease.ok);
    await ownLease.value.release();
    expect(await acquireSourceLock(source)).toMatchObject({ ok: false });
  } finally {
    await lease.value.release();
  }
});
