import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (!String(args[0]).endsWith("race.bin")) return handle;
      let firstRead = true;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "read")
            return async (...readArgs: Parameters<typeof handle.read>) => {
              if (firstRead) {
                firstRead = false;
                await original.appendFile(args[0], "grown");
              }
              return handle.read(...readArgs);
            };
          const value = Reflect.get(target, key, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import { readBoundedRegularFile } from "../src/filesystem/path-policy.js";

it("rejects an inode that grows after fstat but before the bounded read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-growth-"));
  try {
    const path = join(directory, "race.bin");
    await writeFile(path, "base");
    expect(await readBoundedRegularFile(path, 4, 4)).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
