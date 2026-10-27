import { expect, it, vi } from "vitest";
import { Group, Mesh, Texture } from "three";
import type {
  ConnectionSnapshotEnvelopeWire,
  DeliveryManifestWire,
  RuntimeProjectionFenceWire,
} from "@unframe/contracts/presentation";
import fixture from "../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { createRuntimePlayback } from "./playback";
import { createPngPresentation } from "../rendering/png-presentation";
import { evaluateAnimationView } from "./animation-view";
function setup() {
  const delivery = structuredClone(fixture.value) as DeliveryManifestWire;
  delivery.projectionProfile!.key!.role = 2;
  const profileId = delivery.projectionProfile!.projectionProfileId!;
  const nodeId = delivery.projectionProfile!.runtimeCatalog!.nodes![0]!.nodeId!;
  const surfaceId = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.surfaceId!;
  const fence: RuntimeProjectionFenceWire = {
    sessionId: delivery.sessionId!,
    publication: delivery.publication!,
    assignmentEpoch: "1",
    projectionProfileId: profileId,
    presentationOriginVersion: "0",
  };
  const transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
  const snapshot: ConnectionSnapshotEnvelopeWire = {
    schemaVersion: 3,
    connectionId: "connection",
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
        nodeStates: [{ nodeId, active: true, visible: true, opacity: 1, transform }],
        surfaceStates: [{ surfaceId, stateId: "reference-surface:default" }],
        variables: [],
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
  return {
    delivery,
    snapshot,
    fence,
    nodeId,
    surfaceId,
    transform,
  };
}

it("applies real Snapshot and State to the PNG scene and removes it on a reliable gap", async () => {
  const { delivery, snapshot, fence, nodeId, transform } = setup();
  const contentRoot = new Group();
  const host = {
    contentRoot,
    setPresentationOrigin: (value: import("three").Matrix4) => {
      contentRoot.matrix.copy(value);
    },
  };
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  let current: Awaited<ReturnType<typeof createPngPresentation>> | null = null;
  const clear = () => {
    current?.dispose();
    current = null;
  };
  const playback = createRuntimePlayback({
    delivery,
    present: async (view) => {
      if (current?.applyView(view)) return;
      const next = await createPngPresentation({
        host,
        delivery,
        view,
        loadTexture,
        residentCpuBytes: current?.retainedCpuBytes ?? 0,
      });
      current?.dispose();
      current = next;
    },
    clear,
  });
  expect(contentRoot.children).toHaveLength(0);
  playback.applyControl({ connectionSnapshot: snapshot });
  await playback.waitForIdle();
  const loads = loadTexture.mock.calls.length;
  expect(loads).toBe(3);
  playback.applyState({ connected: { connectionId: "connection", nextStateFrameSequence: "1" } });
  playback.applyState({
    stateFrame: {
      fence,
      frameSequence: "1",
      baseReliableSequence: "0",
      kind: 1,
      elements: [
        {
          elementId: nodeId,
          node: {
            active: true,
            visible: true,
            opacity: 0.25,
            transform: { ...transform, position: { x: 1, y: 0, z: -2 } },
          },
        },
      ],
    },
  });
  await playback.waitForIdle();
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  const mesh = contentRoot.getObjectByName(
    delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
  ) as Mesh;
  expect(mesh.material).toMatchObject({ opacity: 0.25 });
  expect(contentRoot.getObjectByName(nodeId)!.matrix.elements.slice(12, 15)).toEqual([1, 0, -2]);
  playback.applyState({
    stateFrame: {
      fence,
      frameSequence: "3",
      baseReliableSequence: "0",
      kind: 2,
      elements: [{ elementId: nodeId, node: { opacity: 0.9 } }],
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot()).toMatchObject({ phase: "ready", stateSync: "awaiting-keyframe" });
  expect(contentRoot.children.length).toBeGreaterThan(0);
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  expect(
    contentRoot.getObjectByName(
      delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
    ) as Mesh,
  ).toHaveProperty("material.opacity", 0.25);
  const retainedMesh = contentRoot.getObjectByName(
    delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
  );
  playback.restartState();
  expect(playback.getSnapshot()).toMatchObject({
    phase: "ready",
    rendering: "ready",
    stateSequence: "0",
    stateSync: "awaiting-keyframe",
  });
  expect(
    contentRoot.getObjectByName(delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!),
  ).toBe(retainedMesh);
  playback.applyState({ connected: { connectionId: "connection", nextStateFrameSequence: "1" } });
  await playback.waitForIdle();
  expect(
    contentRoot.getObjectByName(delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!),
  ).toBe(retainedMesh);

  playback.applyState({
    stateFrame: {
      fence,
      frameSequence: "1",
      baseReliableSequence: "0",
      kind: 1,
      elements: [
        { elementId: nodeId, node: { active: true, visible: true, opacity: 0.5, transform } },
      ],
    },
  });
  playback.applyState({
    stateFrame: {
      fence,
      frameSequence: "2",
      baseReliableSequence: "0",
      kind: 2,
      elements: [{ elementId: nodeId, node: { opacity: 0.75 } }],
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot()).toMatchObject({
    phase: "ready",
    rendering: "ready",
    stateSync: "ready",
    stateSequence: "2",
  });
  expect(
    contentRoot.getObjectByName(delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!),
  ).toHaveProperty("material.opacity", 0.75);
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "2",
      eventId: "gap",
      occurredAtRuntimeTimeMs: "1",
      logicalInputAccepted: { logicalEventName: "next" },
    },
  });
  expect(contentRoot.children).toHaveLength(0);
  expect(playback.getSnapshot().phase).toBe("resync-required");
  playback.reset();
  playback.applyControl({ connectionSnapshot: snapshot });
  await playback.waitForIdle();
  expect(playback.getSnapshot().rendering).toBe("ready");
  playback.dispose();
  expect(contentRoot.children).toHaveLength(0);
});

it("replaces Group-owned PNG resources only after the new Group and Step are complete", async () => {
  const { delivery, snapshot, fence, nodeId, surfaceId, transform } = setup();
  const profile = delivery.projectionProfile!;
  const catalog = profile.runtimeCatalog!;
  catalog.nodes![0]!.owner = { group: { groupId: "intro" } };
  catalog.surfaces![0]!.owner = { group: { groupId: "intro" } };
  const nextNodeId = "next-node";
  const nextSurfaceId = "next-surface";
  const nextNode = structuredClone(catalog.nodes![0]!);
  nextNode.nodeId = nextNodeId;
  nextNode.owner = { group: { groupId: "next" } };
  nextNode.surface = { semanticSurfaceId: nextSurfaceId };
  const nextSurface = structuredClone(catalog.surfaces![0]!);
  nextSurface.surfaceId = nextSurfaceId;
  nextSurface.hostNodeId = nextNodeId;
  nextSurface.owner = { group: { groupId: "next" } };
  catalog.nodes!.push(nextNode);
  catalog.surfaces!.push(nextSurface);
  const render = profile.renderSurfaces![0]!;
  const nextRender = JSON.parse(
    JSON.stringify(render)
      .replaceAll(render.renderSurfaceId!, "next-render")
      .replaceAll(surfaceId, nextSurfaceId),
  );
  profile.renderSurfaces!.push(nextRender);
  const contentRoot = new Group();
  const host = { contentRoot, setPresentationOrigin: vi.fn() };
  const resources: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const loadTexture = vi.fn(async () => {
    const resource = { texture: new Texture(), dispose: vi.fn() };
    resources.push(resource);
    return resource;
  });
  let current: Awaited<ReturnType<typeof createPngPresentation>> | null = null;
  const playback = createRuntimePlayback({
    delivery,
    clear() {
      current?.dispose();
      current = null;
    },
    async present(view) {
      if (current?.applyView(view)) return;
      const next = await createPngPresentation({
        host,
        delivery,
        view,
        loadTexture,
        residentCpuBytes: current?.retainedCpuBytes ?? 0,
      });
      current?.dispose();
      current = next;
    },
  });
  playback.applyControl({ connectionSnapshot: snapshot });
  await playback.waitForIdle();
  expect(playback.getSnapshot().rendering).toBe("ready");
  expect(contentRoot.getObjectByName(nodeId)).toBeDefined();
  expect(contentRoot.getObjectByName(nextNodeId)).toBeUndefined();
  const previousResources = resources.slice();
  let sequence = 0;
  function send(payload: object) {
    sequence++;
    playback.applyControl({
      reliableEvent: {
        fence,
        sequence: String(sequence),
        eventId: `group-event-${sequence}`,
        occurredAtRuntimeTimeMs: String(sequence),
        ...payload,
      },
    } as Parameters<typeof playback.applyControl>[0]);
  }
  send({ groupExited: { groupId: "intro", groupEntryEpoch: "1" } });
  expect(contentRoot.children).toHaveLength(0);
  for (const resource of previousResources) expect(resource.dispose).toHaveBeenCalledTimes(1);
  send({
    groupEntered: {
      groupId: "next",
      groupEntryEpoch: "2",
      initialization: {
        nodeStates: [{ nodeId: nextNodeId, active: true, visible: true, opacity: 1, transform }],
        surfaceStates: [{ surfaceId: nextSurfaceId, stateId: "reference-surface:default" }],
      },
    },
  });
  await playback.waitForIdle();
  expect(contentRoot.children).toHaveLength(0);
  send({
    stepEntered: {
      groupId: "next",
      groupEntryEpoch: "2",
      stepId: "start",
      stepEntryEpoch: "2",
      enteredAtRuntimeTimeMs: "3",
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot().rendering).toBe("ready");
  expect(contentRoot.getObjectByName(nodeId)).toBeUndefined();
  expect(contentRoot.getObjectByName(nextNodeId)).toBeDefined();
  expect(loadTexture.mock.calls.length).toBeGreaterThan(previousResources.length);
  playback.dispose();
  for (const resource of resources) expect(resource.dispose).toHaveBeenCalledTimes(1);
});

it("animates prepared PNG meshes from Timeline time, freezes on pause and commits completion", async () => {
  const { delivery, snapshot, fence } = setup();
  const timeline = delivery.projectionProfile!.runtimeCatalog!.timelines![0]!;
  timeline.tracks![0]!.keyframes![0]!.easingToNext = 1;
  for (const render of delivery.projectionProfile!.renderSurfaces!) {
    render.stateBindings = render.stateBindings!.map((binding) =>
      binding.stateId === "reference-surface:inactive"
        ? { stateId: binding.stateId, empty: {} }
        : binding,
    );
  }
  let now = 0;
  const host = { contentRoot: new Group(), setPresentationOrigin: vi.fn() };
  let current: Awaited<ReturnType<typeof createPngPresentation>> | null = null;
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const playback = createRuntimePlayback({
    delivery,
    now: () => now,
    clear() {
      current?.dispose();
      current = null;
    },
    async present(view) {
      if (current?.applyView(view)) return;
      const next = await createPngPresentation({ host, delivery, view, loadTexture });
      current?.dispose();
      current = next;
    },
    frame(view, time) {
      const sample = evaluateAnimationView(delivery, view, time);
      current?.applyAnimationFrame(sample.view, sample.surfaceTransitions);
    },
  });
  playback.applyControl({ connectionSnapshot: snapshot });
  await playback.waitForIdle();
  const loads = loadTexture.mock.calls.length;
  const runId = { assignmentEpoch: "1", runSequence: "1" };
  const started = {
    runId,
    timelineId: timeline.timelineId!,
    owner: { presentation: {} },
    cause: {
      cueId: "fade",
      causeEventId: "cause",
      groupId: "intro",
      groupEntryEpoch: "1",
      stepId: "start",
      stepEntryEpoch: "1",
    },
    completion: 2,
    startedAtRuntimeTimeMs: "10",
  };
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "1",
      eventId: "start",
      occurredAtRuntimeTimeMs: "10",
      timelineStarted: started,
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot().phase).toBe("ready");
  const renderId = delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!;
  const mesh = host.contentRoot.getObjectByName(renderId) as Mesh;
  expect(mesh).toBeDefined();
  now = 500;
  playback.prepareFrame();
  expect(mesh.material).toMatchObject({ opacity: 0.75 });
  expect(host.contentRoot.getObjectByName(renderId)).toBe(mesh);
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "2",
      eventId: "pause",
      occurredAtRuntimeTimeMs: "510",
      runtimeStatusChanged: { paused: { reason: 8 } },
    },
  });
  await playback.waitForIdle();
  now = 1500;
  playback.prepareFrame();
  expect((host.contentRoot.getObjectByName(renderId) as Mesh).material).toMatchObject({
    opacity: 0.75,
  });
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "3",
      eventId: "resume",
      occurredAtRuntimeTimeMs: "510",
      runtimeStatusChanged: { running: {} },
    },
  });
  await playback.waitForIdle();
  now = 2000;
  playback.prepareFrame();
  expect((host.contentRoot.getObjectByName(renderId) as Mesh).material).toMatchObject({
    opacity: 0.5,
  });
  expect(playback.getSnapshot().view!.activeRuns).toHaveLength(1);
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "4",
      eventId: "done",
      occurredAtRuntimeTimeMs: "1010",
      timelineCompleted: { runId, timelineId: timeline.timelineId! },
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot().view!.activeRuns).toHaveLength(0);
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  const surfaceId = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.surfaceId!;
  const fadeRunId = { assignmentEpoch: "1", runSequence: "2" };
  const fadeRun = {
    runId: fadeRunId,
    owner: started.owner,
    cause: started.cause,
    completion: 1,
    startedAtRuntimeTimeMs: "1010",
    surfaceTransition: {
      surfaceId,
      fromStateId: "reference-surface:default",
      toStateId: "reference-surface:inactive",
      durationMs: "1000",
      easing: 1,
    },
  };
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "5",
      eventId: "fade",
      occurredAtRuntimeTimeMs: "1010",
      surfaceTransitionStarted: {
        surfaceId,
        runId: fadeRunId,
        fromStateId: "reference-surface:default",
        stateId: "reference-surface:inactive",
        startedAtRuntimeTimeMs: "1010",
        durationMs: "1000",
        easing: 1,
        run: fadeRun,
      },
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot().phase).toBe("ready");
  now = 2500;
  playback.prepareFrame();
  const fadingMesh = host.contentRoot.getObjectByName(renderId) as Mesh;
  expect(fadingMesh.material).toMatchObject({
    uniforms: { progress: { value: 0.5 } },
  });
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "6",
      eventId: "fade-done",
      occurredAtRuntimeTimeMs: "2010",
      surfaceTransitionCompleted: {
        surfaceId,
        runId: fadeRunId,
        stateId: "reference-surface:inactive",
      },
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot().view!.activeRuns).toHaveLength(0);
  expect(host.contentRoot.getObjectByName(renderId)).toBeUndefined();
  playback.dispose();
});

it("keeps Viewer inputs disabled and applies variables without fetching PNG textures again", async () => {
  const { delivery, snapshot, fence } = setup();
  delivery.projectionProfile!.runtimeCatalog!.variables = [
    { variableId: "show-label", type: 3, owner: { presentation: {} } },
  ];
  delivery.projectionProfile!.visibleVariableIds = ["show-label"];
  snapshot.snapshot!.runtimeView!.variables = [
    { variableId: "show-label", value: { booleanValue: false } },
  ];
  const host = { contentRoot: new Group(), setPresentationOrigin: vi.fn() };
  let current: Awaited<ReturnType<typeof createPngPresentation>> | null = null;
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const playback = createRuntimePlayback({
    delivery,
    clear() {
      current?.dispose();
      current = null;
    },
    async present(view) {
      if (current?.applyView(view)) return;
      const next = await createPngPresentation({ host, delivery, view, loadTexture });
      current?.dispose();
      current = next;
    },
  });
  playback.applyControl({ connectionSnapshot: snapshot });
  await playback.waitForIdle();
  expect(playback.getSnapshot().view?.variables).toEqual({ "show-label": false });
  const loads = loadTexture.mock.calls.length;
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "1",
      eventId: "var",
      occurredAtRuntimeTimeMs: "1",
      variableChanged: { state: { variableId: "show-label", value: { booleanValue: true } } },
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot().view?.variables).toEqual({ "show-label": true });
  expect(playback.getSnapshot().view?.enabledLogicalInputs).toEqual([]);
  playback.applyControl({
    reliableEvent: {
      fence,
      sequence: "2",
      eventId: "input",
      occurredAtRuntimeTimeMs: "2",
      logicalInputAccepted: { logicalEventName: "next" },
    },
  });
  await playback.waitForIdle();
  expect(playback.getSnapshot().view?.enabledLogicalInputs).toEqual([]);
  expect(host.contentRoot.children.length).toBeGreaterThan(0);
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  playback.dispose();
});
