import { fileURLToPath } from "node:url";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { initPresentationProject } from "@unframe-dev/workspace-node";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";

it("creates a project whose dependencies are installed by its package manager", async () => {
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-init-package-"));
  try {
    const project = join(parent, "project");
    expect(
      await initPresentationProject(
        project,
        fileURLToPath(new URL("../template/", import.meta.url)),
      ),
    ).toEqual({ ok: true });
    await expect(access(join(project, "unframe.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(project, "pnpm-lock.yaml"), "utf8")).toContain("lockfileVersion:");
    expect(await readFile(join(project, "assets/white.png"))).toEqual(
      await readFile(new URL("../template/assets/white.png", import.meta.url)),
    );
    expect(await readFile(join(project, "presentation.unframe.tsx"), "utf8")).toMatch(
      /id: "presentation-[a-f0-9-]+"/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
