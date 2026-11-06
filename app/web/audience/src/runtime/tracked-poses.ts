import type { ProjectedTrackedPoseWire } from "@unframe-dev/contracts/presentation";
import { canonicalQuaternionSchema, parseWireUInt } from "./wire-validation";

export type TrackedPoses = Record<number, ProjectedTrackedPoseWire & { continuity?: string }>;
export type TimedTrackedPoses = Record<
  number,
  {
    pose: ProjectedTrackedPoseWire;
    sequence: number;
    continuity: string;
    revision: number;
    receivedAtMilliseconds: number;
    ageAtReceiptMilliseconds: number;
  }
>;

export function readTrackedPoses(poses: TimedTrackedPoses, now: number): TrackedPoses {
  return Object.fromEntries(
    Object.entries(poses).map(([target, entry]) => [
      target,
      entry.pose.sample &&
      entry.ageAtReceiptMilliseconds + Math.max(0, now - entry.receivedAtMilliseconds) > 500
        ? { target: Number(target), unavailable: {} }
        : { ...structuredClone(entry.pose), continuity: entry.continuity },
    ]),
  );
}

export function mergeTrackedPoses(
  targets: readonly number[],
  previous: TimedTrackedPoses,
  patches: readonly ProjectedTrackedPoseWire[],
  keyframe: boolean,
  timing: { producedAtMilliseconds: number; receivedAtMilliseconds: number },
  generation = 0,
): TimedTrackedPoses {
  const result: TimedTrackedPoses = keyframe ? {} : structuredClone(previous);
  if (keyframe && patches.length !== targets.length) throw new Error("Incomplete tracked poses");
  let lastTarget = 0;
  for (const patch of patches) {
    const target = patch.target ?? 0;
    if (
      !targets.includes(target) ||
      target <= lastTarget ||
      Number(!!patch.sample) + Number(!!patch.unavailable) !== 1
    )
      throw new Error("Invalid tracked pose");
    lastTarget = target;
    const old = previous[target];
    let sequence = old?.sequence ?? 0;
    let revision = old?.revision ?? 0;
    let ageAtReceiptMilliseconds = 0;
    let pose = patch;
    if (patch.sample) {
      const sample = patch.sample;
      const parsed = parseWireUInt(sample.trackingFrameSequence);
      const observed = parseWireUInt(sample.observedAtRuntimeMonotonicMs);
      const position = sample.position;
      const rotation = sample.rotation;
      if (
        !parsed.success ||
        !parsed.value ||
        !observed.success ||
        (!position && !rotation) ||
        (position && ![position.x ?? 0, position.y ?? 0, position.z ?? 0].every(Number.isFinite)) ||
        (rotation &&
          !canonicalQuaternionSchema.safeParse([
            rotation.x ?? 0,
            rotation.y ?? 0,
            rotation.z ?? 0,
            rotation.w ?? 0,
          ]).success)
      )
        throw new Error("Invalid tracked pose sample");
      if (old && parsed.value <= old.sequence) {
        result[target] = structuredClone(old);
        continue;
      }
      sequence = parsed.value;
      ageAtReceiptMilliseconds = timing.producedAtMilliseconds - observed.value;
      if (ageAtReceiptMilliseconds < 0 || ageAtReceiptMilliseconds > 500)
        pose = { target, unavailable: {} };
    }
    if (
      old?.pose.sample &&
      (!pose.sample ||
        (!!old.pose.sample.position && !pose.sample.position) ||
        (!!old.pose.sample.rotation && !pose.sample.rotation) ||
        old.ageAtReceiptMilliseconds +
          Math.max(0, timing.receivedAtMilliseconds - old.receivedAtMilliseconds) >
          500)
    )
      revision++;
    result[target] = {
      pose: structuredClone(pose),
      sequence,
      revision,
      continuity: `${generation}:${revision}`,
      ageAtReceiptMilliseconds,
      receivedAtMilliseconds: timing.receivedAtMilliseconds,
    };
  }
  return result;
}
