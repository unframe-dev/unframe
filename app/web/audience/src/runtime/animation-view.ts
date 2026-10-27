import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
  type ProjectedTimelineTrackWire,
  type TimelineKeyframeWire,
} from "@unframe/contracts/presentation";
import { Quaternion } from "three";

export interface SurfaceTransitionSample {
  fromStateId: string;
  toStateId: string;
  progress: number;
}
export type SurfaceTransitionSamples = Readonly<Record<string, SurfaceTransitionSample>>;
const fail = (): never => {
  throw new Error("Runtime animation: invalid animation resources");
};
function uint(text: string | undefined): number {
  text ??= "0";
  if (!/^(0|[1-9]\d*)$/.test(text)) return fail();
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : fail();
}
function ease(kind: number | undefined, u: number): number {
  switch (kind) {
    case 1:
      return u;
    case 2:
      return u ** 3;
    case 3:
      return 1 - (1 - u) ** 3;
    case 4:
      return u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
    default:
      return fail();
  }
}
type Value = number | [number, number, number] | [number, number, number, number];
function keyValue(key: TimelineKeyframeWire, property: number): Value {
  if ([key.number, key.vector3, key.quaternion].filter((v) => v !== undefined).length !== 1)
    return fail();
  let value: Value;
  if (property === 1 && key.number) value = key.number.value ?? 0;
  else if ((property === 2 || property === 4) && key.vector3?.value) {
    const v = key.vector3.value;
    value = [v.x ?? 0, v.y ?? 0, v.z ?? 0];
  } else if (property === 3 && key.quaternion?.value) {
    const q = key.quaternion.value;
    value = [q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 0];
    if (
      Math.abs(Math.hypot(...value) - 1) > 1e-9 ||
      (value[3] === 0 ? (value.slice(0, 3).find((v) => v !== 0) ?? 0) < 0 : value[3] < 0)
    )
      return fail();
  } else return fail();
  const numbers = typeof value === "number" ? [value] : value;
  if (
    !numbers.every(Number.isFinite) ||
    (property === 1 && (numbers[0]! < 0 || numbers[0]! > 1)) ||
    (property === 4 && numbers.some((v) => v <= 0))
  )
    return fail();
  return value;
}
function sampleTrack(track: ProjectedTimelineTrackWire, duration: number, elapsed: number): Value {
  const property = track.target?.property ?? fail();
  const keys = track.keyframes ?? [];
  if (keys.length < 2 || uint(keys[0]!.timeMs) !== 0 || uint(keys.at(-1)!.timeMs) !== duration)
    return fail();
  const values = keys.map((key) => keyValue(key, property));
  const times = keys.map((key) => uint(key.timeMs));
  for (let i = 1; i < keys.length; i++) {
    if (times[i]! <= times[i - 1]!) return fail();
    ease(keys[i - 1]!.easingToNext, 0);
  }
  if (keys.at(-1)!.easingToNext !== undefined) return fail();
  if (elapsed <= 0) return values[0]!;
  if (elapsed >= duration) return values.at(-1)!;
  const end = times.findIndex((time) => time > elapsed);
  const start = end - 1;
  const u = ease(
    keys[start]!.easingToNext,
    (elapsed - times[start]!) / (times[end]! - times[start]!),
  );
  const from = values[start]!;
  const to = values[end]!;
  if (typeof from === "number") return from + ((to as number) - from) * u;
  if (property === 3) {
    const q = new Quaternion(...(from as [number, number, number, number]))
      .slerp(new Quaternion(...(to as [number, number, number, number])), u)
      .normalize();
    const result = q.toArray() as [number, number, number, number];
    const sign =
      result[3] === 0 ? (result.slice(0, 3).find((v) => v !== 0) ?? 0) < 0 : result[3] < 0;
    return sign ? (result.map((v) => -v) as typeof result) : result;
  }
  return from.map((v, i) => v + ((to as number[])[i]! - v) * u) as [number, number, number];
}

export function evaluateAnimationView(
  delivery: DeliveryManifestWire,
  input: ParticipantRuntimeView,
  runtimeTimeMilliseconds: number,
): { view: ParticipantRuntimeView; surfaceTransitions: SurfaceTransitionSamples } {
  if (!Number.isFinite(runtimeTimeMilliseconds) || runtimeTimeMilliseconds < 0) return fail();
  const view = participantRuntimeViewSchema.parse(input);
  const transitions = new Map<string, SurfaceTransitionSample>();
  const claims = new Set<string>();
  for (const run of view.activeRuns) {
    const elapsed = runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds;
    if (run.kind === "timeline") {
      const timelines =
        delivery.projectionProfile?.runtimeCatalog?.timelines?.filter(
          (t) => t.timelineId === run.timelineId,
        ) ?? [];
      if (timelines.length !== 1) return fail();
      const timeline = timelines[0]!;
      const duration = uint(timeline.durationMs);
      if (duration === 0 || !timeline.tracks?.length) return fail();
      for (const track of timeline.tracks) {
        const nodeId = track.target?.nodeId ?? fail();
        const node = view.nodeStates[nodeId] ?? fail();
        const property = track.target?.property ?? fail();
        const claim = `${nodeId}:${property}`;
        if (claims.has(claim)) return fail();
        claims.add(claim);
        const value = sampleTrack(track, duration, elapsed);
        if (property === 1) node.opacity = value as number;
        else if (property === 2) node.transform.position = value as [number, number, number];
        else if (property === 3)
          node.transform.rotation = value as [number, number, number, number];
        else if (property === 4) node.transform.scale = value as [number, number, number];
        else return fail();
      }
    } else if (run.kind === "surfaceTransition") {
      if (transitions.has(run.surfaceId)) return fail();
      const easing = ["linear", "cubicIn", "cubicOut", "cubicInOut"].indexOf(run.easing) + 1;
      transitions.set(run.surfaceId, {
        fromStateId: run.fromStateId,
        toStateId: run.toStateId,
        progress: ease(easing, Math.max(0, Math.min(1, elapsed / run.durationMilliseconds))),
      });
    } else if (run.kind !== "media" && run.kind !== "modelClip") return fail();
  }
  return { view, surfaceTransitions: Object.fromEntries(transitions) };
}
