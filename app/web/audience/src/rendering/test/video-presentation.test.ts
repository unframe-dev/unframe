import { describe, expect, it, vi } from "vitest";
import { Group, VideoTexture } from "three";
import { participantRuntimeViewSchema } from "@unframe/contracts/presentation";
import { videoFixture } from "./support/video-test-fixture";
import { createVideoPresentation } from "../video-presentation";
import type { loadVideoAsset } from "../../assets/video-asset";

describe("video presentation", () => {
  it("keeps the loaded decoder and playback when only signed access is refreshed", async () => {
    const f = videoFixture();
    const view = participantRuntimeViewSchema.parse(f.view);
    const loaded = {
      texture: new VideoTexture({} as HTMLVideoElement),
      video: {} as HTMLVideoElement,
      synchronize: vi.fn(),
      dispose: vi.fn(),
      playbackBlocked: false,
      resumePlayback: vi.fn(async () => undefined),
    };
    const loadAsset = vi.fn(async () => loaded);
    const presentation = await createVideoPresentation({
      host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
      delivery: f.delivery,
      view,
      loadAsset: loadAsset as typeof loadVideoAsset,
    });
    try {
      const access = f.delivery.assetAccess![0]!;
      access.url = "https://assets.test/v.mp4?signature=renewed";
      access.expiresAtUnixMs = "20000";
      view.mediaStates[f.id] = {
        kind: "active",
        runId: { assignmentEpoch: 1, runSequence: 1 },
        playback: {
          kind: "playing",
          positionAtReferenceMilliseconds: 500,
          referenceRuntimeTimeMilliseconds: 1000,
        },
      };
      expect(presentation.applyView(view)).toBe(true);
      presentation.applyAnimationFrame(view, 2000);
      expect(loaded.synchronize).toHaveBeenLastCalledWith(1.5, true);
      expect(loadAsset).toHaveBeenCalledOnce();
      expect([...presentation.getLoadedAssets().values()]).toEqual([loaded]);
      expect(loaded.dispose).not.toHaveBeenCalled();

      access.checksum = `sha256:${"2".repeat(64)}`;
      f.delivery.projectionProfile!.renderSurfaces![0]!.artifacts![0]!.video!.checksum =
        access.checksum;
      expect(presentation.applyView(view)).toBe(false);
      expect(loaded.dispose).not.toHaveBeenCalled();
    } finally {
      presentation.dispose();
    }
  });

  it("synchronizes late joins, paused clock and document visibility without relocating the stage", async () => {
    const f = videoFixture();
    const view = participantRuntimeViewSchema.parse(f.view);
    const synchronize = vi.fn(),
      dispose = vi.fn(),
      resumePlayback = vi.fn(async () => undefined);
    const loaded = {
      texture: new VideoTexture({} as HTMLVideoElement),
      video: {} as HTMLVideoElement,
      synchronize,
      dispose,
      playbackBlocked: false,
      resumePlayback,
    };
    const host = { contentRoot: new Group(), setPresentationOrigin: vi.fn() };
    const presentation = await createVideoPresentation({
      host,
      delivery: f.delivery,
      view,
      loadAsset: vi.fn(async () => loaded) as typeof loadVideoAsset,
    });
    expect(host.contentRoot.children).toHaveLength(1);
    expect(synchronize).toHaveBeenLastCalledWith(0, false);
    view.mediaStates[f.id] = {
      kind: "active",
      runId: { assignmentEpoch: 1, runSequence: 1 },
      playback: {
        kind: "playing",
        positionAtReferenceMilliseconds: 500,
        referenceRuntimeTimeMilliseconds: 1000,
      },
    };
    presentation.applyAnimationFrame(view, 2000);
    expect(synchronize).toHaveBeenLastCalledWith(1.5, true);
    presentation.setPlaybackEnabled(false);
    expect(synchronize).toHaveBeenLastCalledWith(1.5, false);
    presentation.setPlaybackEnabled(true);
    expect(synchronize).toHaveBeenLastCalledWith(1.5, true);
    view.clock.lifecycle = { kind: "paused", reason: "pause" };
    presentation.applyAnimationFrame(view, 2000);
    expect(synchronize).toHaveBeenLastCalledWith(1.5, false);
    delete view.mediaStates[f.id];
    presentation.applyAnimationFrame(view, 2000);
    expect(synchronize).toHaveBeenLastCalledWith(0, false);
    expect(presentation.getLoadedAssets().size).toBe(1);
    await presentation.resumePlayback();
    expect(resumePlayback).toHaveBeenCalledOnce();
    presentation.dispose();
    presentation.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.contentRoot.children).toHaveLength(0);
  });
  it("releases videos no longer selected and refuses unloaded replacements", async () => {
    const f = videoFixture();
    const view = participantRuntimeViewSchema.parse(f.view);
    const dispose = vi.fn();
    const loaded = {
      texture: new VideoTexture({} as HTMLVideoElement),
      video: {} as HTMLVideoElement,
      synchronize: vi.fn(),
      dispose,
      playbackBlocked: false,
      resumePlayback: vi.fn(async () => undefined),
    };
    const presentation = await createVideoPresentation({
      host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
      delivery: f.delivery,
      view,
      attachRoot: false,
      loadAsset: vi.fn(async () => loaded) as typeof loadVideoAsset,
    });
    const render = f.delivery.projectionProfile!.renderSurfaces![0]!;
    const artifact = render.artifacts![0]!.video!;
    artifact.durationMs = "3000";
    expect(presentation.applyView(view)).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    artifact.durationMs = "2000";
    render.stateBindings![0] = { stateId: "reference-surface:default", empty: {} };
    expect(presentation.applyView(view)).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(presentation.getLoadedAssets().size).toBe(0);
    expect(presentation.retainedCpuBytes).toBe(0);
    presentation.dispose();
  });
});
