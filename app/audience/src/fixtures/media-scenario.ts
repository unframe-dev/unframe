import type {
  ProjectedReliableEventWire_payload,
  RuntimeRunSnapshotWire,
} from "@unframe/contracts/presentation";
import { createFixtureScenario, type FixtureScenario } from "./scenario";

export async function createMediaFixtureScenario(
  baseUrl: string,
  options: { joiningMidPlayback?: boolean } = {},
): Promise<FixtureScenario> {
  const scenario = await createFixtureScenario(baseUrl);
  const assets = await Promise.all(
    ["motion.mp4", "cube.glb"].map(async (name) => {
      const url = new URL(`/src/fixtures/${name}`, baseUrl);
      const response = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error("fixture-asset-load-failed");
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const checksum = `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
      return { checksum, encodedSizeBytes: String(bytes.byteLength), url: url.href };
    }),
  );
  const video = assets[0]!;
  const model = assets[1]!;
  const { delivery, snapshot } = scenario;
  const profile = delivery.projectionProfile!;
  profile.requiredRuntimeCapabilities = [1, 2, 3, 4, 5, 8, 9, 10];
  const catalog = profile.runtimeCatalog!;
  const owner = { presentation: {} };
  catalog.nodes!.push(
    {
      nodeId: "video-node",
      parent: { stage: {} },
      owner,
      surface: { semanticSurfaceId: "video-surface" },
    },
    { nodeId: "model-node", parent: { stage: {} }, owner, model: { modelAssetId: model.checksum } },
  );
  catalog.nodes!.sort((a, b) => (a.nodeId! < b.nodeId! ? -1 : 1));
  catalog.surfaces!.push({
    surfaceId: "video-surface",
    hostNodeId: "video-node",
    reachableStateIds: ["video"],
    hasVideo: true,
    physicalSizeMeters: { x: 0.6, y: 0.3375 },
    logicalSize: { x: 320, y: 180 },
    fit: 1,
    owner,
  });
  catalog.modelClips = ["Rotate", "Bounce"].map((clipId, sourceAnimationIndex) => ({
    modelNodeId: "model-node",
    modelAssetId: model.checksum,
    clipId,
    sourceAnimationIndex,
    durationMs: "4000",
    owner,
  }));
  profile.visibleNodeIds = catalog.nodes!.map((entry) => entry.nodeId!);
  profile.visibleSurfaceIds = catalog.surfaces!.map((entry) => entry.surfaceId!);
  profile.renderSurfaces!.push({
    renderSurfaceId: "video-render",
    semanticSurfaceId: "video-surface",
    logicalBounds: { x: 0, y: 0, width: 320, height: 180 },
    rendererKind: 3,
    artifactContractVersion: 1,
    stateBindings: [{ stateId: "video", artifact: { artifactId: "video-artifact" } }],
    artifacts: [
      {
        video: {
          artifactId: "video-artifact",
          contractVersion: 1,
          requiredFeatures: [1],
          videoAssetId: video.checksum,
          checksum: video.checksum,
          pixelSize: { width: "320", height: "180" },
          durationMs: "4000",
          loop: false,
          hasAudio: false,
          encodedSizeBytes: video.encodedSizeBytes,
          codec: 1,
          hasAlpha: false,
          fit: 1,
        },
      },
    ],
  });
  delivery.assetAccess!.push(
    ...assets.map((asset, index) => ({
      assetId: asset.checksum,
      checksum: asset.checksum,
      mediaType: index === 0 ? "video/mp4" : "model/gltf-binary",
      encodedSizeBytes: asset.encodedSizeBytes,
      url: asset.url,
      expiresAtUnixMs: String(Date.now() + 3_600_000),
    })),
  );
  const capability = delivery.capabilityProfile!;
  capability.renderers!.video = { supported: true, contractVersion: 1, features: [1] };
  capability.model = { supported: true, contractVersion: 1, formats: [1], features: [1, 7] };
  capability.limits!.video = {
    tierId: "fixture-video",
    maxWidth: "1920",
    maxHeight: "1080",
    maxPixels: "2073600",
    maxConcurrentDecoders: "2",
    maxEncodedBytes: "16777216",
    maxDecodedFrameBytes: "16777216",
  };
  capability.limits!.model = {
    tierId: "fixture-model",
    maxAssets: "2",
    maxInstances: "2",
    maxEncodedBytes: "16777216",
    maxNodes: "100",
    maxPrimitives: "100",
    maxVertices: "100000",
    maxTriangles: "100000",
    maxBonesPerSkin: "64",
    maxMorphTargetsPerPrimitive: "8",
    maxAnimationClipsPerAsset: "8",
  };
  delivery.residency!.video = {
    budgetTierId: "fixture-video",
    videos: [
      {
        assetId: video.checksum,
        checksum: video.checksum,
        encodedSizeBytes: video.encodedSizeBytes,
        decodedFrameBytes: String(320 * 180 * 4),
      },
    ],
    totalEncodedBytes: video.encodedSizeBytes,
    maximumConcurrentDecoders: "1",
    maximumDecodedFrameBytes: String(320 * 180 * 4),
  };
  delivery.residency!.models = {
    budgetTierId: "fixture-model",
    models: [
      {
        assetId: model.checksum,
        checksum: model.checksum,
        encodedSizeBytes: model.encodedSizeBytes,
        format: 1,
        requiredFeatures: [1, 7],
        nodeCount: "1",
        primitiveCount: "1",
        vertexCount: "8",
        triangleCount: "12",
        maximumBonesPerSkin: "0",
        maximumMorphTargetsPerPrimitive: "0",
        animationClipCount: "2",
      },
    ],
    totalEncodedBytes: model.encodedSizeBytes,
    totalVertices: "8",
    totalTriangles: "12",
    modelInstanceCount: "1",
    totalNodes: "1",
    totalPrimitives: "1",
  };
  delivery.residency!.totalSelectedEncodedBytes = String(
    Number(delivery.residency!.totalSelectedEncodedBytes) +
      Number(video.encodedSizeBytes) +
      Number(model.encodedSizeBytes),
  );
  const view = snapshot.snapshot!.runtimeView!;
  const transform = (x: number) => ({
    position: { x, y: 0.5, z: 0.03 },
    rotation: { w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  view.nodeStates!.push(
    { nodeId: "video-node", active: true, visible: true, opacity: 1, transform: transform(-0.95) },
    { nodeId: "model-node", active: true, visible: true, opacity: 1, transform: transform(0.85) },
  );
  view.nodeStates!.sort((a, b) => (a.nodeId! < b.nodeId! ? -1 : 1));
  view.surfaceStates!.push({ surfaceId: "video-surface", stateId: "video" });
  view.mediaStates = [{ surfaceId: "video-surface", stopped: { heldPositionMs: 0 } }];
  view.modelClipStates = [{ modelNodeId: "model-node", defaultPose: {} }];
  const cause = {
    cueId: "fixture-media-cue",
    causeEventId: "fixture-media-cause",
    groupId: "intro",
    groupEntryEpoch: "1",
    stepId: "start",
    stepEntryEpoch: "1",
  };
  const runBase = (sequence: number, time: number) => ({
    runId: { assignmentEpoch: "1", runSequence: String(sequence) },
    owner,
    cause,
    completion: 2,
    startedAtRuntimeTimeMs: String(time),
  });
  const mediaId = { assignmentEpoch: "1", runSequence: "1" };
  const modelId = { assignmentEpoch: "1", runSequence: "2" };
  const initialMedia = {
    ...runBase(1, 0),
    media: { surfaceId: "video-surface", playback: { playing: { referenceRuntimeTimeMs: "0" } } },
  } as RuntimeRunSnapshotWire;
  const initialModel = {
    ...runBase(2, 0),
    modelClip: {
      modelNodeId: "model-node",
      single: {
        clipId: "Rotate",
        speed: 1,
        loop: false,
        playback: { playing: { referenceRuntimeTimeMs: "0" } },
      },
    },
  } as RuntimeRunSnapshotWire;
  const offset = options.joiningMidPlayback ? 2000 : 0;
  if (options.joiningMidPlayback) {
    view.clock!.runtimeTimeMs = "2000";
    view.activeRuns = [initialMedia, initialModel];
    view.mediaStates = [
      {
        surfaceId: "video-surface",
        active: { runId: mediaId, playback: initialMedia.media!.playback! },
      },
    ];
    view.modelClipStates = [{ modelNodeId: "model-node", active: { runId: modelId } }];
  }
  const actions: FixtureScenario["actions"] = [];
  const send = (label: string, time: number, payload: ProjectedReliableEventWire_payload) => {
    const sequence = String(actions.length + 1);
    actions.push({
      label,
      item: {
        reliableEvent: {
          fence: snapshot.fence!,
          sequence,
          eventId: `fixture-media-${sequence}`,
          occurredAtRuntimeTimeMs: String(time + offset),
          ...payload,
        },
      },
    });
  };
  if (!options.joiningMidPlayback) {
    send("動画を再生", 0, {
      mediaStarted: {
        runId: mediaId,
        surfaceId: "video-surface",
        playback: initialMedia.media!.playback!,
        run: initialMedia,
      },
    });
    send("GLB Rotateを再生", 0, {
      modelClipStarted: {
        runId: modelId,
        modelNodeId: "model-node",
        playback: initialModel.modelClip!.single!,
        run: initialModel,
      },
    });
  }
  const pausedMedia = {
    ...initialMedia,
    media: { surfaceId: "video-surface", playback: { paused: { positionMs: 1000 + offset } } },
  } as RuntimeRunSnapshotWire;
  send("動画を一時停止", 1000, {
    mediaPaused: {
      runId: mediaId,
      surfaceId: "video-surface",
      positionMs: 1000 + offset,
      run: pausedMedia,
    },
  });
  const pausedModel = {
    ...initialModel,
    modelClip: {
      modelNodeId: "model-node",
      single: {
        ...initialModel.modelClip!.single!,
        playback: { paused: { positionMs: 1000 + offset } },
      },
    },
  } as RuntimeRunSnapshotWire;
  send("GLBを一時停止", 1000, {
    modelClipPaused: { runId: modelId, modelNodeId: "model-node", run: pausedModel },
  });
  const seeked = {
    ...initialMedia,
    media: { surfaceId: "video-surface", playback: { paused: { positionMs: 2000 } } },
  } as RuntimeRunSnapshotWire;
  send("動画を2秒地点へシーク", 1000, {
    mediaSeeked: {
      runId: mediaId,
      surfaceId: "video-surface",
      playback: seeked.media!.playback!,
      run: seeked,
    },
  });
  const resumedMedia = {
    ...initialMedia,
    media: {
      surfaceId: "video-surface",
      playback: {
        playing: { positionAtReferenceMs: 2000, referenceRuntimeTimeMs: String(offset + 1500) },
      },
    },
  } as RuntimeRunSnapshotWire;
  send("動画を再開", 1500, {
    mediaResumed: {
      runId: mediaId,
      surfaceId: "video-surface",
      playback: resumedMedia.media!.playback!.playing!,
      run: resumedMedia,
    },
  });
  const resumedModel = {
    ...initialModel,
    modelClip: {
      modelNodeId: "model-node",
      single: {
        ...initialModel.modelClip!.single!,
        playback: {
          playing: {
            positionAtReferenceMs: 1000 + offset,
            referenceRuntimeTimeMs: String(offset + 1500),
          },
        },
      },
    },
  } as RuntimeRunSnapshotWire;
  send("GLBを再開", 1500, {
    modelClipResumed: { runId: modelId, modelNodeId: "model-node", run: resumedModel },
  });
  const fade = {
    ...runBase(3, offset + 2000),
    modelClip: {
      modelNodeId: "model-node",
      crossfade: {
        from: resumedModel.modelClip!.single!,
        to: {
          clipId: "Bounce",
          speed: 1,
          loop: false,
          playback: { playing: { referenceRuntimeTimeMs: String(offset + 2000) } },
        },
        transitionClock: { playing: { referenceRuntimeTimeMs: String(offset + 2000) } },
        durationMs: "1000",
        easing: 1,
        fromIsHeld: false,
      },
    },
  } as RuntimeRunSnapshotWire;
  send("GLB Rotate → Bounce（1秒）", 2000, {
    modelClipCrossfadeStarted: {
      runId: fade.runId!,
      modelNodeId: "model-node",
      crossfade: fade.modelClip!.crossfade!,
      run: fade,
    },
  });
  send("プレゼン時計を一時停止", 2500, { runtimeStatusChanged: { paused: { reason: 8 } } });
  send("プレゼン時計を再開", 2500, { runtimeStatusChanged: { running: {} } });
  const faded = {
    ...fade,
    modelClip: { modelNodeId: "model-node", single: fade.modelClip!.crossfade!.to! },
  } as RuntimeRunSnapshotWire;
  send("GLBクロスフェード完了", 3000, {
    modelClipCrossfadeCompleted: {
      runId: fade.runId!,
      modelNodeId: "model-node",
      playback: faded.modelClip!.single!,
      run: faded,
    },
  });
  send("動画を停止", 3500, {
    mediaStopped: { runId: mediaId, surfaceId: "video-surface", heldPositionMs: 4000 },
  });
  send("GLBの現在姿勢を保持して停止", 3500, {
    modelClipStopped: {
      runId: fade.runId!,
      modelNodeId: "model-node",
      clip: { clipId: "Bounce", positionMs: 1500 },
    },
  });
  send("停止中の動画を1秒地点へ", 3500, {
    mediaStoppedSeeked: { surfaceId: "video-surface", heldPositionMs: 1000 },
  });
  send("プレゼンを終了", 3501, { presentationEnded: { reason: 1 } });
  return { delivery, snapshot, actions };
}
