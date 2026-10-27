import type {
  ConnectionSnapshotEnvelopeWire,
  ControlServerItemWire,
  DeliveryManifestWire,
  ProjectedReliableEventWire_payload,
} from "@unframe/contracts/presentation";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";

export interface FixtureScenario {
  delivery: DeliveryManifestWire;
  snapshot: ConnectionSnapshotEnvelopeWire;
  actions: { label: string; item: ControlServerItemWire }[];
}

export async function createFixtureScenario(baseUrl: string): Promise<FixtureScenario> {
  const images = await Promise.all(
    ["a", "b"].map(async (name) => {
      const url = new URL(`/src/dev/fixtures/slide-${name}.png`, baseUrl);
      const response = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error("fixture-asset-load-failed");
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const checksum = `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
      return {
        assetId: checksum,
        checksum,
        encodedSizeBytes: String(bytes.byteLength),
        pixelSize: { width: "512", height: "288" },
        alphaMode: 1,
        mipCount: 1,
        decodedGpuBytes: String(512 * 288 * 4),
        url: url.href,
      };
    }),
  );
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  const profile = delivery.projectionProfile!;
  profile.key!.role = 2;
  profile.requiredRuntimeCapabilities = [1, 2, 3, 8, 9, 10];
  const profileId = profile.projectionProfileId!;
  const catalog = profile.runtimeCatalog!;
  const owner = (groupId: string) => ({ group: { groupId } });
  const transform = (x = 0) => ({
    position: { x, y: 0.5, z: 0.03 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  catalog.nodes = ["intro", "next"].map((group) => ({
    nodeId: `${group}-node`,
    parent: { stage: {} },
    owner: owner(group),
    surface: { semanticSurfaceId: `${group}-surface` },
  }));
  catalog.surfaces = ["intro", "next"].map((group) => ({
    surfaceId: `${group}-surface`,
    hostNodeId: `${group}-node`,
    owner: owner(group),
    reachableStateIds: ["slide-a", "slide-b"],
    physicalSizeMeters: { x: 1, y: 0.5625 },
    logicalSize: { x: 512, y: 288 },
    fit: 1,
  }));
  catalog.variables = [{ variableId: "fixture-status", type: 1, owner: { presentation: {} } }];
  catalog.timelines = [
    {
      timelineId: "fixture-move",
      owner: owner("intro"),
      durationMs: "3000",
      tracks: [
        {
          target: { nodeId: "intro-node", property: 1 },
          keyframes: [
            { timeMs: "0", number: { value: 1 }, easingToNext: 1 },
            { timeMs: "3000", number: { value: 0.65 } },
          ],
        },
        {
          target: { nodeId: "intro-node", property: 2 },
          keyframes: [
            { timeMs: "0", vector3: { value: transform().position }, easingToNext: 1 },
            { timeMs: "3000", vector3: { value: transform(0.3).position } },
          ],
        },
      ],
    },
  ];
  profile.visibleNodeIds = catalog.nodes.map((node) => node.nodeId!);
  profile.visibleSurfaceIds = catalog.surfaces.map((surface) => surface.surfaceId!);
  profile.visibleVariableIds = ["fixture-status"];
  profile.semanticSurfaces = [];
  profile.renderSurfaces = ["intro", "next"].map((group) => ({
    renderSurfaceId: `${group}-render`,
    semanticSurfaceId: `${group}-surface`,
    logicalBounds: { x: 0, y: 0, width: 512, height: 288 },
    rendererKind: 1,
    artifactContractVersion: 1,
    stateBindings: ["a", "b"].map((name) => ({
      stateId: `slide-${name}`,
      artifact: { artifactId: `${group}-artifact` },
    })),
    artifacts: [
      {
        bakedWeb: {
          artifactId: `${group}-artifact`,
          contractVersion: 1,
          requiredFeatures: [1, 2, 3],
          states: images.map((image, index) => ({
            stateId: index === 0 ? "slide-a" : "slide-b",
            texture: {
              assetId: image.assetId,
              checksum: image.checksum,
              encodedSizeBytes: image.encodedSizeBytes,
              pixelSize: image.pixelSize,
              alphaMode: image.alphaMode,
              mipCount: image.mipCount,
              decodedGpuBytes: image.decodedGpuBytes,
            },
          })),
        },
      },
    ],
  }));
  delivery.assetAccess = images.map((image) => ({
    assetId: image.assetId,
    checksum: image.checksum,
    mediaType: "image/png",
    encodedSizeBytes: image.encodedSizeBytes,
    url: image.url,
    expiresAtUnixMs: String(Date.now() + 3_600_000),
  }));
  const peak = (image: (typeof images)[number]) => 512 * 288 * 8 + Number(image.encodedSizeBytes);
  delivery.residency!.textures!.textures = images.map((image) => ({
    assetId: image.assetId,
    checksum: image.checksum,
    pixelSize: image.pixelSize,
    decodedGpuBytes: image.decodedGpuBytes,
    peakLoadCpuBytes: String(peak(image)),
  }));
  delivery.residency!.textures!.totalDecodedGpuBytes = String(512 * 288 * 4 * images.length);
  delivery.residency!.textures!.maximumPeakLoadCpuBytes = String(Math.max(...images.map(peak)));
  delivery.residency!.totalSelectedEncodedBytes = String(
    images.reduce((sum, image) => sum + Number(image.encodedSizeBytes), 0),
  );
  const fence = {
    sessionId: delivery.sessionId!,
    publication: delivery.publication!,
    assignmentEpoch: "1",
    projectionProfileId: profileId,
    presentationOriginVersion: "0",
  };
  const snapshot: ConnectionSnapshotEnvelopeWire = {
    schemaVersion: 3,
    connectionId: "fixture-connection",
    fence,
    projectionInstance: delivery.projectionInstance!,
    reliableSequence: "0",
    snapshot: {
      projectionProfileId: profileId,
      assignmentEpoch: "1",
      reliableSequence: "0",
      runtimeView: {
        projectionProfileId: profileId,
        assignmentEpoch: "1",
        baseReliableSequence: "0",
        progression: {
          currentGroupId: "intro",
          groupEntryEpoch: "1",
          currentStepId: "start",
          stepEntryEpoch: "1",
          stepEnteredAtRuntimeTimeMs: "0",
          stable: {},
        },
        nodeStates: [
          { nodeId: "intro-node", active: true, visible: true, opacity: 1, transform: transform() },
        ],
        surfaceStates: [{ surfaceId: "intro-surface", stateId: "slide-a" }],
        variables: [{ variableId: "fixture-status", value: { stringValue: "開始" } }],
        activeRuns: [],
        mediaStates: [],
        modelClipStates: [],
        enabledLogicalInputs: [],
        clock: { runtimeTimeMs: "0", running: {} },
        presentationOrigin: {
          version: "0",
          pose: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      },
    },
  };
  const actions: FixtureScenario["actions"] = [];
  const send = (label: string, time: number, payload: ProjectedReliableEventWire_payload) => {
    const sequence = String(actions.length + 1);
    actions.push({
      label,
      item: {
        reliableEvent: {
          fence,
          sequence,
          eventId: `fixture-${sequence}`,
          occurredAtRuntimeTimeMs: String(time),
          ...payload,
        },
      },
    });
  };
  const cause = {
    cueId: "fixture-cue",
    causeEventId: "fixture-cause",
    groupId: "intro",
    groupEntryEpoch: "1",
    stepId: "start",
    stepEntryEpoch: "1",
  };
  const runId = { assignmentEpoch: "1", runSequence: "1" };
  send("移動・透過アニメーション開始（3秒）", 0, {
    timelineStarted: {
      runId,
      timelineId: "fixture-move",
      owner: { group: { groupId: "intro", groupEntryEpoch: "1" } },
      cause,
      completion: 2,
      startedAtRuntimeTimeMs: "0",
    },
  });
  send("1秒地点で一時停止", 1000, { runtimeStatusChanged: { paused: { reason: 8 } } });
  send("再開", 1000, { runtimeStatusChanged: { running: {} } });
  send("アニメーションを完了", 3000, { timelineCompleted: { runId, timelineId: "fixture-move" } });
  const fadeId = { assignmentEpoch: "1", runSequence: "2" };
  const transition = {
    surfaceId: "intro-surface",
    fromStateId: "slide-a",
    toStateId: "slide-b",
    durationMs: "2000",
    easing: 1,
  };
  send("A → B クロスフェード開始（2秒）", 3000, {
    surfaceTransitionStarted: {
      surfaceId: "intro-surface",
      runId: fadeId,
      fromStateId: "slide-a",
      stateId: "slide-b",
      startedAtRuntimeTimeMs: "3000",
      durationMs: "2000",
      easing: 1,
      run: {
        runId: fadeId,
        owner: { group: { groupId: "intro", groupEntryEpoch: "1" } },
        cause,
        completion: 1,
        startedAtRuntimeTimeMs: "3000",
        surfaceTransition: transition,
      },
    },
  });
  send("クロスフェードを完了", 5000, {
    surfaceTransitionCompleted: { surfaceId: "intro-surface", runId: fadeId, stateId: "slide-b" },
  });
  send("変数を更新", 5001, {
    variableChanged: {
      state: { variableId: "fixture-status", value: { stringValue: "更新済み" } },
    },
  });
  send("Group 1 から退出（非表示）", 5002, {
    groupExited: { groupId: "intro", groupEntryEpoch: "1" },
  });
  send("Group 2 を初期化", 5003, {
    groupEntered: {
      groupId: "next",
      groupEntryEpoch: "2",
      initialization: {
        nodeStates: [
          {
            nodeId: "next-node",
            active: true,
            visible: true,
            opacity: 1,
            transform: transform(0.3),
          },
        ],
        surfaceStates: [{ surfaceId: "next-surface", stateId: "slide-a" }],
      },
    },
  });
  send("Group 2 のStepを開始（Aを表示）", 5004, {
    stepEntered: {
      groupId: "next",
      groupEntryEpoch: "2",
      stepId: "start",
      stepEntryEpoch: "2",
      enteredAtRuntimeTimeMs: "5004",
    },
  });
  send("プレゼンを終了", 5005, { presentationEnded: { reason: 1 } });
  return { delivery, snapshot, actions };
}
