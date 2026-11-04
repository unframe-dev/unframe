import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";

const boundary = vi.hoisted(() => ({ target: "", enabled: false }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => {
      if (boundary.enabled) {
        boundary.enabled = false;
        await actual.writeFile(join(boundary.target, "other.txt"), "other work");
        throw new Error("copy failed");
      }
      return actual.copyFile(...args);
    },
  };
});

it("preserves a concurrent file if template copying fails", async () => {
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-init-cleanup-"));
  try {
    boundary.target = join(parent, "project");
    boundary.enabled = true;
    const { initPresentationProject } = await import("@unframe-dev/workspace-node");
    expect(
      await initPresentationProject(
        boundary.target,
        fileURLToPath(new URL("../template/", import.meta.url)),
      ),
    ).toEqual({
      ok: false,
      code: "cli-init-copy-failed",
    });
    expect(await readFile(join(boundary.target, "other.txt"), "utf8")).toBe("other work");
  } finally {
    boundary.enabled = false;
    await rm(parent, { recursive: true, force: true });
  }
});
