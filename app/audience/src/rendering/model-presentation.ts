import {
  AnimationMixer,
  AnimationClip,
  HemisphereLight,
  DirectionalLight,
  Group,
  Material,
  Matrix4,
  Mesh,
  SkinnedMesh,
  Quaternion,
  Vector3,
  type AnimationAction,
  type Camera,
} from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
} from "@unframe/contracts/presentation";
import { loadModelAsset } from "../assets/model-asset";
import { buildModelPlan, type ModelPlan } from "./model-plan";
type Loaded = Awaited<ReturnType<typeof loadModelAsset>>;
export async function createModelPresentation(options: {
  host: { contentRoot: Group; setPresentationOrigin(value: Matrix4): void };
  delivery: DeliveryManifestWire;
  view: unknown;
  signal?: AbortSignal;
  loadAsset?: typeof loadModelAsset;
  reservedTextureResources?: { gpuBytes: number; bindings: number; cpuBytes: number };
}) {
  let current = participantRuntimeViewSchema.parse(options.view),
    plan = buildModelPlan(options.delivery, current),
    disposed = false;
  const root = new Group();
  root.name = "model-presentation-stage";
  const fill = new HemisphereLight(0xffffff, 0x888888, 2);
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(2, 3, 4);
  root.add(fill, key);
  const assetMetadata = new Map(plan.assets.map((asset) => [asset.assetId, asset]));
  const loaded = new Map<string, Loaded>(),
    instances = new Map<
      string,
      {
        assetId: string;
        root: Group;
        mixer: AnimationMixer;
        actions: Map<string, AnimationAction>;
        materials: {
          material: Material;
          opacity: number;
          transparent: boolean;
          depthWrite: boolean;
        }[];
      }
    >();
  const reserved = options.reservedTextureResources ?? { gpuBytes: 0, bindings: 0, cpuBytes: 0 };
  if (Object.values(reserved).some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new Error("Model presentation: invalid reserved resources");
  const limits = options.delivery.capabilityProfile?.limits?.texture;
  function usage() {
    return [...loaded].reduce(
      (sum, [id, asset]) => ({
        gpuBytes: sum.gpuBytes + (asset.textureGpuBytes ?? 0),
        bindings: sum.bindings + (asset.textureBindings ?? 0),
        cpuBytes:
          sum.cpuBytes + (asset.retainedCpuBytes ?? assetMetadata.get(id)?.encodedSizeBytes ?? 0),
      }),
      { gpuBytes: 0, bindings: 0, cpuBytes: 0 },
    );
  }
  function assertBudget() {
    if (!limits) return;
    const resources = usage();
    if (
      resources.gpuBytes + reserved.gpuBytes > Number(limits.maxGpuBytes) ||
      resources.bindings + reserved.bindings > Number(limits.maxTextureBindings) ||
      resources.cpuBytes + reserved.cpuBytes > Number(limits.maxSerialLoadCpuBytes)
    )
      throw new Error("Model presentation: aggregate resource budget exceeded");
  }
  const groups = new Map<string, Group>();
  const abort = () => {
    if (options.signal?.aborted) throw new Error("Model presentation cancelled");
  };
  function disposeInstance(i: typeof instances extends Map<string, infer V> ? V : never) {
    i.mixer.stopAllAction();
    i.mixer.uncacheRoot(i.root);
    i.root.traverse((object) => {
      if (object instanceof SkinnedMesh) object.skeleton.dispose();
    });
    for (const m of i.materials) m.material.dispose();
    i.root.removeFromParent();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const i of instances.values()) disposeInstance(i);
    for (const a of loaded.values()) a.dispose();
    instances.clear();
    loaded.clear();
    root.clear();
  }
  function applyPlan(next: ModelPlan, view: ParticipantRuntimeView) {
    for (const node of next.nodes) {
      let group = groups.get(node.id);
      if (!group) {
        group = new Group();
        group.name = `model-node:${node.id}`;
        groups.set(node.id, group);
      }
      group.position.fromArray(node.transform.position);
      group.quaternion.fromArray(node.transform.rotation);
      group.scale.fromArray(node.transform.scale);
      if (node.parentId === null) root.add(group);
      else groups.get(node.parentId)!.add(group);
    }
    for (const instance of next.instances) {
      const item = instances.get(instance.nodeId)!;
      groups.get(instance.nodeId)!.add(item.root);
      item.root.visible = instance.visible && instance.opacity > 0;
      for (const m of item.materials) {
        const transparent = m.transparent || instance.opacity < 1;
        if (m.material.transparent !== transparent) {
          m.material.transparent = transparent;
          m.material.needsUpdate = true;
        }
        m.material.opacity = m.opacity * instance.opacity;
        m.material.depthWrite = m.depthWrite && instance.opacity === 1;
      }
    }
    for (const [id, group] of groups)
      if (!next.nodes.some((n) => n.id === id)) group.removeFromParent();
    const pose = view.presentationOrigin.pose;
    options.host.setPresentationOrigin(
      new Matrix4().compose(
        new Vector3().fromArray(pose.position),
        new Quaternion().fromArray(pose.rotation),
        new Vector3(1, 1, 1),
      ),
    );
    current = view;
    plan = next;
  }
  const position = (
    clock:
      | {
          kind: "playing";
          positionAtReferenceMilliseconds: number;
          referenceRuntimeTimeMilliseconds: number;
        }
      | { kind: "paused"; positionMilliseconds: number },
    time: number,
    speed = 1,
  ) =>
    clock.kind === "paused"
      ? clock.positionMilliseconds
      : clock.positionAtReferenceMilliseconds +
        Math.max(0, time - clock.referenceRuntimeTimeMilliseconds) * speed;
  const ease = (t: number, easing: string) =>
    easing === "cubicIn"
      ? t * t * t
      : easing === "cubicOut"
        ? 1 - (1 - t) ** 3
        : easing === "cubicInOut"
          ? t < 0.5
            ? 4 * t * t * t
            : 1 - (-2 * t + 2) ** 3 / 2
          : t;
  function animate(view: ParticipantRuntimeView, time: number) {
    for (const [nodeId, instance] of instances) {
      instance.mixer.stopAllAction();
      const state = view.modelClipStates[nodeId];
      const sample = (
        clipId: string,
        milliseconds: number,
        weight: number,
        loop: boolean,
        slot = 0,
      ) => {
        const definition = plan.clips.find((c) => c.nodeId === nodeId && c.clipId === clipId);
        const action = instance.actions.get(`${clipId}:${slot}`);
        if (!definition || !action) throw new Error("Model presentation: missing animation clip");
        const duration = definition.durationMilliseconds;
        const sampled = loop ? milliseconds % duration : Math.min(milliseconds, duration);
        action.reset();
        action.enabled = true;
        action.play();
        action.setEffectiveWeight(weight);
        action.paused = true;
        action.time = sampled / 1000;
      };
      if (state?.kind === "heldClip")
        sample(state.clip.clipId, state.clip.positionMilliseconds, 1, false);
      else if (state?.kind === "heldBlend") {
        sample(state.from.clipId, state.from.positionMilliseconds, 1 - state.toWeight, false);
        sample(state.to.clipId, state.to.positionMilliseconds, state.toWeight, false, 1);
      } else if (state?.kind === "active") {
        const run = view.activeRuns.find(
          (r) =>
            r.kind === "modelClip" &&
            r.modelNodeId === nodeId &&
            r.runId.assignmentEpoch === state.runId.assignmentEpoch &&
            r.runId.runSequence === state.runId.runSequence,
        );
        if (!run || run.kind !== "modelClip")
          throw new Error("Model presentation: missing animation run");
        if (run.phase.kind === "single") {
          const clip = run.phase.clip;
          sample(clip.clipId, position(clip.playback, time, clip.speed), 1, clip.loop);
        } else {
          const t = run.phase.transition;
          const weight = ease(
            Math.min(1, position(t.transitionClock, time) / t.durationMilliseconds),
            t.easing,
          );
          sample(
            t.from.clipId,
            position(t.from.playback, time, t.from.speed),
            1 - weight,
            t.from.loop,
          );
          sample(t.to.clipId, position(t.to.playback, time, t.to.speed), weight, t.to.loop, 1);
        }
      }
      instance.mixer.update(0);
    }
  }
  function applyView(input: unknown) {
    if (disposed) return false;
    const view = participantRuntimeViewSchema.parse(input),
      next = buildModelPlan(options.delivery, view);
    if (
      next.assets.some((asset) => !loaded.has(asset.assetId)) ||
      next.instances.some((i) => instances.get(i.nodeId)?.assetId !== i.assetId)
    )
      return false;
    applyPlan(next, view);
    animate(view, view.clock.runtimeTimeMilliseconds);
    for (const [id, item] of instances)
      if (!next.instances.some((instance) => instance.nodeId === id)) {
        disposeInstance(item);
        instances.delete(id);
      }
    for (const [id, asset] of loaded)
      if (!next.assets.some((item) => item.assetId === id)) {
        asset.dispose();
        loaded.delete(id);
      }
    return true;
  }
  try {
    for (const asset of plan.assets) {
      abort();
      const used = usage();
      const budget = asset.textureBudget
        ? {
            ...asset.textureBudget,
            maxGpuBytes: asset.textureBudget.maxGpuBytes - reserved.gpuBytes - used.gpuBytes,
            maxBindings: asset.textureBudget.maxBindings - reserved.bindings - used.bindings,
            maxCpuBytes: asset.textureBudget.maxCpuBytes - reserved.cpuBytes - used.cpuBytes,
          }
        : undefined;
      if (
        budget &&
        (budget.maxGpuBytes < 0 ||
          budget.maxBindings < 0 ||
          budget.maxCpuBytes < asset.encodedSizeBytes)
      )
        throw new Error("Model presentation: aggregate resource budget exceeded");
      const item = await (options.loadAsset ?? loadModelAsset)(
        budget ? { ...asset, textureBudget: budget } : asset,
        options.signal ? { signal: options.signal } : {},
      );
      loaded.set(asset.assetId, item);
      abort();
      assertBudget();
    }
    for (const item of plan.instances) {
      const asset = loaded.get(item.assetId)!;
      const scene = clone(asset.scene) as Group;
      const materials: {
        material: Material;
        opacity: number;
        transparent: boolean;
        depthWrite: boolean;
      }[] = [];
      scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const cloned = (Array.isArray(object.material) ? object.material : [object.material]).map(
          (material) => {
            const copy = material.clone();
            materials.push({
              material: copy,
              opacity: copy.opacity,
              transparent: copy.transparent,
              depthWrite: copy.depthWrite,
            });
            return copy;
          },
        );
        object.material = Array.isArray(object.material) ? cloned : cloned[0]!;
      });
      const mixer = new AnimationMixer(scene),
        actions = new Map<string, AnimationAction>();
      instances.set(item.nodeId, { assetId: item.assetId, root: scene, mixer, actions, materials });
      for (const clip of plan.clips.filter((c) => c.nodeId === item.nodeId)) {
        const source = asset.animations[clip.sourceAnimationIndex];
        if (!source || Math.abs(source.duration * 1000 - clip.durationMilliseconds) > 1)
          throw new Error("Model presentation: animation metadata mismatch");
        actions.set(
          `${clip.clipId}:0`,
          mixer.clipAction(
            new AnimationClip(source.name, source.duration, source.tracks, source.blendMode),
          ),
        );
        actions.set(
          `${clip.clipId}:1`,
          mixer.clipAction(
            new AnimationClip(source.name, source.duration, source.tracks, source.blendMode),
          ),
        );
      }
    }
    applyPlan(plan, current);
    animate(current, current.clock.runtimeTimeMilliseconds);
    options.host.contentRoot.add(root);
    abort();
    return {
      root,
      get retainedCpuBytes() {
        return disposed ? 0 : usage().cpuBytes;
      },
      get resourceUsage() {
        return disposed ? { gpuBytes: 0, bindings: 0, cpuBytes: 0 } : usage();
      },
      dispose,
      applyView,
      prepareRender(_camera: Camera) {},
      applyAnimationFrame(input: unknown, time: number) {
        if (disposed) return;
        const view = participantRuntimeViewSchema.parse(input);
        if (!Number.isFinite(time) || time < 0) throw new Error("Model presentation: invalid time");
        applyPlan(buildModelPlan(options.delivery, view), view);
        animate(view, time);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
