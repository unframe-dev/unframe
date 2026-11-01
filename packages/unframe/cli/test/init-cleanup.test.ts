import { fileURLToPath } from "node:url";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";

const boundary = vi.hoisted(() => ({ target: "", enabled: false, failLock: false }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (boundary.failLock && String(args[0]).endsWith("/unframe.lock")) {
        await actual.writeFile(args[0], "partial", { flag: "wx" });
        throw new Error("disk full");
      }
      return actual.writeFile(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (boundary.failLock && String(args[0]).endsWith("/unframe.lock")) {
        handle.writeFile = async () => {
          await handle.write("partial");
          throw new Error("disk full");
        };
      }
      return handle;
    },
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
    const { initPresentationProject } = await import("@unframe/workspace-node");
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

it("removes its partial lock when writing fails", async () => {
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-init-partial-"));
  try {
    boundary.target = join(parent, "project");
    boundary.failLock = true;
    const { initPresentationProject } = await import("@unframe/workspace-node");
    expect(
      await initPresentationProject(
        boundary.target,
        fileURLToPath(new URL("../template/", import.meta.url)),
      ),
    ).toEqual({
      ok: false,
      code: "cli-init-copy-failed",
    });
    await expect(access(boundary.target)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    boundary.failLock = false;
    await rm(parent, { recursive: true, force: true });
  }
});
