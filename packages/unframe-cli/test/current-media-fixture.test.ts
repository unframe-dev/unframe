import { fileURLToPath } from "node:url";
import { assert, expect, it } from "vitest";
import { presentationDefinitionSchema } from "@unframe/contracts/presentation";
import { checkAuthoringProjectAssembly } from "@unframe/unframe-compiler";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import { resolveProjectSourceAssets } from "../src/filesystem/source-assets.js";

it("assembles the frozen Model and Video fixture against the current Definition schema", async () => {
  const discovered = await discoverPresentationProjectFiles(
    fileURLToPath(new URL("../fixtures/media-presentation/", import.meta.url)),
  );
  assert(discovered.ok);
  const loaded = loadUnframeLock(discovered.lockBytes);
  assert(loaded.ok);
  expect(loaded.value.lock.schemaVersion).toBe(3);
  const sourceAssets = await resolveProjectSourceAssets(
    loaded.value.lock.assets,
    discovered.assetSources,
    discovered.localFiles,
  );
  assert(sourceAssets.ok);
  const checked = checkAuthoringProjectAssembly(
    {
      projectRoot: discovered.projectDirectory,
      entryFile: discovered.entryFile,
      files: discovered.files,
      ...loaded.value.virtualSource,
    },
    loaded.value.assemblyCarrier,
    sourceAssets.value.sourceAssetBytes,
  );
  expect(checked.diagnostics).toEqual([]);
  assert(checked.valid);
  const definition = presentationDefinitionSchema.parse(checked.value.definition);
  expect(definition.schemaVersion).toBe(3);
  expect(
    Object.values(definition.scene.nodes).filter((node) => node.kind === "model"),
  ).toHaveLength(2);
  const video = definition.scene.surfaces["video:video-surface"];
  assert(video);
  assert(video.content.kind === "structured");
  expect(video.content.nodes["video:movie"]).toMatchObject({
    kind: "video",
    assetId: "movie-source",
    loop: false,
  });
});
