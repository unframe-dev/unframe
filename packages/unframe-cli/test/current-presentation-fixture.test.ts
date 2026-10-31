import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, expect, it } from "vitest";
import { runPresentationCli } from "../src/index.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";

const fixture = fileURLToPath(new URL("../fixtures/presentation/", import.meta.url));

it("validates the bundled reference project with the current frozen authoring contracts", async () => {
  const checked = await runPresentationCli({ args: ["check", fixture, "--format", "json"] });
  expect(checked.exitCode, checked.stderr).toBe(0);
  const locked = loadUnframeLock(await readFile(join(fixture, "unframe.lock")));
  assert(locked.ok);
  expect(locked.value.lock.schemaVersion).toBe(3);
  expect(locked.value.lock.componentLocks.map(({ componentId }) => componentId)).toEqual([
    "reference-badge",
    "reference-surface",
  ]);
});
