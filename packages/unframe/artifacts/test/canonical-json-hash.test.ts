import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { hashCanonicalJson } from "../src/canonicalization/hash.js";

it.each([
  ["ASCII", "abc"],
  ["Japanese", "日本語"],
  ["supplementary code point", "😀"],
  ["lone high surrogate", "\ud800"],
  ["lone low surrogate", "\udc00"],
])("hashes %s using UTF-8 replacement semantics", (_name, value) => {
  const expected = `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
  expect(hashCanonicalJson(value)).toBe(expected);
});

it("hashes a large canonical string within a small JavaScript heap", () => {
  const source = new URL("../src/canonicalization/hash.ts", import.meta.url).href;
  const bytes = 8 * 1024 * 1024;
  const expected = `sha256:${createHash("sha256").update("a".repeat(bytes)).digest("hex")}`;
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=64",
      "--input-type=module",
      "-e",
      `import { hashCanonicalJson } from ${JSON.stringify(source)};
     console.log(hashCanonicalJson("a".repeat(${bytes})));`,
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 64 * 1024,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(expected);
});
