import {
  participantRuntimeViewSchema,
  type ParticipantRuntimeView,
  type ParticipantRuntimeViewWire,
  type QuaternionWire,
  type RuntimeRunSnapshotWire,
  type RuntimeRunIdWire,
  type ScalarValueWire,
  type Vector3Wire,
} from "@unframe/contracts/presentation";

function fail(message: string): never {
  throw new Error(`Participant runtime view: ${message}`);
}
function required<T>(value: T | undefined, name: string): T {
  return value ?? fail(`missing ${name}`);
}
function uint(value: string | undefined): number {
  const text = value ?? "0";
  if (typeof text !== "string" || !/^(0|[1-9]\d*)$/.test(text)) fail("invalid unsigned integer");
  const number = Number(text);
  if (!Number.isSafeInteger(number)) fail("unsafe unsigned integer");
  return number;
}
function vector(value: Vector3Wire | undefined): [number, number, number] {
  const v = required(value, "vector");
  return [v.x ?? 0, v.y ?? 0, v.z ?? 0];
}
function rotation(value: QuaternionWire | undefined): [number, number, number, number] {
  const q = required(value, "rotation");
  const result: [number, number, number, number] = [q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 0];
  if (
    !result.every(Number.isFinite) ||
    Math.abs(Math.hypot(...result) - 1) > 1e-9 ||
    (result[3] === 0 ? (result.slice(0, 3).find((v) => v !== 0) ?? 0) < 0 : result[3] < 0)
  )
    fail("non-canonical rotation");
  return result;
}
function record<T, R>(
  items: T[] | undefined,
  key: (item: T) => string,
  convert: (item: T) => R,
): Record<string, R> {
  const entries = new Map<string, R>();
  for (const item of items ?? []) {
    const id = key(item);
    if (entries.has(id)) fail("duplicate resource identity");
    entries.set(id, convert(item));
  }
  return Object.fromEntries(entries);
}
function oneOf(value: object, names: string[]): string {
  const selected = names.filter((name) => (value as Record<string, unknown>)[name] !== undefined);
  if (selected.length !== 1) fail("exactly one variant is required");
  return selected[0]!;
}
function scalar(value: ScalarValueWire | undefined) {
  const entry = required(value, "variable value");
  switch (oneOf(entry, ["nullValue", "booleanValue", "numberValue", "stringValue"])) {
    case "nullValue":
      return null;
    case "booleanValue":
      return entry.booleanValue;
    case "numberValue":
      return entry.numberValue;
    default:
      return entry.stringValue;
  }
}
const pauseReasons = [
  "presenter-disconnected",
  "assignment-lease-expired",
  "process-recovered",
  "invariant-violation",
  "atomic-commit-failed",
  "microstep-limit-exceeded",
  "recovery-gap",
  "explicit-pause",
];
const terminationReasons = ["explicit-end", "control-plane-ended", "pause-timeout"];
function reason(value: number | undefined, names: string[]): string {
  if (!Number.isInteger(value) || value === undefined || value < 1 || value > names.length)
    fail("unknown lifecycle reason");
  return names[value - 1]!;
}

function runId(value: RuntimeRunIdWire | undefined) {
  const id = required(value, "run identity");
  return { assignmentEpoch: uint(id.assignmentEpoch), runSequence: uint(id.runSequence) };
}
type MediaWire = NonNullable<RuntimeRunSnapshotWire["media"]>;
type ClipWire = NonNullable<NonNullable<RuntimeRunSnapshotWire["modelClip"]>["single"]>;
function playback(value: MediaWire["playback"]) {
  const clock = required(value, "playback clock");
  return oneOf(clock, ["playing", "paused"]) === "playing"
    ? {
        kind: "playing",
        positionAtReferenceMilliseconds: clock.playing!.positionAtReferenceMs ?? 0,
        referenceRuntimeTimeMilliseconds: uint(clock.playing!.referenceRuntimeTimeMs),
      }
    : { kind: "paused", positionMilliseconds: clock.paused!.positionMs ?? 0 };
}
function clip(value: ClipWire | undefined) {
  const entry = required(value, "clip playback");
  return {
    clipId: entry.clipId,
    playback: playback(entry.playback),
    speed: entry.speed ?? 0,
    loop: entry.loop ?? false,
  };
}
function held(value: { clipId?: string; positionMs?: number } | undefined) {
  const entry = required(value, "held clip");
  return { clipId: entry.clipId, positionMilliseconds: entry.positionMs ?? 0 };
}
function blend(
  value:
    | {
        from?: { clipId?: string; positionMs?: number };
        to?: { clipId?: string; positionMs?: number };
        toWeight?: number;
      }
    | undefined,
) {
  const entry = required(value, "held blend");
  return { from: held(entry.from), to: held(entry.to), toWeight: entry.toWeight ?? 0 };
}
function runtimeRun(value: RuntimeRunSnapshotWire) {
  const kind = oneOf(value, ["timeline", "surfaceTransition", "media", "modelClip"]);

  const owner = required(value.owner, "run owner");
  const ownerKind = oneOf(owner, ["presentation", "group"]);
  const cause = required(value.cause, "run cause");
  const base = {
    runId: runId(value.runId),
    owner:
      ownerKind === "presentation"
        ? { kind: "presentation" }
        : {
            kind: "group",
            groupId: owner.group!.groupId,
            groupEntryEpoch: uint(owner.group!.groupEntryEpoch),
          },
    cause: {
      cueId: cause.cueId,
      causeEventId: cause.causeEventId,
      groupId: cause.groupId,
      groupEntryEpoch: uint(cause.groupEntryEpoch),
      stepId: cause.stepId,
      stepEntryEpoch: uint(cause.stepEntryEpoch),
    },
    startedAtRuntimeTimeMilliseconds: uint(value.startedAtRuntimeTimeMs),
    completion: reason(value.completion, ["blocking", "nonBlocking"]),
  };
  if (kind === "media")
    return {
      ...base,
      kind,
      surfaceId: value.media!.surfaceId,
      playback: playback(value.media!.playback),
    };
  if (kind === "modelClip") {
    const entry = value.modelClip!;
    const phase = oneOf(entry, ["single", "crossfade"]);
    const transition = entry.crossfade;
    return {
      ...base,
      kind,
      modelNodeId: entry.modelNodeId,
      phase:
        phase === "single"
          ? { kind: "single", clip: clip(entry.single) }
          : {
              kind: "crossfade",
              transition: {
                from: clip(transition!.from),
                to: clip(transition!.to),
                transitionClock: playback(transition!.transitionClock),
                durationMilliseconds: uint(transition!.durationMs),
                easing: reason(transition!.easing, ["linear", "cubicIn", "cubicOut", "cubicInOut"]),
                fromIsHeld: transition!.fromIsHeld ?? false,
              },
            },
    };
  }
  return kind === "timeline"
    ? { ...base, kind, timelineId: value.timeline!.timelineId }
    : {
        ...base,
        kind,
        surfaceId: value.surfaceTransition!.surfaceId,
        fromStateId: value.surfaceTransition!.fromStateId,
        toStateId: value.surfaceTransition!.toStateId,
        durationMilliseconds: uint(value.surfaceTransition!.durationMs),
        easing: reason(value.surfaceTransition!.easing, [
          "linear",
          "cubicIn",
          "cubicOut",
          "cubicInOut",
        ]),
      };
}
function progressionPhase(value: NonNullable<ParticipantRuntimeViewWire["progression"]>) {
  if (oneOf(value, ["stable", "transitioning"]) === "stable") return { kind: "stable" };
  const transition = value.transitioning!;
  const next = required(transition.pendingNext, "pending progression");
  const kind = oneOf(next, ["stay", "end", "step", "group"]);
  return {
    kind: "transitioning",
    blockingRunIds: (transition.blockingRunIds ?? []).map(runId),
    pendingNext: {
      kind,
      ...(kind === "step"
        ? { stepId: next.step!.stepId }
        : kind === "group"
          ? { groupId: next.group!.groupId }
          : {}),
    },
  };
}

export function toParticipantView(value: ParticipantRuntimeViewWire): ParticipantRuntimeView {
  const progression = required(value.progression, "progression");
  const clock = required(value.clock, "clock");
  const status = oneOf(clock, ["running", "paused", "terminating"]);
  let lifecycle: ParticipantRuntimeView["clock"]["lifecycle"];
  if (status === "running") lifecycle = { kind: "running" };
  else if (status === "paused")
    lifecycle = { kind: "paused", reason: reason(clock.paused?.reason, pauseReasons) };
  else
    lifecycle = {
      kind: "terminating",
      reason: reason(clock.terminating?.reason, terminationReasons),
    };
  const origin = required(value.presentationOrigin, "presentation origin");
  const originPose = required(origin.pose, "presentation origin pose");
  return participantRuntimeViewSchema.parse({
    projectionProfileId: value.projectionProfileId,
    assignmentEpoch: uint(value.assignmentEpoch),
    baseReliableSequence: uint(value.baseReliableSequence),
    progression: {
      currentGroupId: progression.currentGroupId,
      groupEntryEpoch: uint(progression.groupEntryEpoch),
      currentStepId: progression.currentStepId,
      stepEntryEpoch: uint(progression.stepEntryEpoch),
      stepEnteredAtRuntimeTimeMilliseconds: uint(progression.stepEnteredAtRuntimeTimeMs),
      phase: progressionPhase(progression),
    },
    nodeStates: record(
      value.nodeStates,
      (node) => required(node.nodeId, "node ID"),
      (node) => {
        const transform = required(node.transform, "node transform");
        return {
          active: node.active ?? false,
          visible: node.visible ?? false,
          opacity: node.opacity ?? 0,
          transform: {
            position: vector(transform.position),
            rotation: rotation(transform.rotation),
            scale: vector(transform.scale),
          },
        };
      },
    ),
    surfaceStates: record(
      value.surfaceStates,
      (surface) => required(surface.surfaceId, "surface ID"),
      (surface) => {
        return {
          stateId: surface.stateId,
          ...(surface.transitionRunId ? { transitionRunId: runId(surface.transitionRunId) } : {}),
        };
      },
    ),
    variables: record(
      value.variables,
      (variable) => required(variable.variableId, "variable ID"),
      (variable) => scalar(variable.value),
    ),
    activeRuns: (value.activeRuns ?? []).map(runtimeRun),
    mediaStates: record(
      value.mediaStates,
      (entry) => required(entry.surfaceId, "media surface"),
      (entry) =>
        oneOf(entry, ["stopped", "active"]) === "stopped"
          ? { kind: "stopped", heldPositionMilliseconds: entry.stopped!.heldPositionMs ?? 0 }
          : {
              kind: "active",
              runId: runId(entry.active!.runId),
              playback: playback(entry.active!.playback),
            },
    ),
    modelClipStates: record(
      value.modelClipStates,
      (entry) => required(entry.modelNodeId, "model node"),
      (entry) => {
        const kind = oneOf(entry, ["defaultPose", "heldClip", "heldBlend", "active"]);
        if (kind === "defaultPose") return { kind };
        if (kind === "heldClip") return { kind, clip: held(entry.heldClip) };
        if (kind === "heldBlend") return { kind, ...blend(entry.heldBlend) };
        return { kind, runId: runId(entry.active!.runId) };
      },
    ),
    clock: { runtimeTimeMilliseconds: uint(clock.runtimeTimeMs), lifecycle },
    presentationOrigin: {
      version: uint(origin.version),
      pose: { position: vector(originPose.position), rotation: rotation(originPose.rotation) },
    },
    enabledLogicalInputs: value.enabledLogicalInputs ?? [],
  });
}
