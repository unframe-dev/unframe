import type { PresentationDefinition } from "@unframe/contracts/presentation";

import { canonicalizeQuaternion } from "../validation/shared.js";

type Timeline = PresentationDefinition["flow"]["timelines"][string];
type Track = Timeline["tracks"][number];
type Value = Track["keyframes"][number]["value"];
type Vector = [number, number, number];
type Quaternion = [number, number, number, number];

const copyValue = (value: Value): Value =>
  typeof value === "number" ? value : ([...value] as Value);

const ease = (kind: NonNullable<Track["keyframes"][number]["easingToNext"]>, u: number) => {
  switch (kind) {
    case "linear":
      return u;
    case "cubicIn":
      return u ** 3;
    case "cubicOut":
      return 1 - (1 - u) ** 3;
    case "cubicInOut":
      return u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
  }
};

const normalize = (value: Quaternion): Quaternion => {
  const length = Math.hypot(...value);
  if (length === 0 || !Number.isFinite(length))
    throw new RangeError("Invalid Timeline Quaternion.");
  return value.map((component) => component / length) as Quaternion;
};

const interpolateRotation = (fromValue: Quaternion, toValue: Quaternion, fraction: number) => {
  const from = normalize(fromValue);
  let to = normalize(toValue);
  let dot = from.reduce((sum, component, index) => sum + component * to[index]!, 0);
  if (dot < 0) {
    to = to.map((component) => -component) as Quaternion;
    dot = -dot;
  }
  if (dot > 0.9995)
    return canonicalizeQuaternion(
      from.map((component, index) => component + (to[index]! - component) * fraction) as Quaternion,
    );

  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const fromWeight = Math.sin((1 - fraction) * theta) / sinTheta;
  const toWeight = Math.sin(fraction * theta) / sinTheta;
  return canonicalizeQuaternion(
    from.map((component, index) => component * fromWeight + to[index]! * toWeight) as Quaternion,
  );
};

export const evaluateTimelineTrack = (
  track: Track,
  durationMilliseconds: number,
  elapsedMilliseconds: number,
): Value => {
  if (!Number.isFinite(elapsedMilliseconds))
    throw new RangeError("Timeline elapsed time must be finite.");
  const keyframes = track.keyframes;
  if (elapsedMilliseconds <= 0) return copyValue(keyframes[0]!.value);
  if (elapsedMilliseconds >= durationMilliseconds)
    return copyValue(keyframes[keyframes.length - 1]!.value);

  const endIndex = keyframes.findIndex(
    (keyframe) => keyframe.timeMilliseconds > elapsedMilliseconds,
  );
  const from = keyframes[endIndex - 1]!;
  const to = keyframes[endIndex]!;
  const u =
    (elapsedMilliseconds - from.timeMilliseconds) / (to.timeMilliseconds - from.timeMilliseconds);
  const fraction = ease(from.easingToNext!, u);
  if (track.target.property === "transform.rotation")
    return interpolateRotation(from.value as Quaternion, to.value as Quaternion, fraction);
  if (track.target.property === "opacity")
    return (from.value as number) + ((to.value as number) - (from.value as number)) * fraction;
  const start = from.value as Vector;
  const finish = to.value as Vector;
  return start.map(
    (component, index) => component + (finish[index]! - component) * fraction,
  ) as Vector;
};
