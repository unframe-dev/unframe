import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAuthoringBoundaryProjectFixture } from "./authoring-boundary-project-fixture.js";

const directory = await mkdtemp(join(tmpdir(), "unframe-reference-lock-"));
try {
  await writeAuthoringBoundaryProjectFixture(directory);
  const lock = await readFile(join(directory, "unframe.lock"));
  await writeFile(
    fileURLToPath(new URL("./fixtures/reference-project/unframe.lock", import.meta.url)),
    lock,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
