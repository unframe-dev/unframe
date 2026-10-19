import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPresentationCli } from "../src/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { copyProjectFixture } from "./project-fixture.js";
import { createWebglCaptureProject } from "./local-editor-webgl-fixture.js";
import { createAuthorService } from "../src/author/service.js";
import { startAuthorHost } from "../src/author/http.js";
import { createLocalPreviewService } from "../src/author/local-preview.js";
import { loadAuthorAssets, loadUnityPreviewAssets } from "../src/author/start.js";
const repository = process.cwd();
const directory =
  process.env["UNFRAME_WEBGL_FIXTURE"] === "media"
    ? await mkdtemp(join(tmpdir(), "unframe-media-webgl-"))
    : await createWebglCaptureProject(
        process.env["UNFRAME_WEBGL_FIXTURE"] === "structured" ? "structured" : "opaque",
      );
if (process.env["UNFRAME_WEBGL_FIXTURE"] === "media") {
  await copyProjectFixture(join(repository, "examples/media-presentation"), directory);
  const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
  if (refreshed.exitCode) throw new Error(refreshed.stderr);
}
const service = await createAuthorService(directory);
const previews = createLocalPreviewService(directory);
const assets = await loadAuthorAssets(join(repository, "app/web/dist-editor"));
for (const [path, asset] of await loadUnityPreviewAssets(
  join(repository, ".unframe/unity-preview/UnframePreview"),
))
  assets.set(path, asset);
const host = await startAuthorHost({ service, previews, assets });
process.stdout.write(JSON.stringify({ origin: host.origin, token: host.token, directory }) + "\n");
await new Promise<void>((resolve) => {
  process.once("SIGTERM", resolve);
  process.once("SIGINT", resolve);
});
await host.close();
await rm(directory, { recursive: true, force: true });
