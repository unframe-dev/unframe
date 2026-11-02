import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  acquireBuildLock,
  buildLockFileName,
  refreshLocalProjectLock,
  updateProjectLock,
} from "../src/index.js";

vi.mock("../src/source-lock.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/source-lock.js")>();
  return {
    ...original,
    acquireSourceLock: async (...args: Parameters<typeof original.acquireSourceLock>) => {
      const buildLockExists = await lstat(join(args[0], ".unframe-build.lock")).then(
        () => true,
        () => false,
      );
      if (buildLockExists) throw new Error("Source lease IO failed");
      return original.acquireSourceLock(...args);
    },
  };
});

const ports = {
  modelTransformIdentity: `sha256:${"a".repeat(64)}` as const,
  videoTransformIdentity: vi.fn(),
  styles: { snapshot: vi.fn(), withSources: vi.fn(), compile: vi.fn() },
};

it.each(["update", "refresh"] as const)(
  "releases the Build lease when %s Source acquisition rejects",
  async (operation) => {
    const directory = await mkdtemp(join(tmpdir(), "unframe-lease-acquisition-"));
    try {
      await Promise.all([
        writeFile(
          join(directory, "unframe.config.ts"),
          'export default { entryFile: "presentation.unframe.tsx", assets: {} };\n',
        ),
        writeFile(join(directory, "unframe.lock"), "{}\n"),
        writeFile(join(directory, "presentation.unframe.tsx"), "export default {};\n"),
      ]);
      const result =
        operation === "update"
          ? updateProjectLock(ports, directory, "refresh", false)
          : refreshLocalProjectLock(ports, directory);
      await expect(result).rejects.toThrow("Source lease IO failed");
      await expect(lstat(join(directory, buildLockFileName))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const next = await acquireBuildLock(directory);
      expect(next.ok).toBe(true);
      if (next.ok) await next.value.release();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
