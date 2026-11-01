import { rm } from "node:fs/promises";
import { createMediaProjectFixture } from "./media-project-fixture.js";
import { createWebglCaptureProject } from "./local-editor-webgl-fixture.js";
import { createAuthorService } from "../src/author/service.js";
import { startAuthorHost } from "../src/author/http.js";
import { createLocalPreviewService } from "../src/author/local-preview.js";
import { loadAuthorAssets, loadUnityPreviewAssets } from "../src/author/start.js";
import { editorAssetsDirectory, unityPreviewDirectory } from "@unframe/local-editor";
const directory =
  process.env["UNFRAME_WEBGL_FIXTURE"] === "media"
    ? await createMediaProjectFixture()
    : await createWebglCaptureProject(
        process.env["UNFRAME_WEBGL_FIXTURE"] === "structured" ? "structured" : "opaque",
      );
const service = await createAuthorService(directory);
const previews = createLocalPreviewService(directory);
const assets = await loadAuthorAssets(editorAssetsDirectory);
for (const [path, asset] of await loadUnityPreviewAssets(unityPreviewDirectory))
  assets.set(path, asset);
const host = await startAuthorHost({ service, previews, assets });
process.stdout.write(JSON.stringify({ origin: host.origin, token: host.token, directory }) + "\n");
await new Promise<void>((resolve) => {
  process.once("SIGTERM", resolve);
  process.once("SIGINT", resolve);
});
await host.close();
await rm(directory, { recursive: true, force: true });
