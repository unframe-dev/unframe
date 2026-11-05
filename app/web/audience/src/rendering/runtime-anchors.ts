import { Matrix4, Quaternion, Vector3, type Object3D } from "three";
import type {
  DeliveryManifestWire,
  ParticipantRuntimeView,
} from "@unframe-dev/contracts/presentation";
import type { AnchorBindings } from "../runtime/anchor-bindings";
import type { RuntimeHandPose } from "./runtime-effects";

export function applyRuntimeAnchors(
  root: Object3D,
  delivery: DeliveryManifestWire,
  view: ParticipantRuntimeView,
  bindings: AnchorBindings,
): RuntimeHandPose[] {
  const hands: RuntimeHandPose[] = [];
  for (const node of delivery.projectionProfile?.runtimeCatalog?.nodes ?? []) {
    const anchor = node.parent?.presenterAnchor;
    if (!anchor || !node.nodeId) continue;
    const state = view.nodeStates[node.nodeId];
    if (!state) continue;
    const binding = bindings[node.nodeId];
    const frozen =
      binding?.frozen ?? view.frozenAnchors.find((item) => item.nodeId === node.nodeId);
    const sample =
      binding?.sample ??
      (frozen
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
        : undefined);
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
    const origin = view.presentationOrigin.pose;
    anchorMatrix.premultiply(
      new Matrix4()
        .compose(
          new Vector3(...origin.position),
          new Quaternion(...origin.rotation),
          new Vector3(1, 1, 1),
        )
        .invert(),
    );
    for (const object of [
      root.getObjectByName(node.nodeId),
      root.getObjectByName(`model-node:${node.nodeId}`),
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
    if (available && binding?.sample?.position && (anchor.target === 2 || anchor.target === 3)) {
      hands.push({
        hand: anchor.target === 2 ? "left" : "right",
        sequence: Number(binding.sample.trackingFrameSequence ?? 0),
        position: [
          binding.sample.position.x ?? 0,
          binding.sample.position.y ?? 0,
          binding.sample.position.z ?? 0,
        ],
      });
    }
  }
  return hands;
}
