import { cp, mkdtemp, rm } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { runPresentationCli } from "../src/index.js";
import { startDistPreviewHost } from "../src/author/start.js";
import { copyProjectFixture } from "./copy-project-fixture.js";

const source = await mkdtemp(join(temporaryDirectory(), "unframe-dist-source-"));
const destination = await mkdtemp(join(temporaryDirectory(), "unframe-dist-copy-"));
let host: Awaited<ReturnType<typeof startDistPreviewHost>> | undefined;
try {
  await copyProjectFixture(join(process.cwd(), "examples/media-presentation"), source);
  for (const args of [
    ["lock", "refresh", source],
    ["build", source],
  ]) {
    const result = await runPresentationCli({ args });
    if (result.exitCode) throw new Error(result.stderr);
  }
  const directory = join(destination, "dist");
  await cp(join(source, "dist"), directory, { recursive: true });
  await rm(source, { recursive: true, force: true });
  host = await startDistPreviewHost(directory);
  process.stdout.write(JSON.stringify({ origin: host.origin, token: host.token }) + "\n");
  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
} finally {
  await host?.close();
  await rm(source, { recursive: true, force: true });
  await rm(destination, { recursive: true, force: true });
}
