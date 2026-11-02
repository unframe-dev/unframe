import { test } from "node:test";
import { strict as assert } from "node:assert";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { editorAssetsDirectory, unityPreviewDirectory } from "../package.mjs";

test("公開入口から UI と Unity Player の配布先を取得できる", async () => {
  await access(join(editorAssetsDirectory, "index.html"));
  for (const suffix of ["loader.js", "framework.js", "wasm", "data"])
    await access(join(unityPreviewDirectory, "Build", `UnframePreview.${suffix}`));
  assert.notEqual(editorAssetsDirectory, unityPreviewDirectory);
});
