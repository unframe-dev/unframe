import type {
  DeliveryManifestWire,
  ProjectedAnchorBindingPatchWire,
} from "@unframe-dev/contracts/presentation";
import { canonicalQuaternionSchema, parseWireUInt } from "./wire-validation";

export type AnchorBindings = Record<string, ProjectedAnchorBindingPatchWire>;
export type TimedAnchorBindings = Record<
  string,
  {
    binding: ProjectedAnchorBindingPatchWire;
    receivedAtMilliseconds: number;
    ageAtReceiptMilliseconds: number;
  }
>;

export function readAnchorBindings(bindings: TimedAnchorBindings, now: number): AnchorBindings {
  return Object.fromEntries(
    Object.entries(bindings).map(([id, entry]) => [
      id,
      entry.binding.sample &&
      entry.ageAtReceiptMilliseconds + Math.max(0, now - entry.receivedAtMilliseconds) > 500
        ? { nodeId: id, unavailable: {} }
        : structuredClone(entry.binding),
    ]),
  );
}

export function mergeAnchorBindings(
  delivery: DeliveryManifestWire,
  previous: TimedAnchorBindings,
  patches: readonly ProjectedAnchorBindingPatchWire[],
  keyframe: boolean,
  timing: { producedAtMilliseconds: number; receivedAtMilliseconds: number },
): TimedAnchorBindings {
  const result: TimedAnchorBindings = keyframe ? {} : structuredClone(previous);
  const seen = new Set<string>();
  for (const patch of patches) {
    const nodeId = patch.nodeId;
    const anchor = delivery.projectionProfile?.runtimeCatalog?.nodes?.find(
      (node) => node.nodeId === nodeId,
    )?.parent?.presenterAnchor;
    if (
      !nodeId ||
      !anchor ||
      seen.has(nodeId) ||
      Number(!!patch.sample) + Number(!!patch.unavailable) + Number(!!patch.frozen) !== 1
    )
      throw new Error("Invalid anchor binding");
    seen.add(nodeId);
    if (patch.frozen) {
      const frozen = patch.frozen;
      if (
        frozen.nodeId !== nodeId ||
        (!frozen.position && !frozen.rotation) ||
        (frozen.position &&
          ![frozen.position.x ?? 0, frozen.position.y ?? 0, frozen.position.z ?? 0].every(
            Number.isFinite,
          )) ||
        (frozen.rotation &&
          !canonicalQuaternionSchema.safeParse([
            frozen.rotation.x ?? 0,
            frozen.rotation.y ?? 0,
            frozen.rotation.z ?? 0,
            frozen.rotation.w ?? 0,
          ]).success)
      )
        throw new Error("Invalid frozen anchor");
    }
    let ageAtReceiptMilliseconds = 0;
    if (patch.sample) {
      const sample = patch.sample;
      const sequence = parseWireUInt(sample.trackingFrameSequence);
      const observed = parseWireUInt(sample.observedAtRuntimeMonotonicMs);
      const position = sample.position;
      const rotation = sample.rotation;
      if (
        !sequence.success ||
        !sequence.value ||
        !observed.success ||
        (anchor.followPosition && !position) ||
        (anchor.followRotation && !rotation) ||
        (position && ![position.x ?? 0, position.y ?? 0, position.z ?? 0].every(Number.isFinite)) ||
        (rotation &&
          !canonicalQuaternionSchema.safeParse([
            rotation.x ?? 0,
            rotation.y ?? 0,
            rotation.z ?? 0,
            rotation.w ?? 0,
          ]).success)
      )
        throw new Error("Invalid anchor sample");
      const old = previous[nodeId]?.binding.sample;
      const oldSequence = old && parseWireUInt(old.trackingFrameSequence);
      if (oldSequence?.success && sequence.value <= oldSequence.value) {
        result[nodeId] = structuredClone(previous[nodeId]!);
        continue;
      }
      ageAtReceiptMilliseconds = timing.producedAtMilliseconds - observed.value;
      if (ageAtReceiptMilliseconds < 0 || ageAtReceiptMilliseconds > 500) {
        result[nodeId] = {
          binding: { nodeId, unavailable: {} },
          receivedAtMilliseconds: timing.receivedAtMilliseconds,
          ageAtReceiptMilliseconds: 0,
        };
        continue;
      }
    }
    result[nodeId] = {
      binding: structuredClone(patch),
      receivedAtMilliseconds: timing.receivedAtMilliseconds,
      ageAtReceiptMilliseconds,
    };
  }
  return result;
}
