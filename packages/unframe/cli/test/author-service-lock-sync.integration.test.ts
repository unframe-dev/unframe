import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createAuthorService } from "../src/author/service.js";
import { prepareReactProjectFixture } from "./react-project-fixture.js";

it("uses installed dependencies without changing the package-manager lock or installing missing packages", async () => {
  const { directory } = await prepareReactProjectFixture();
  const lockBytes = "project-selected package manager lock\n";
  await writeFile(join(directory, "package-lock.json"), lockBytes);
  let service: Awaited<ReturnType<typeof createAuthorService>> | undefined;
  try {
    let builds = 0;
    service = await createAuthorService(directory, {
      run: async () => {
        builds++;
        return { exitCode: 0, stdout: "", stderr: "", generationId: "f".repeat(32) };
      },
      readPublishedArtifacts: async () => ({
        identity: "identity",
        catalog: [],
        assets: new Map(),
      }),
    });
    const initial = await service.project();
    expect(initial.irHash, JSON.stringify(initial.diagnostics)).not.toBeNull();
    const created = await service.build(initial.revision, "1".repeat(32));
    await expect.poll(async () => (await service!.job(created.buildId)).status).toBe("succeeded");
    expect(builds).toBe(1);
    expect(created.revision).toBe(initial.revision);
    expect(await readFile(join(directory, "package-lock.json"), "utf8")).toBe(lockBytes);
    await expect(stat(join(directory, "unframe.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    await rm(join(directory, "node_modules"), { recursive: true, force: true });
    await expect(service.project()).rejects.toBeDefined();
    await expect(stat(join(directory, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(builds).toBe(1);
    expect(await readFile(join(directory, "package-lock.json"), "utf8")).toBe(lockBytes);
  } finally {
    await service?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
