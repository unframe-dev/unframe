import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadUnityPreviewAssets } from "../src/author/start.js";

it("配布 Player の追加アセットも読み込む", async () => {
  const root = await mkdtemp(join(tmpdir(), "unframe-player-"));
  try {
    await mkdir(join(root, "Build"));
    await mkdir(join(root, "StreamingAssets"));
    for (const suffix of ["loader.js", "framework.js", "wasm", "data"])
      await writeFile(join(root, "Build", `UnframePreview.${suffix}`), suffix);
    await writeFile(join(root, "StreamingAssets", "extra.bin"), "extra");
    const assets = await loadUnityPreviewAssets(root);
    expect(
      new TextDecoder().decode(assets.get("/unity-preview/StreamingAssets/extra.bin")?.bytes),
    ).toBe("extra");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
