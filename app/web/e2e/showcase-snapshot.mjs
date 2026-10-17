import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAuthorService } from "../../../packages/unframe-cli/src/author/service";

const source = resolve(import.meta.dirname, "../../../examples/local-editor-showcase");
const directory = await mkdtemp(join(tmpdir(), "timeline-showcase-"));
try {
  await cp(source, directory, {
    recursive: true,
    filter: (path) => ![join(source, ".unframe"), join(source, "dist")].includes(path),
  });
  const service = await createAuthorService(directory);
  try {
    const snapshot = await service.project();
    if (!snapshot.definition) throw new Error(JSON.stringify(snapshot.diagnostics));
    process.stdout.write(JSON.stringify(snapshot));
  } finally {
    await service.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
