import { afterEach, expect, it, vi } from "vitest";
import { AnimationClip, Group, Texture } from "three";
import { createPresentationSession } from "../presentation-session";
import { createMediaFixtureScenario } from "../../dev/fixtures/media-scenario";
import { createRuntimeStore } from "../../runtime/runtime-store";
import { loadVideoAsset } from "../../assets/video-asset";
import { loadPngTexture } from "../../assets/png-texture";
import { loadModelAsset } from "../../assets/model-asset";

vi.mock("../../assets/video-asset", () => ({ loadVideoAsset: vi.fn() }));
vi.mock("../../assets/png-texture", () => ({ loadPngTexture: vi.fn() }));
vi.mock("../../assets/model-asset", () => ({ loadModelAsset: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("keeps the old video frame visible while replacing its decoder within the one-decoder limit", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => new Response(new TextEncoder().encode(String(url)))),
  );
  const { delivery, snapshot } = await createMediaFixtureScenario("https://audience.example.test");
  delivery.capabilityProfile!.limits!.video!.maxConcurrentDecoders = "1";
  const render = delivery.projectionProfile!.renderSurfaces!.find(
    (surface) => surface.rendererKind === 3,
  )!;
  const artifact = render.artifacts![0]!.video!;
  const nextArtifact = {
    ...artifact,
    artifactId: "replacement-video",
    videoAssetId: "replacement-video",
    checksum: `sha256:${"b".repeat(64)}`,
  };
  render.artifacts!.push({ video: nextArtifact });
  render.stateBindings!.push({
    stateId: "next-video",
    artifact: { artifactId: nextArtifact.artifactId },
  });
  delivery
    .projectionProfile!.runtimeCatalog!.surfaces!.find(
      (surface) => surface.surfaceId === "video-surface",
    )!
    .reachableStateIds!.push("next-video");
  const access = delivery.assetAccess!.find((asset) => asset.assetId === artifact.videoAssetId)!;
  delivery.assetAccess!.push({
    ...access,
    assetId: nextArtifact.videoAssetId,
    checksum: nextArtifact.checksum,
  });
  const store = createRuntimeStore(delivery);
  store.applyControl({ connectionSnapshot: snapshot });
  const first = store.getSnapshot().view!;
  expect(first).not.toBeNull();
  const next = structuredClone(first);
  next.surfaceStates["video-surface"] = { stateId: "next-video" };
  vi.mocked(loadPngTexture).mockImplementation(async () => ({
    texture: new Texture(),
    dispose: vi.fn(),
    releaseCpuCopy: vi.fn(),
  }));
  vi.mocked(loadModelAsset).mockImplementation(async () => ({
    scene: new Group(),
    animations: [new AnimationClip("Rotate", 4, []), new AnimationClip("Bounce", 4, [])],
    dispose: vi.fn(),
    retainedCpuBytes: 1648,
    textureGpuBytes: 0,
    textureBindings: 0,
  }));
  let activeDecoders = 0;
  const oldTexture = new Texture();
  const oldDispose = vi.fn();
  const oldGpuDispose = vi.spyOn(oldTexture, "dispose");
  let released = false;
  const releaseDecoder = vi.fn(() => {
    if (!released) {
      released = true;
      activeDecoders--;
    }
  });
  const oldVideo = {
    texture: oldTexture,
    synchronize: vi.fn(),
    releaseDecoder,
    dispose: oldDispose,
    playbackBlocked: false,
    resumePlayback: async () => {},
  };
  let finish!: () => void;
  vi.mocked(loadVideoAsset)
    .mockImplementationOnce(async () => {
      activeDecoders++;
      return oldVideo as never;
    })
    .mockImplementationOnce(async () => {
      expect(activeDecoders).toBe(0);
      activeDecoders++;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        ...oldVideo,
        texture: new Texture(),
        releaseDecoder: vi.fn(),
        dispose: vi.fn(),
      } as never;
    });
  const contentRoot = new Group();
  const initTexture = vi.fn((texture: Texture) => {
    texture.onUpdate?.(texture);
  });
  const session = createPresentationSession({ canPlay: () => true, onPlaybackBlocked() {} });
  session.attachScene({ contentRoot, setPresentationOrigin() {} } as never, {
    resetState() {},
    initTexture,
  });
  await session.present(delivery, first);
  const previousRoot = contentRoot.children[0];
  const pending = session.present(delivery, next);
  await vi.waitFor(() => expect(loadVideoAsset).toHaveBeenCalledTimes(2));
  expect(releaseDecoder).toHaveBeenCalledOnce();
  expect(initTexture).toHaveBeenCalledWith(oldTexture);
  expect(contentRoot.children).toEqual([previousRoot]);
  expect(oldDispose).not.toHaveBeenCalled();
  expect(oldGpuDispose).not.toHaveBeenCalled();
  expect(activeDecoders).toBe(1);
  finish();
  await pending;
  expect(oldDispose).toHaveBeenCalledOnce();
  expect(contentRoot.children).toHaveLength(1);
  expect(contentRoot.children[0]).not.toBe(previousRoot);
  session.dispose();
});
