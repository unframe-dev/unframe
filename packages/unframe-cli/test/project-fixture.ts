import { cp } from "node:fs/promises";
import { join } from "node:path";

export const copyProjectFixture = (source: string, target: string) =>
  cp(source, target, {
    recursive: true,
    filter: (path) =>
      ![".unframe", "dist", ".unframe-source.lock", ".unframe-build.lock"].some(
        (name) => path === join(source, name),
      ),
  });
