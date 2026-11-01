import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { initPresentationProject } from "../src/index.js";

it("excludes another project's runtime leases from initialized inputs", async () => {
  const parent = await mkdtemp(join(tmpdir(), "unframe-template-leases-"));
  const template = await mkdtemp(join(tmpdir(), "unframe-template-input-"));
  try {
    await writeFile(
      join(template, "presentation.unframe.tsx"),
      'export default {id: "packed-project"};',
    );
    await writeFile(join(template, "unframe.lock.gz"), gzipSync("{}"));
    await writeFile(join(template, ".unframe-source.lock"), "active source lease");
    await writeFile(join(template, ".unframe-build.lock"), "active build lease");
    const project = join(parent, "project");
    expect(await initPresentationProject(project, template)).toEqual({ ok: true });
    expect((await readdir(project)).sort()).toEqual(["presentation.unframe.tsx", "unframe.lock"]);
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(template, { recursive: true, force: true });
  }
});
