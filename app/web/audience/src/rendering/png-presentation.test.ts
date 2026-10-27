import { expect, it, vi } from "vitest";
import { Camera, Group, Mesh, Texture } from "three";
import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
} from "@unframe/contracts/presentation";
import deliveryFixture from "../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import runtimeFixture from "../../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
import { createPngPresentation } from "./png-presentation";
import * as pngPlan from "./png-plan";

function fixture() {
  const delivery = structuredClone(deliveryFixture.value) as DeliveryManifestWire;
  const view = structuredClone(runtimeFixture);
  const nodeId = delivery.projectionProfile!.runtimeCatalog!.nodes![0]!.nodeId!;
  const surfaceId = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.surfaceId!;
  view.projectionProfileId = delivery.projectionProfile!.projectionProfileId!;
  view.nodeStates = {
    [nodeId]: { ...structuredClone(runtimeFixture.nodeStates["node-baked"]), opacity: 1 },
  } as typeof view.nodeStates;
  view.surfaceStates = {
    [surfaceId]: { stateId: "reference-surface:default" },
  } as typeof view.surfaceStates;
  view.variables = {} as typeof view.variables;
  view.presentationOrigin.pose.position = [0.5, 1, -2];
  return { delivery, view };
}
it("attaches a complete PNG scene under presentation coordinates and releases owned GPU assets once", async () => {
  const { delivery, view } = fixture();
  const parent = new Group();
  const owned: { texture: Texture; dispose: ReturnType<typeof vi.fn> }[] = [];
  const loadTexture = vi.fn(async () => {
    const value = { texture: new Texture(), dispose: vi.fn() };
    owned.push(value);
    return value;
  });
  const scene = await createPngPresentation({
    host: { contentRoot: parent, setPresentationOrigin: (value) => parent.matrix.copy(value) },
    delivery,
    view,
    loadTexture,
  });
  expect(parent.children).toEqual([scene.root]);
  expect(parent.matrix.elements.slice(12, 15)).toEqual([0.5, 1, -2]);
  const meshes: Mesh[] = [];
  scene.root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  expect(meshes).toHaveLength(3);
  expect(meshes[1]!.renderOrder).toBe(1);
  expect(meshes[1]!.material).toMatchObject({
    opacity: 1,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  expect(meshes[0]!.geometry.getAttribute("uv").count).toBe(4);
  const geometryDispose = vi.spyOn(meshes[0]!.geometry, "dispose");
  scene.dispose();
  scene.dispose();
  expect(parent.children).toHaveLength(0);
  expect(geometryDispose).toHaveBeenCalledTimes(1);
  expect(owned.every((value) => value.dispose.mock.calls.length === 1)).toBe(true);
});
it("rolls back partial asset loading without exposing an incomplete scene", async () => {
  const { delivery, view } = fixture();
  const parent = new Group();
  const dispose = vi.fn();
  let calls = 0;
  await expect(
    createPngPresentation({
      host: { contentRoot: parent, setPresentationOrigin: (value) => parent.matrix.copy(value) },
      delivery,
      view,
      loadTexture: async () => {
        if (calls++) throw new Error("decode failed");
        return { texture: new Texture(), dispose };
      },
    }),
  ).rejects.toThrow();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(parent.children).toHaveLength(0);
});
it("cancels an unfinished scene without attaching or leaking a decoded texture", async () => {
  const { delivery, view } = fixture();
  const parent = new Group();
  const controller = new AbortController();
  const dispose = vi.fn();
  await expect(
    createPngPresentation({
      host: { contentRoot: parent, setPresentationOrigin: (value) => parent.matrix.copy(value) },
      delivery,
      view,
      signal: controller.signal,
      loadTexture: async () => {
        controller.abort();
        return { texture: new Texture(), dispose };
      },
    }),
  ).rejects.toThrow();
  expect(parent.children).toHaveLength(0);
  expect(dispose).toHaveBeenCalledTimes(1);
});

// Three.js uses the nearest Group's renderOrder before a mesh's renderOrder.
function transparentOrder(root: Group) {
  const entries: { name: string; groupOrder: number; renderOrder: number }[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) {
      entries.push({
        name: object.name,
        groupOrder: object.parent!.renderOrder,
        renderOrder: object.renderOrder,
      });
    }
  });
  return entries
    .sort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder)
    .map((entry) => entry.name);
}
it("sorts transparent surfaces by camera depth while keeping each surface's partition layers together", async () => {
  const { delivery, view } = fixture();
  const plan = pngPlan.buildPngPlan(delivery, view);
  const transform = plan.nodes[0]!.transform;
  plan.nodes = [
    { id: "parent", parentId: null, transform: { ...transform, position: [1, 0, -1] } },
    { id: "front", parentId: "parent", transform: { ...transform, position: [1, 0, -1] } },
    { id: "back", parentId: "parent", transform: { ...transform, position: [-1, 0, -4] } },
  ];
  const plane = plan.planes[0]!;
  plan.planes = [
    { ...plane, id: "front-base", nodeId: "front", layer: 0, alphaMode: "straight" },
    { ...plane, id: "front-overlay", nodeId: "front", layer: 2, alphaMode: "straight" },
    { ...plane, id: "back-overlay", nodeId: "back", layer: 1, alphaMode: "straight" },
    { ...plane, id: "back-base", nodeId: "back", layer: 0, alphaMode: "straight" },
  ];
  vi.spyOn(pngPlan, "buildPngPlan").mockReturnValueOnce(plan);
  const parent = new Group();
  parent.position.set(0, 0, -2);
  const scene = await createPngPresentation({
    host: { contentRoot: parent, setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture: async () => ({ texture: new Texture(), dispose: vi.fn() }),
  });
  const camera = new Camera();
  camera.updateMatrixWorld();
  scene.prepareRender(camera);
  expect(transparentOrder(scene.root)).toEqual([
    "back-base",
    "back-overlay",
    "front-base",
    "front-overlay",
  ]);
  const front = scene.root.getObjectByName("front-base")!;
  const back = scene.root.getObjectByName("back-base")!;
  expect(front.parent!.renderOrder).toBe(-4);
  expect(back.parent!.renderOrder).toBe(-7);
  camera.rotation.y = -Math.PI / 2;
  camera.updateMatrixWorld();
  scene.prepareRender(camera);
  expect(transparentOrder(scene.root)).toEqual([
    "front-base",
    "front-overlay",
    "back-base",
    "back-overlay",
  ]);
  parent.position.z = -3;
  camera.rotation.y = 0;
  camera.updateMatrixWorld();
  scene.prepareRender(camera);
  expect(front.parent!.renderOrder).toBe(-5);
  scene.dispose();
});

it("rejects replacement memory overflow before starting texture loads", async () => {
  const { delivery, view } = fixture();
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const contentRoot = new Group();
  const setPresentationOrigin = vi.fn();
  await expect(
    createPngPresentation({
      host: { contentRoot, setPresentationOrigin },
      delivery,
      view,
      loadTexture,
      residentCpuBytes: Number(delivery.capabilityProfile!.limits!.texture!.maxSerialLoadCpuBytes),
    }),
  ).rejects.toThrow();
  expect(loadTexture).not.toHaveBeenCalled();
  expect(setPresentationOrigin).not.toHaveBeenCalled();
  expect(contentRoot.children).toHaveLength(0);
});

it("applies runtime visibility, transforms, opacity and origin without loading textures again", async () => {
  const { delivery, view } = fixture();
  const parent = new Group();
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const scene = await createPngPresentation({
    host: { contentRoot: parent, setPresentationOrigin: (value) => parent.matrix.copy(value) },
    delivery,
    view,
    loadTexture,
  });
  const loads = loadTexture.mock.calls.length;
  const retained = scene.retainedCpuBytes;
  const nodeId = Object.keys(view.nodeStates)[0]! as keyof typeof view.nodeStates;
  const next = structuredClone(view);
  next.nodeStates[nodeId]!.transform.position = [1, 2, 3];
  next.nodeStates[nodeId]!.opacity = 0.25;
  next.presentationOrigin.pose.position = [-1, 0, 2];
  expect(scene.applyView(next)).toBe(true);
  expect(scene.root.getObjectByName(nodeId)!.matrix.elements.slice(12, 15)).toEqual([1, 2, 3]);
  const mesh = scene.root.getObjectByName(
    delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
  ) as Mesh;
  expect(mesh.material).toMatchObject({ opacity: 0.25 });
  expect(parent.matrix.elements.slice(12, 15)).toEqual([-1, 0, 2]);
  next.nodeStates[nodeId]!.visible = false;
  expect(scene.applyView(next)).toBe(true);
  expect(scene.root.getObjectByName(mesh.name)).toBeUndefined();
  next.nodeStates[nodeId]!.visible = true;
  expect(scene.applyView(next)).toBe(true);
  expect(scene.root.getObjectByName(mesh.name)).toBeDefined();
  next.nodeStates[nodeId]!.active = false;
  expect(scene.applyView(next)).toBe(true);
  expect(scene.root.getObjectByName(mesh.name)).toBeUndefined();
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  expect(scene.retainedCpuBytes).toBe(retained);
  scene.dispose();
});

it("leaves the current scene untouched when a newly visible asset has not been loaded", async () => {
  const { delivery, view } = fixture();
  const parent = new Group();
  const nodeId = Object.keys(view.nodeStates)[0]! as keyof typeof view.nodeStates;
  const hidden = structuredClone(view);
  hidden.nodeStates[nodeId]!.visible = false;
  const setPresentationOrigin = vi.fn();
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const scene = await createPngPresentation({
    host: { contentRoot: parent, setPresentationOrigin },
    delivery,
    view: hidden,
    loadTexture,
  });
  const children = [...scene.root.children];
  expect(scene.applyView(view)).toBe(false);
  expect(scene.root.children).toEqual(children);
  expect(setPresentationOrigin).toHaveBeenCalledTimes(1);
  expect(loadTexture).not.toHaveBeenCalled();
  expect(scene.retainedCpuBytes).toBe(0);
  scene.dispose();
});

it("keeps loaded textures usable after their signed URL expires and rejects invalid updates atomically", async () => {
  const { delivery, view } = fixture();
  const parent = new Group();
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const scene = await createPngPresentation({
    host: { contentRoot: parent, setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture,
  });
  const loads = loadTexture.mock.calls.length;
  for (const asset of delivery.assetAccess!) {
    asset.url = "https://example.test/refreshed.png";
    asset.expiresAtUnixMs = "1";
  }
  expect(scene.applyView(view)).toBe(true);
  const children = [...scene.root.children];
  expect(() => scene.applyView({})).toThrow();
  const invalid = structuredClone(view);
  invalid.projectionProfileId = "another-profile";
  expect(() => scene.applyView(invalid)).toThrow(/projection mismatch/);
  expect(scene.root.children).toEqual(children);
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  scene.dispose();
  expect(scene.applyView(view)).toBe(false);
});

it("releases replaced meshes and retains textures until presentation disposal", async () => {
  const { delivery, view } = fixture();
  const textureDispose = vi.fn();
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture: async () => ({ texture: new Texture(), dispose: textureDispose }),
  });
  const old = scene.root.getObjectByName(
    delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
  ) as Mesh;
  const disposeGeometry = vi.spyOn(old.geometry, "dispose");
  const disposeMaterial = vi.spyOn(old.material as import("three").Material, "dispose");
  expect(scene.applyView(view)).toBe(true);
  expect(disposeGeometry).toHaveBeenCalledTimes(1);
  expect(disposeMaterial).toHaveBeenCalledTimes(1);
  expect(textureDispose).not.toHaveBeenCalled();
  scene.dispose();
  scene.dispose();
  expect(textureDispose).toHaveBeenCalledTimes(3);
});

it("updates plane geometry and UVs for a changed plan without replacing decoded textures", async () => {
  const { delivery, view } = fixture();
  const plan = pngPlan.buildPngPlan(delivery, view);
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture,
  });
  const loads = loadTexture.mock.calls.length;
  plan.planes[0] = { ...plan.planes[0]!, width: 2, height: 3, uv: [0.25, 0.125, 0.75, 0.875] };
  vi.spyOn(pngPlan, "buildPngPlan").mockReturnValueOnce(plan);
  expect(scene.applyView(view)).toBe(true);
  const mesh = scene.root.getObjectByName(plan.planes[0]!.id) as Mesh;
  mesh.geometry.computeBoundingBox();
  expect(mesh.geometry.boundingBox!.max.toArray()).toEqual([1, 1.5, 0]);
  const uv = mesh.geometry.getAttribute("uv");
  expect([uv.getX(0), uv.getY(0), uv.getX(3), uv.getY(3)]).toEqual([0.25, 0.875, 0.75, 0.125]);
  expect(loadTexture).toHaveBeenCalledTimes(loads);
  scene.dispose();
});

it("rejects unsupported playback runs and conflicting loaded metadata before mutating the scene", async () => {
  const { delivery, view } = fixture();
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture: async () => ({ texture: new Texture(), dispose: vi.fn() }),
  });
  const children = [...scene.root.children];
  const plan = pngPlan.buildPngPlan(delivery, view);
  plan.assets[0]!.pixelSize = [1, 1];
  vi.spyOn(pngPlan, "buildPngPlan").mockReturnValueOnce(plan);
  expect(() => scene.applyView(view)).toThrow(/conflicting loaded texture metadata/);
  const active = {
    ...structuredClone(view),
    activeRuns: [
      {
        kind: "media",
        surfaceId: "surface-1",
        playback: { kind: "paused", positionMilliseconds: 0 },
        completion: "blocking",
        runId: { assignmentEpoch: 1, runSequence: 1 },
        owner: { kind: "presentation" },
        cause: {
          cueId: "cue-1",
          causeEventId: "event-1",
          groupId: "group-1",
          groupEntryEpoch: 1,
          stepId: "step-1",
          stepEntryEpoch: 1,
        },
        startedAtRuntimeTimeMilliseconds: 0,
      },
    ],
  };
  expect(() => scene.applyView(active)).toThrow(/active runs/);
  expect(scene.root.children).toEqual(children);
  scene.dispose();
});

it("releases the exited Group's meshes and unused textures when the next Group reuses a loaded PNG", async () => {
  const { delivery, view } = fixture();
  const catalog = delivery.projectionProfile!.runtimeCatalog!;
  const node = catalog.nodes![0]!;
  const surface = catalog.surfaces![0]!;
  if (!node.surface) throw new Error("Expected surface fixture");
  node.owner = { group: { groupId: "intro" } };
  surface.owner = { group: { groupId: "intro" } };
  catalog.nodes!.push({
    ...structuredClone(node),
    nodeId: "next-node",
    owner: { group: { groupId: "next" } },
    surface: { semanticSurfaceId: "next-surface" },
  });
  catalog.surfaces!.push({
    ...structuredClone(surface),
    surfaceId: "next-surface",
    hostNodeId: "next-node",
    owner: { group: { groupId: "next" } },
  });
  const render = structuredClone(delivery.projectionProfile!.renderSurfaces![0]!);
  render.renderSurfaceId = "next-render";
  render.semanticSurfaceId = "next-surface";
  delivery.projectionProfile!.renderSurfaces!.push(render);
  const owned: ReturnType<typeof vi.fn>[] = [];
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture: async () => {
      const dispose = vi.fn();
      owned.push(dispose);
      return { texture: new Texture(), dispose };
    },
  });
  const oldMesh = scene.root.getObjectByName(
    delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
  ) as Mesh;
  const oldGeometryDispose = vi.spyOn(oldMesh.geometry, "dispose");
  const next = structuredClone(view);
  next.progression.currentGroupId = "next";
  next.progression.groupEntryEpoch++;
  next.nodeStates = {
    "next-node": next.nodeStates[node.nodeId! as keyof typeof next.nodeStates]!,
  } as unknown as typeof next.nodeStates;
  next.surfaceStates = {
    "next-surface": next.surfaceStates[surface.surfaceId! as keyof typeof next.surfaceStates]!,
  } as unknown as typeof next.surfaceStates;
  expect(scene.applyView(next)).toBe(true);
  expect(scene.root.getObjectByName(node.nodeId!)).toBeUndefined();
  expect(scene.root.getObjectByName("next-render")).toBeDefined();
  expect(oldGeometryDispose).toHaveBeenCalledOnce();
  expect(owned[0]).not.toHaveBeenCalled();
  expect(owned[1]).toHaveBeenCalledOnce();
  expect(owned[2]).toHaveBeenCalledOnce();
  const texture = render.artifacts![0]!.bakedWeb!.states![0]!.texture!;
  expect(scene.retainedCpuBytes).toBe(
    Number(texture.pixelSize!.width) * Number(texture.pixelSize!.height) * 4,
  );
  const nextChildren = [...scene.root.children];
  expect(scene.applyView(view)).toBe(false);
  expect(scene.root.children).toEqual(nextChildren);
  scene.dispose();
  expect(owned.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
});

it("applies animation frames without replacing meshes, geometry, or textures", async () => {
  const { delivery, view: input } = fixture();
  const view = participantRuntimeViewSchema.parse(input);
  view.activeRuns = [
    {
      kind: "timeline",
      timelineId: "timeline",
      completion: "nonBlocking",
      runId: { assignmentEpoch: 1, runSequence: 1 },
      owner: { kind: "presentation" },
      cause: {
        cueId: "cue",
        causeEventId: "event",
        groupId: "intro",
        groupEntryEpoch: 1,
        stepId: "first",
        stepEntryEpoch: 1,
      },
      startedAtRuntimeTimeMilliseconds: 0,
    },
  ];
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture,
  });
  const nodeId = delivery.projectionProfile!.runtimeCatalog!.nodes![0]!.nodeId!;
  const mesh = scene.root.getObjectByName(
    delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
  ) as Mesh;
  const geometry = mesh.geometry;
  const next = structuredClone(view);
  const state = next.nodeStates[nodeId as keyof typeof next.nodeStates]!;
  state.opacity = 0.3;
  state.transform.position = [2, 3, 4];
  expect(scene.applyAnimationFrame(participantRuntimeViewSchema.parse(next), {})).toBe(true);
  expect(scene.root.getObjectByName(mesh.name)).toBe(mesh);
  expect(mesh.geometry).toBe(geometry);
  expect(mesh.material).toMatchObject({ opacity: 0.3 });
  expect(scene.root.getObjectByName(nodeId)!.matrix.elements.slice(12, 15)).toEqual([2, 3, 4]);
  expect(loadTexture).toHaveBeenCalledTimes(3);
  scene.dispose();
  expect(scene.applyAnimationFrame(participantRuntimeViewSchema.parse(next), {})).toBe(false);
});

function transitionFixture() {
  const value = fixture();
  Object.values(value.view.nodeStates)[0]!.opacity = 0.5;
  const surfaceId = value.delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.surfaceId!;
  const { delivery, view } = value;
  const nextState = "next-state";
  delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.reachableStateIds!.push(nextState);
  const source = structuredClone(
    delivery.assetAccess!.find(
      (asset) =>
        asset.assetId ===
        delivery.projectionProfile!.renderSurfaces![0]!.artifacts![0]!.bakedWeb!.states![0]!
          .texture!.assetId,
    )!,
  );
  source.assetId = "transition-target";
  source.checksum = `sha256:${"a".repeat(64)}`;
  delivery.assetAccess!.push(source);
  for (const render of delivery.projectionProfile!.renderSurfaces!) {
    const artifact = render.artifacts![0]!.bakedWeb!;
    render.stateBindings!.push({
      stateId: nextState,
      artifact: { artifactId: artifact.artifactId! },
    });
    artifact.states!.push({
      stateId: nextState,
      texture: {
        ...structuredClone(
          delivery.projectionProfile!.renderSurfaces![0]!.artifacts![0]!.bakedWeb!.states![0]!
            .texture!,
        ),
        assetId: source.assetId,
        checksum: source.checksum,
      },
    });
  }
  const run = {
    kind: "surfaceTransition" as const,
    surfaceId,
    fromStateId: "reference-surface:default",
    toStateId: nextState,
    durationMilliseconds: 1000,
    completion: "blocking" as const,
    easing: "linear" as const,
    runId: { assignmentEpoch: 1, runSequence: 1 },
    owner: { kind: "presentation" as const },
    cause: {
      cueId: "cue",
      causeEventId: "event",
      groupId: "intro",
      groupEntryEpoch: 1,
      stepId: "first",
      stepEntryEpoch: 1,
    },
    startedAtRuntimeTimeMilliseconds: 0,
  };
  return {
    ...value,
    view: {
      ...view,
      surfaceStates: { [surfaceId]: { stateId: run.toStateId, transitionRunId: run.runId } },
      activeRuns: [run],
    },
  };
}
it("composites each complete Surface before mixing endpoints and releases assets exactly once", async () => {
  const { delivery, view } = transitionFixture();
  const dispose = vi.fn();
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose }));
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture,
  });
  const meshes: Mesh[] = [];
  scene.root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  expect(meshes).toHaveLength(1);
  expect(loadTexture).toHaveBeenCalledTimes(4);
  const surfaceId = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.surfaceId!;
  const transition = view.activeRuns[0]!;
  expect(
    scene.applyAnimationFrame(participantRuntimeViewSchema.parse(view), {
      [surfaceId]: {
        fromStateId: transition.fromStateId,
        toStateId: transition.toStateId,
        progress: 0.5,
      },
    }),
  ).toBe(true);
  expect(meshes[0]!.material).toMatchObject({
    isShaderMaterial: true,
    premultipliedAlpha: true,
    uniforms: {
      progress: { value: 0.5 },
      opacity: { value: 0.5 },
    },
  });
  const shader = meshes[0]!.material as import("three").ShaderMaterial;
  expect(shader.fragmentShader).toContain("vec4 mixed = mix(fromComposite, toComposite, progress)");
  expect(shader.fragmentShader).toContain("fromComposite = over(");
  expect(shader.fragmentShader).toContain("toComposite = over(");
  expect(Object.keys(shader.uniforms).filter((key) => key.startsWith("image"))).toHaveLength(4);
  scene.dispose();
  scene.dispose();
  expect(dispose).toHaveBeenCalledTimes(4);
});

it("fades to an empty binding and retires the old endpoint after completion", async () => {
  const { delivery, view } = transitionFixture();
  const target = view.activeRuns[0]!.toStateId;
  for (const render of delivery.projectionProfile!.renderSurfaces!) {
    render.stateBindings = render.stateBindings!.map((binding) =>
      binding.stateId === target ? { stateId: target, empty: {} } : binding,
    );
  }
  const dispose = vi.fn();
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture: async () => ({ texture: new Texture(), dispose }),
  });
  const mesh = scene.root.getObjectByName(
    delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
  ) as Mesh;
  const shader = mesh.material as import("three").ShaderMaterial;
  expect(shader.fragmentShader).toContain("vec4 toComposite = vec4(0.0)");
  expect(shader.fragmentShader).not.toContain("toComposite = over(");
  const completed = participantRuntimeViewSchema.parse(view);
  completed.activeRuns = [];
  const surfaceId = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.surfaceId!;
  delete completed.surfaceStates[surfaceId]!.transitionRunId;
  expect(scene.applyView(completed)).toBe(true);
  expect(scene.root.getObjectByName(mesh.name)).toBeUndefined();
  expect(dispose).toHaveBeenCalledTimes(3);
  expect(scene.retainedCpuBytes).toBe(0);
  scene.dispose();
  expect(dispose).toHaveBeenCalledTimes(3);
});

it("keeps hidden Timeline resources resident so visibility can change without loading or rebuilding", async () => {
  const { delivery, view } = fixture();
  const nodeId = delivery.projectionProfile!.runtimeCatalog!.nodes![0]!.nodeId!;
  view.nodeStates[nodeId as keyof typeof view.nodeStates]!.visible = false;
  const animated = participantRuntimeViewSchema.parse(view);
  animated.activeRuns = [
    {
      kind: "timeline",
      timelineId: "timeline",
      completion: "nonBlocking",
      runId: { assignmentEpoch: 1, runSequence: 1 },
      owner: { kind: "presentation" },
      cause: {
        cueId: "cue",
        causeEventId: "event",
        groupId: "intro",
        groupEntryEpoch: 1,
        stepId: "first",
        stepEntryEpoch: 1,
      },
      startedAtRuntimeTimeMilliseconds: 0,
    },
  ];
  const loadTexture = vi.fn(async () => ({ texture: new Texture(), dispose: vi.fn() }));
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view: animated,
    loadTexture,
  });
  const mesh = scene.root.getObjectByName(
    delivery.projectionProfile!.renderSurfaces![0]!.renderSurfaceId!,
  ) as Mesh;
  expect(mesh.material).toMatchObject({ opacity: 0 });
  animated.nodeStates[nodeId]!.visible = true;
  expect(scene.applyAnimationFrame(animated, {})).toBe(true);
  expect(scene.root.getObjectByName(mesh.name)).toBe(mesh);
  expect(mesh.visible).toBe(true);
  expect(mesh.material).toMatchObject({ opacity: 1 });
  expect(loadTexture).toHaveBeenCalledTimes(3);
  scene.dispose();
});
it("rejects a mismatched crossfade frame before changing any material or transform", async () => {
  const { delivery, view } = transitionFixture();
  const setPresentationOrigin = vi.fn();
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin },
    delivery,
    view,
    loadTexture: async () => ({ texture: new Texture(), dispose: vi.fn() }),
  });
  const before = scene.root.children.map((child) => child.matrix.clone());
  const next = participantRuntimeViewSchema.parse(view);
  Object.values(next.nodeStates)[0]!.transform.position = [99, 99, 99];
  const surfaceId = delivery.projectionProfile!.runtimeCatalog!.surfaces![0]!.surfaceId!;
  expect(
    scene.applyAnimationFrame(next, {
      [surfaceId]: { fromStateId: "wrong", toStateId: "wrong", progress: 0.5 },
    }),
  ).toBe(false);
  expect(setPresentationOrigin).toHaveBeenCalledTimes(1);
  expect(scene.root.children.map((child) => child.matrix)).toEqual(before);
  scene.dispose();
});

it("uses the union of partition bounds and their independent clipped UVs for a Surface crossfade", async () => {
  const { delivery, view } = transitionFixture();
  const plan = pngPlan.buildPngPlan(delivery, view);
  plan.planes[0] = {
    ...plan.planes[0]!,
    width: 2,
    height: 3,
    x: -1,
    y: 2,
    uv: [0.25, 0.125, 0.75, 0.875],
  };
  vi.spyOn(pngPlan, "buildPngPlan").mockReturnValueOnce(plan);
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture: async () => ({ texture: new Texture(), dispose: vi.fn() }),
  });
  const mesh = scene.root.getObjectByName(plan.planes[0]!.id) as Mesh;
  mesh.geometry.computeBoundingBox();
  const minX = Math.min(...plan.planes.map((plane) => plane.x - plane.width / 2));
  const maxX = Math.max(...plan.planes.map((plane) => plane.x + plane.width / 2));
  expect(mesh.position.x).toBe((minX + maxX) / 2);
  expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo((maxX - minX) / 2);
  const shader = mesh.material as import("three").ShaderMaterial;
  expect(shader.fragmentShader).toContain("vec4(0.25, 0.125, 0.75, 0.875)");
  expect(shader.fragmentShader).toContain("vec4(-2.0, 0.5, 2.0, 3.0)");
  scene.dispose();
});

it("composes the old background and the new background plus foreground before their crossfade", async () => {
  const { delivery, view } = transitionFixture();
  const renders = delivery.projectionProfile!.renderSurfaces!;
  renders.splice(2);
  renders[0]!.layer = 0;
  renders[1]!.layer = 1;
  renders[1]!.logicalBounds = structuredClone(renders[0]!.logicalBounds!);
  const fromState = view.activeRuns[0]!.fromStateId;
  renders[1]!.stateBindings = renders[1]!.stateBindings!.map((binding) =>
    binding.stateId === fromState ? { stateId: fromState, empty: {} } : binding,
  );
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture: async () => ({ texture: new Texture(), dispose: vi.fn() }),
  });
  const mesh = scene.root.getObjectByName(renders[0]!.renderSurfaceId!) as Mesh;
  const shader = mesh.material as import("three").ShaderMaterial;
  const source = shader.fragmentShader;
  expect(source.match(/fromComposite = over\(/g)).toHaveLength(1);
  expect(source.match(/toComposite = over\(/g)).toHaveLength(2);
  expect(source.lastIndexOf("toComposite = over(")).toBeLessThan(
    source.indexOf("vec4 mixed = mix(fromComposite, toComposite, progress)"),
  );
  expect(source).toContain("return front + back * (1.0 - front.a)");
  expect(source.match(/mix\(fromComposite, toComposite, progress\)/g)).toHaveLength(1);
  scene.dispose();
});

it("applies static Surface opacity after composing all overlapping partitions", async () => {
  const { delivery, view } = fixture();
  Object.values(view.nodeStates)[0]!.opacity = 0.5;
  const scene = await createPngPresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery,
    view,
    loadTexture: async () => ({ texture: new Texture(), dispose: vi.fn() }),
  });
  const meshes: Mesh[] = [];
  scene.root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  expect(meshes).toHaveLength(1);
  const shader = meshes[0]!.material as import("three").ShaderMaterial;
  expect(shader.opacity).toBe(0.5);
  expect(shader.uniforms.opacity!.value).toBe(0.5);
  expect(shader.fragmentShader.match(/fromComposite = over\(/g)).toHaveLength(3);
  expect(shader.fragmentShader.lastIndexOf("fromComposite = over(")).toBeLessThan(
    shader.fragmentShader.indexOf("mixed.a * opacity"),
  );
  scene.dispose();
});
