import { cp } from "node:fs/promises";
import { relative } from "node:path";

const generatedEntries = new Set([
  ".unframe",
  "dist",
  ".unframe-source.lock",
  ".unframe-build.lock",
]);

export const copyProjectFixture = (source: string, destination: string) =>
  cp(source, destination, {
    recursive: true,
    filter: (path) => !generatedEntries.has(relative(source, path)),
  });
