import * as z from "zod";

import {
  idSchema,
  positiveSafeUIntSchema,
  safeUIntSchema,
  scalarSchema,
  transformSchema,
  unitIntervalSchema,
} from "./common";

const runIdSchema = z.strictObject({
  assignmentEpoch: positiveSafeUIntSchema,
  runSequence: positiveSafeUIntSchema,
});
const ownerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presentation") }),
  z.strictObject({
    kind: z.literal("group"),
    groupId: idSchema,
    groupEntryEpoch: positiveSafeUIntSchema,
  }),
]);
const causeSchema = z.strictObject({
  cueId: idSchema,
  causeEventId: idSchema,
  groupId: idSchema,
  groupEntryEpoch: positiveSafeUIntSchema,
  stepId: idSchema,
  stepEntryEpoch: positiveSafeUIntSchema,
});
const runBase = {
  runId: runIdSchema,
  owner: ownerSchema,
  cause: causeSchema,
  startedAtRuntimeTimeMilliseconds: safeUIntSchema,
};
const playbackClockSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("playing"),
    positionAtReferenceMilliseconds: z.number().finite().nonnegative(),
    referenceRuntimeTimeMilliseconds: safeUIntSchema,
  }),
  z.strictObject({
    kind: z.literal("paused"),
    positionMilliseconds: z.number().finite().nonnegative(),
  }),
]);
const clipPlaybackSchema = z.strictObject({
  clipId: idSchema,
  playback: playbackClockSchema,
  speed: z.number().finite().positive(),
  loop: z.boolean(),
});
const heldClipSchema = z.strictObject({
  clipId: idSchema,
  positionMilliseconds: z.number().finite().nonnegative(),
});
const crossfadeSchema = z.strictObject({
  from: clipPlaybackSchema,
  to: clipPlaybackSchema,
  transitionClock: playbackClockSchema,
  durationMilliseconds: positiveSafeUIntSchema,
  easing: z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]),
  fromIsHeld: z.boolean(),
});
export const runtimeRunSnapshotSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...runBase,
    kind: z.literal("timeline"),
    timelineId: idSchema,
    completion: z.enum(["blocking", "nonBlocking"]),
  }),
  z.strictObject({
    ...runBase,
    kind: z.literal("surfaceTransition"),
    surfaceId: idSchema,
    fromStateId: idSchema,
    toStateId: idSchema,
    durationMilliseconds: positiveSafeUIntSchema,
    completion: z.literal("blocking"),
    easing: z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]),
  }),
  z.strictObject({
    ...runBase,
    kind: z.literal("media"),
    surfaceId: idSchema,
    playback: playbackClockSchema,
    completion: z.enum(["blocking", "nonBlocking"]),
  }),
  z.strictObject({
    ...runBase,
    kind: z.literal("modelClip"),
    modelNodeId: idSchema,
    phase: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("single"), clip: clipPlaybackSchema }),
      z.strictObject({ kind: z.literal("crossfade"), transition: crossfadeSchema }),
    ]),
    completion: z.enum(["blocking", "nonBlocking"]),
  }),
]);
const m3dRunSchema = z.discriminatedUnion("kind", [
  runtimeRunSnapshotSchema.options[0],
  runtimeRunSnapshotSchema.options[1],
]);

const pendingNextSchema = z.union([
  z.strictObject({ kind: z.literal("stay") }),
  z.strictObject({ kind: z.literal("end") }),
  z.strictObject({ kind: z.literal("step"), stepId: idSchema }),
  z.strictObject({ kind: z.literal("group"), groupId: idSchema }),
]);
const progressionPhaseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stable") }),
  z.strictObject({
    kind: z.literal("transitioning"),
    cueId: idSchema,
    causeEventId: idSchema,
    stepEntryEpoch: positiveSafeUIntSchema,
    blockingRunIds: z.array(runIdSchema),
    pendingNext: pendingNextSchema,
  }),
]);
const progressionSchema = z.strictObject({
  currentGroupId: idSchema,
  groupEntryEpoch: positiveSafeUIntSchema,
  currentStepId: idSchema,
  stepEntryEpoch: positiveSafeUIntSchema,
  stepEnteredAtRuntimeTimeMilliseconds: safeUIntSchema,
  phase: progressionPhaseSchema,
});
const projectedProgressionSchema = z.strictObject({
  ...progressionSchema.shape,
  phase: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("stable") }),
    z.strictObject({
      kind: z.literal("transitioning"),
      blockingRunIds: z.array(runIdSchema),
      pendingNext: pendingNextSchema,
    }),
  ]),
});
const nodeStateSchema = z.strictObject({
  active: z.boolean(),
  visible: z.boolean(),
  opacity: unitIntervalSchema,
  transform: transformSchema,
});
const clockSchema = z.strictObject({
  runtimeTimeMilliseconds: safeUIntSchema,
  lifecycle: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("running") }),
    z.strictObject({ kind: z.literal("paused"), reason: idSchema }),
    z.strictObject({ kind: z.literal("terminating"), reason: idSchema }),
  ]),
});
const originSchema = z.strictObject({
  version: safeUIntSchema,
  pose: z.strictObject({
    position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    rotation: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
  }),
});
const stepExecutionSchema = z.strictObject({
  stepEntryEpoch: positiveSafeUIntSchema,
  consumedCueIds: z.array(idSchema),
  cooldownUntilRuntimeTimeMilliseconds: z.record(idSchema, safeUIntSchema),
  timerStates: z.record(
    idSchema,
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("armed"), dueAtRuntimeTimeMilliseconds: safeUIntSchema }),
      z.strictObject({ kind: z.literal("fired") }),
    ]),
  ),
});
const runtimeResources = {
  surfaceStates: z.record(
    idSchema,
    z.strictObject({
      stateId: idSchema,
      transitionRunId: runIdSchema.optional(),
    }),
  ),
  nodeStates: z.record(idSchema, nodeStateSchema),
  mediaStates: z.record(
    idSchema,
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("stopped"),
        heldPositionMilliseconds: z.number().finite().nonnegative(),
      }),
      z.strictObject({
        kind: z.literal("active"),
        runId: runIdSchema,
        playback: playbackClockSchema,
      }),
    ]),
  ),
  modelClipStates: z.record(
    idSchema,
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("defaultPose") }),
      z.strictObject({ kind: z.literal("heldClip"), clip: heldClipSchema }),
      z.strictObject({
        kind: z.literal("heldBlend"),
        from: heldClipSchema,
        to: heldClipSchema,
        toWeight: unitIntervalSchema,
      }),
      z.strictObject({ kind: z.literal("active"), runId: runIdSchema }),
    ]),
  ),
  variables: z.record(idSchema, scalarSchema),
  activeRuns: z.array(runtimeRunSnapshotSchema),
};
const m3dRuntimeResources = {
  ...runtimeResources,
  mediaStates: z.strictObject({}),
  modelClipStates: z.strictObject({}),
  activeRuns: z.array(m3dRunSchema),
};

export const m3dCueRuntimeSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(2),
  reliableSequence: safeUIntSchema,
  lastIngressSequence: safeUIntSchema,
  lastAllocatedRunSequence: safeUIntSchema,
  clock: clockSchema,
  progression: progressionSchema,
  stepExecution: stepExecutionSchema,
  ...m3dRuntimeResources,
  presentationOrigin: originSchema,
  recentEventIds: z.array(idSchema),
});
export const canonicalRuntimeSnapshotSchema = z.strictObject({
  ...m3dCueRuntimeSnapshotSchema.shape,
  ...runtimeResources,
});

export const runtimeVisibilitySelectionSchema = z.strictObject({
  projectionProfileId: idSchema,
  role: z.enum(["presenter", "viewer"]),
  visibleNodeIds: z.array(idSchema),
  visibleSurfaceIds: z.array(idSchema),
  visibleVariableIds: z.array(idSchema),
});

export const m3dCueParticipantRuntimeViewSchema = z.strictObject({
  projectionProfileId: idSchema,
  assignmentEpoch: positiveSafeUIntSchema,
  baseReliableSequence: safeUIntSchema,
  progression: projectedProgressionSchema,
  ...m3dRuntimeResources,
  clock: clockSchema,
  presentationOrigin: originSchema,
  enabledLogicalInputs: z.array(idSchema),
});
export const participantRuntimeViewSchema = z.strictObject({
  ...m3dCueParticipantRuntimeViewSchema.shape,
  ...runtimeResources,
});

export type M3dCueRuntimeSnapshot = z.infer<typeof m3dCueRuntimeSnapshotSchema>;
export type RuntimeVisibilitySelection = z.infer<typeof runtimeVisibilitySelectionSchema>;
export type M3dCueParticipantRuntimeView = z.infer<typeof m3dCueParticipantRuntimeViewSchema>;
export type CanonicalRuntimeSnapshot = z.infer<typeof canonicalRuntimeSnapshotSchema>;
export type ParticipantRuntimeView = z.infer<typeof participantRuntimeViewSchema>;
