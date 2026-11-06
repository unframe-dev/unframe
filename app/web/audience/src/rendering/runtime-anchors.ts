import { Matrix4, Quaternion, Vector3, type Object3D } from "three";
import type {
  DeliveryManifestWire,
  ParticipantRuntimeView,
} from "@unframe-dev/contracts/presentation";
import type { TrackedPoses } from "../runtime/tracked-poses";
import type { RuntimeHandPose } from "./runtime-effects";

export function applyRuntimeAnchors(
  root: Object3D,
  delivery: DeliveryManifestWire,
  view: ParticipantRuntimeView,
  poses: TrackedPoses,
): void {
  for (const node of delivery.projectionProfile?.runtimeCatalog?.nodes ?? []) {
    const anchor = node.parent?.presenterAnchor;
    if (!anchor || !node.nodeId) continue;
    const state = view.nodeStates[node.nodeId];
    if (!state) continue;
    const frozen = view.frozenAnchors.find((item) => item.nodeId === node.nodeId);
    const sample = frozen
      ? {
          position:
            frozen.position &&
            (Array.isArray(frozen.position)
              ? { x: frozen.position[0], y: frozen.position[1], z: frozen.position[2] }
              : frozen.position),
          rotation:
            frozen.rotation &&
            (Array.isArray(frozen.rotation)
              ? {
                  x: frozen.rotation[0],
                  y: frozen.rotation[1],
                  z: frozen.rotation[2],
                  w: frozen.rotation[3],
                }
              : frozen.rotation),
        }
      : poses[anchor.target ?? 0]?.sample;
    const available =
      !!sample &&
      (!anchor.followPosition || !!sample.position) &&
      (!anchor.followRotation || !!sample.rotation);
    const anchorMatrix = new Matrix4().compose(
      new Vector3(
        anchor.followPosition ? (sample?.position?.x ?? 0) : 0,
        anchor.followPosition ? (sample?.position?.y ?? 0) : 0,
        anchor.followPosition ? (sample?.position?.z ?? 0) : 0,
      ),
      anchor.followRotation
        ? new Quaternion(
            sample?.rotation?.x ?? 0,
            sample?.rotation?.y ?? 0,
            sample?.rotation?.z ?? 0,
            sample?.rotation?.w ?? 1,
          )
        : new Quaternion(),
      new Vector3(1, 1, 1),
    );
    for (const object of [
      root.getObjectByName(node.nodeId),
      root.getObjectByName(`model-node:${node.nodeId}`),
      root.getObjectByName(`spatial-node:${node.nodeId}`),
    ]) {
      if (!object) continue;
      object.visible = available && state.active && state.visible;
      object.matrix
        .copy(anchorMatrix)
        .multiply(
          new Matrix4().compose(
            new Vector3(...state.transform.position),
            new Quaternion(...state.transform.rotation),
            new Vector3(...state.transform.scale),
          ),
        );
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      object.matrixWorldNeedsUpdate = true;
    }
  }
}

export function runtimeHandPoses(poses: TrackedPoses): RuntimeHandPose[] {
  return [2, 3].flatMap((target) => {
    const sample = poses[target]?.sample;
    if (sample?.position) {
      return [
        {
          hand: target === 2 ? ("left" as const) : ("right" as const),
          sequence: Number(sample.trackingFrameSequence ?? 0),
          ...(poses[target]?.continuity === undefined
            ? {}
            : { continuity: poses[target].continuity }),
          position: [
            sample.position.x ?? 0,
            sample.position.y ?? 0,
            sample.position.z ?? 0,
          ] as const,
        },
      ];
    }
    return [];
  });
}
