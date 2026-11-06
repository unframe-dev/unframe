import { afterEach, expect, it, vi } from "vite-plus/test";
import { AnimationClip, Group, Mesh, PerspectiveCamera, Texture, Vector3 } from "three";
import { createPresentationSession } from "../presentation-session";
import { createMediaFixtureScenario } from "../../dev/fixtures/media-scenario";
import { createFixtureScenario } from "../../dev/fixtures/scenario";
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

it("renders a tracked hand in Stage coordinates through the session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => new Response(new TextEncoder().encode(String(url)))),
  );
  vi.mocked(loadPngTexture).mockImplementation(async () => ({
    texture: new Texture(),
    dispose: vi.fn(),
    releaseCpuCopy: vi.fn(),
  }));
  const { delivery, snapshot } = await createFixtureScenario("https://audience.example.test");
  delivery.capabilityProfile!.limits!.texture!.maxGpuBytes = "999999999";
  delivery.capabilityProfile!.limits!.texture!.maxTextureBindings = "100";
  const profile = delivery.projectionProfile!;
  profile.runtimeCatalog!.trackedPoseTargets = [2];
  profile.requiredRuntimeCapabilities!.push(12);
  const view = snapshot.snapshot!.runtimeView!;
  view.presentationOrigin!.pose!.position = { x: 10 };
  view.effectRuns = [
    {
      runId: { assignmentEpoch: "1", runSequence: "1" },
      owner: { presentation: {} },
      cause: {
        cueId: "hand",
        causeEventId: "event",
        groupId: "intro",
        groupEntryEpoch: "1",
        stepId: "start",
        stepEntryEpoch: "1",
      },
      startedAtRuntimeTimeMs: "0",
      effectId: "hand",
      nodeId: "intro-node",
      seed: 1,
      status: 1,
      configuration: {
        kind: 2,
        hand: 1,
        size: 1,
        color: { red: 1, green: 1, blue: 1, alpha: 1 },
        speed: 1,
        durationMs: "1000",
      },
    },
  ];
  const scene = new Group();
  scene.position.x = 50;
  const contentRoot = new Group();
  scene.add(contentRoot);
  const session = createPresentationSession({ canPlay: () => true, onPlaybackBlocked() {} });
  session.attachScene(
    {
      contentRoot,
      setPresentationOrigin(matrix: import("three").Matrix4) {
        contentRoot.position.setFromMatrixPosition(matrix);
      },
    } as never,
    {
      resetState() {},
      initTexture(texture: Texture) {
        texture.onUpdate?.(texture);
      },
    },
  );
  const runtime = session.openRuntime(delivery);
  runtime.applyControl({ connectionSnapshot: snapshot });
  await runtime.waitForIdle();
  expect(runtime.getSnapshot().phase).toBe("ready");
  expect(runtime.getSnapshot()).toMatchObject({ rendering: "ready", assetFailure: null });
  scene.updateMatrixWorld(true);
  const camera = new PerspectiveCamera();
  session.prepareRender(camera);
  runtime.applyState({
    connected: { connectionId: "fixture-connection", nextStateFrameSequence: "1" },
  });
  runtime.applyState({
    stateFrame: {
      fence: snapshot.fence!,
      frameSequence: "1",
      baseReliableSequence: "0",
      kind: 1,
      producedAtRuntimeMonotonicMs: "100",
      elements: [
        {
          elementId: "intro-node",
          node: {
            active: true,
            visible: true,
            opacity: 1,
            transform: { ...view.nodeStates![0]!.transform!, position: { x: 1, y: 0.5, z: 0.03 } },
          },
        },
      ],
      trackedPoses: [
        {
          target: 2,
          sample: {
            trackingFrameSequence: "1",
            observedAtRuntimeMonotonicMs: "100",
            position: { x: 2 },
          },
        },
      ],
    },
  });
  await runtime.waitForIdle();
  expect(runtime.getSnapshot().phase).toBe("ready");
  scene.updateMatrixWorld(true);
  session.prepareRender(camera);
  const firstNode = contentRoot.getObjectByName("intro-node")!;
  const firstEffect = firstNode.children.find(
    (child) =>
      child instanceof Group &&
      child.children.length === 2 &&
      child.children.every((item) => item instanceof Mesh),
  )!;
  expect(firstEffect.visible).toBe(true);
  runtime.applyState({
    stateFrame: {
      fence: snapshot.fence!,
      frameSequence: "2",
      baseReliableSequence: "0",
      kind: 1,
      producedAtRuntimeMonotonicMs: "110",
      elements: [
        {
          elementId: "intro-node",
          node: {
            active: true,
            visible: true,
            opacity: 1,
            transform: view.nodeStates![0]!.transform!,
          },
        },
      ],
      trackedPoses: [
        {
          target: 2,
          sample: {
            trackingFrameSequence: "2",
            observedAtRuntimeMonotonicMs: "110",
            position: { x: 2 },
          },
        },
      ],
    },
  });
  await runtime.waitForIdle();
  scene.updateMatrixWorld(true);
  session.prepareRender(camera);
  const node = contentRoot.getObjectByName("intro-node")!;
  expect(node).not.toBe(firstNode);
  expect(firstEffect.parent).toBe(node);
  expect((firstEffect.children[1] as Mesh).geometry.drawRange.count).toBe(6);
  expect(runtime.getSnapshot().stateSync).toBe("ready");
  expect(runtime.getSnapshot().rendering).toBe("ready");
  const halo = node.children.find(
    (child) =>
      child instanceof Group &&
      child.children.length === 2 &&
      child.children.every((item) => item instanceof Mesh),
  )!.children[0] as Mesh;
  const point = new Vector3().fromBufferAttribute(halo.geometry.getAttribute("position"), 0);
  halo.localToWorld(point);
  expect(point.x).toBeCloseTo(62.035);
  session.dispose();
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
