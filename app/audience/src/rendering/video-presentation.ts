import {
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
} from "three";
import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
} from "@unframe/contracts/presentation";
import { loadVideoAsset } from "../assets/video-asset";
import { buildVideoPlan, type VideoPlan } from "./video-plan";

type LoadedVideo = Awaited<ReturnType<typeof loadVideoAsset>>;
export async function createVideoPresentation(options: {
  host: { contentRoot: Group; setPresentationOrigin(value: Matrix4): void };
  delivery: DeliveryManifestWire;
  view: unknown;
  signal?: AbortSignal;
  loadAsset?: typeof loadVideoAsset;
  attachRoot?: boolean;
  playbackEnabled?: boolean;
}) {
  let view = participantRuntimeViewSchema.parse(options.view);
  let plan = buildVideoPlan(options.delivery, view);
  const root = new Group();
  root.name = "video-presentation-stage";
  const loaded = new Map<string, LoadedVideo>();
  const metadata = new Map(plan.assets.map((a) => [a.assetId, a]));
  const nodeGroups = new Map<string, Group>();
  let meshes: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  let disposed = false,
    playbackEnabled = options.playbackEnabled ?? true;
  let time = view.clock.runtimeTimeMilliseconds;
  const disposeMeshes = () => {
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    meshes = [];
    root.clear();
    nodeGroups.clear();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    disposeMeshes();
    for (const asset of loaded.values()) asset.dispose();
    loaded.clear();
    metadata.clear();
  };
  const setTransform = (
    group: Group,
    transform: ParticipantRuntimeView["nodeStates"][string]["transform"],
  ) => {
    group.matrixAutoUpdate = false;
    group.matrix.compose(
      new Vector3(...transform.position),
      new Quaternion(...transform.rotation),
      new Vector3(...transform.scale),
    );
    group.matrixWorldNeedsUpdate = true;
  };
  function frame(nextView: ParticipantRuntimeView, runtimeTimeMilliseconds: number) {
    if (disposed) return;
    view = nextView;
    time = runtimeTimeMilliseconds;
    const pose = view.presentationOrigin.pose;
    options.host.setPresentationOrigin(
      new Matrix4().compose(
        new Vector3(...pose.position),
        new Quaternion(...pose.rotation),
        new Vector3(1, 1, 1),
      ),
    );
    const visibility = new Map<string, { visible: boolean; opacity: number }>();
    for (const node of plan.nodes) {
      const state = view.nodeStates[node.id];
      if (!state) throw new Error("Video node state missing");
      setTransform(nodeGroups.get(node.id)!, state.transform);
      const parent = node.parentId ? visibility.get(node.parentId)! : { visible: true, opacity: 1 };
      visibility.set(node.id, {
        visible: parent.visible && state.active && state.visible,
        opacity: parent.opacity * state.opacity,
      });
    }
    for (let i = 0; i < plan.planes.length; i++) {
      const plane = plan.planes[i]!,
        mesh = meshes[i]!;
      const visible = visibility.get(plane.nodeId)!;
      let opacity = visible.visible ? visible.opacity : 0;
      if (plane.transition) {
        const run = view.activeRuns.find(
          (r) => r.kind === "surfaceTransition" && r.surfaceId === plane.surfaceId,
        );
        if (run?.kind === "surfaceTransition") {
          let t = Math.min(
            1,
            Math.max(
              0,
              (runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds) /
                run.durationMilliseconds,
            ),
          );
          if (run.easing === "cubicIn") t = t * t * t;
          else if (run.easing === "cubicOut") t = 1 - (1 - t) ** 3;
          else if (run.easing === "cubicInOut")
            t = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
          opacity *= plane.transition.phase === "to" ? t : 1 - t;
        }
      }
      mesh.material.opacity = opacity;
      mesh.visible = opacity > 0;
    }
    for (const asset of plan.assets) {
      const plane = plan.planes.find((p) => p.assetId === asset.assetId)!;
      const state = view.mediaStates[plane.surfaceId];
      if (!state) {
        loaded.get(asset.assetId)!.synchronize(0, false);
        for (let i = 0; i < plan.planes.length; i++)
          if (plan.planes[i]!.assetId === asset.assetId) meshes[i]!.visible = false;
        continue;
      }
      let position = 0,
        playing = false;
      if (state.kind === "stopped") position = state.heldPositionMilliseconds;
      else if (state.playback.kind === "paused") position = state.playback.positionMilliseconds;
      else {
        position =
          state.playback.positionAtReferenceMilliseconds +
          Math.max(0, runtimeTimeMilliseconds - state.playback.referenceRuntimeTimeMilliseconds);
        playing = view.clock.lifecycle.kind === "running";
      }
      loaded.get(asset.assetId)!.synchronize(position / 1000, playing && playbackEnabled);
    }
  }
  function commit(next: VideoPlan, nextView: ParticipantRuntimeView) {
    disposeMeshes();
    plan = next;
    for (const node of next.nodes) {
      const group = new Group();
      group.name = node.id;
      setTransform(group, node.transform);
      nodeGroups.set(node.id, group);
      (node.parentId ? nodeGroups.get(node.parentId)! : root).add(group);
    }
    for (const plane of next.planes) {
      const geometry = new PlaneGeometry(plane.width, plane.height),
        uv = geometry.attributes.uv!;
      for (let i = 0; i < uv.count; i++)
        uv.setXY(
          i,
          plane.uv[0] + uv.getX(i) * (plane.uv[2] - plane.uv[0]),
          plane.uv[1] + uv.getY(i) * (plane.uv[3] - plane.uv[1]),
        );
      const material = new MeshBasicMaterial({
        map: loaded.get(plane.assetId)!.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        opacity: plane.opacity,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(plane.x, plane.y, 0);
      mesh.renderOrder = plane.layer;
      nodeGroups.get(plane.nodeId)!.add(mesh);
      meshes.push(mesh);
    }
    const required = new Set(next.assets.map((a) => a.assetId));
    for (const [id, asset] of loaded)
      if (!required.has(id)) {
        asset.dispose();
        loaded.delete(id);
        metadata.delete(id);
      }
    frame(nextView, nextView.clock.runtimeTimeMilliseconds);
  }
  try {
    for (const asset of plan.assets) {
      if (options.signal?.aborted) throw new Error("Video presentation cancelled");
      loaded.set(
        asset.assetId,
        await (options.loadAsset ?? loadVideoAsset)(
          asset,
          options.signal ? { signal: options.signal } : {},
        ),
      );
    }
    if (options.signal?.aborted) throw new Error("Video presentation cancelled");
    commit(plan, view);
    if (options.attachRoot !== false) options.host.contentRoot.add(root);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    root,
    get retainedCpuBytes() {
      return [...metadata.values()].reduce(
        (n, a) => n + a.encodedSizeBytes + a.pixelSize[0] * a.pixelSize[1] * 4,
        0,
      );
    },
    get playbackBlocked() {
      return [...loaded.values()].some((a) => a.playbackBlocked);
    },
    getLoadedAssets(): ReadonlyMap<string, LoadedVideo> {
      return loaded;
    },
    applyView(input: unknown) {
      if (disposed) return false;
      const nextView = participantRuntimeViewSchema.parse(input),
        next = buildVideoPlan(options.delivery, nextView);
      if (
        next.assets.some((a) => {
          const previous = metadata.get(a.assetId);
          return !previous || JSON.stringify(previous) !== JSON.stringify(a);
        })
      )
        return false;
      commit(next, nextView);
      return true;
    },
    applyAnimationFrame(input: ParticipantRuntimeView, runtimeTimeMilliseconds: number) {
      frame(input, runtimeTimeMilliseconds);
    },
    prepareRender(camera: Camera) {
      for (const mesh of meshes) {
        mesh.updateWorldMatrix(true, false);
        mesh.renderOrder = new Vector3()
          .setFromMatrixPosition(mesh.matrixWorld)
          .applyMatrix4(camera.matrixWorldInverse).z;
      }
    },
    setPlaybackEnabled(enabled: boolean) {
      playbackEnabled = enabled;
      frame(view, time);
    },
    async resumePlayback() {
      await Promise.all([...loaded.values()].map((a) => a.resumePlayback()));
    },
    dispose,
  };
}
