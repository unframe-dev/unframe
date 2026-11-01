import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { assert, expect, it } from "vitest";
import { verifyBuildIntegrity } from "@unframe/artifacts";
import { createLocalPlayback } from "@unframe/preview";
import { runPresentationCli } from "../src/index.js";
import { createMediaProjectFixture } from "./media-project-fixture.js";

it("builds a registered MP4 with a playback cue and matching artifact bytes", async () => {
  const directory = await createMediaProjectFixture();
  try {
    const result = await runPresentationCli({ args: ["build", directory] });
    expect(result.exitCode, result.stderr).toBe(0);
    const readJson = async (name: string) =>
      JSON.parse(await readFile(join(directory, "dist", `${name}.json`), "utf8")) as unknown;
    const integrity = verifyBuildIntegrity({
      definition: await readJson("definition"),
      renderBundle: await readJson("render-bundle"),
      assetSet: await readJson("asset-set"),
      buildManifest: await readJson("build-manifest"),
    });
    assert(integrity.valid, JSON.stringify(integrity.diagnostics));
    expect(integrity.value.assetSet.assets.movie?.mediaType).toBe("video/mp4");
    expect(await readFile(join(directory, "dist/assets/movie.mp4"))).toEqual(
      await readFile(join(directory, "video.mp4")),
    );
    const actions = Object.values(integrity.value.definition.flow.groups).flatMap((group) =>
      Object.values(group.steps).flatMap((step) => step.cues.flatMap((cue) => cue.actions)),
    );
    expect(actions).toContainEqual(expect.objectContaining({ kind: "media.play" }));
    const definition = integrity.value.definition;
    const requestId = "a".repeat(32);
    const playback = createLocalPlayback({
      requestId,
      definition,
      renderBundle: integrity.value.renderBundle,
      visibleNodeIds: new Set(Object.keys(definition.scene.nodes)),
      visibleSurfaceIds: new Set(Object.keys(definition.scene.surfaces)),
      visibleTimelineIds: new Set(Object.keys(definition.flow.timelines)),
      now: () => 0,
    });
    playback({ requestId, command: "play" });
    const started = playback({ requestId, command: "input", cueId: "open" });
    expect(started.state.mediaStates).toContainEqual(
      expect.objectContaining({
        active: expect.objectContaining({
          playback: expect.objectContaining({ playing: expect.anything() }),
        }),
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
