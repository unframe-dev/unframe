import * as z from "zod";

import {
  idV2Schema,
  positiveSafeUIntV2Schema,
  safeUIntV2Schema,
  scalarV2Schema,
  transformV2Schema,
  unitIntervalV2Schema,
} from "./common";

const runIdSchema = z.strictObject({
  assignmentEpoch: positiveSafeUIntV2Schema,
  runSequence: positiveSafeUIntV2Schema,
});
const ownerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presentation") }),
  z.strictObject({
    kind: z.literal("group"),
    groupId: idV2Schema,
    groupEntryEpoch: positiveSafeUIntV2Schema,
  }),
]);
const causeSchema = z.strictObject({
  cueId: idV2Schema,
  causeEventId: idV2Schema,
  groupId: idV2Schema,
  groupEntryEpoch: positiveSafeUIntV2Schema,
  stepId: idV2Schema,
  stepEntryEpoch: positiveSafeUIntV2Schema,
});
const runBase = {
  runId: runIdSchema,
  owner: ownerSchema,
  cause: causeSchema,
  startedAtRuntimeTimeMilliseconds: safeUIntV2Schema,
};
const playbackClockSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("playing"),
    positionAtReferenceMilliseconds: z.number().finite().nonnegative(),
    referenceRuntimeTimeMilliseconds: safeUIntV2Schema,
  }),
  z.strictObject({
    kind: z.literal("paused"),
    positionMilliseconds: z.number().finite().nonnegative(),
  }),
]);
const clipPlaybackSchema = z.strictObject({
  clipId: idV2Schema,
  playback: playbackClockSchema,
  speed: z.number().finite().positive(),
  loop: z.boolean(),
});
const heldClipSchema = z.strictObject({
  clipId: idV2Schema,
  positionMilliseconds: z.number().finite().nonnegative(),
});
const crossfadeSchema = z.strictObject({
  from: clipPlaybackSchema,
  to: clipPlaybackSchema,
  transitionClock: playbackClockSchema,
  durationMilliseconds: positiveSafeUIntV2Schema,
  easing: z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]),
  fromIsHeld: z.boolean(),
});
export const runtimeRunSnapshotV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...runBase,
    kind: z.literal("timeline"),
    timelineId: idV2Schema,
    completion: z.enum(["blocking", "nonBlocking"]),
  }),
  z.strictObject({
    ...runBase,
    kind: z.literal("surfaceTransition"),
    surfaceId: idV2Schema,
    fromStateId: idV2Schema,
    toStateId: idV2Schema,
    durationMilliseconds: positiveSafeUIntV2Schema,
    completion: z.literal("blocking"),
    easing: z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]),
  }),
  z.strictObject({
    ...runBase,
    kind: z.literal("media"),
    surfaceId: idV2Schema,
    playback: playbackClockSchema,
    completion: z.enum(["blocking", "nonBlocking"]),
  }),
  z.strictObject({
    ...runBase,
    kind: z.literal("modelClip"),
    modelNodeId: idV2Schema,
    phase: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("single"), clip: clipPlaybackSchema }),
      z.strictObject({ kind: z.literal("crossfade"), transition: crossfadeSchema }),
    ]),
    completion: z.enum(["blocking", "nonBlocking"]),
  }),
]);
const m3dRunSchema = z.discriminatedUnion("kind", [
  runtimeRunSnapshotV2Schema.options[0],
  runtimeRunSnapshotV2Schema.options[1],
]);

const pendingNextSchema = z.union([
  z.strictObject({ kind: z.literal("stay") }),
  z.strictObject({ kind: z.literal("end") }),
  z.strictObject({ kind: z.literal("step"), stepId: idV2Schema }),
  z.strictObject({ kind: z.literal("group"), groupId: idV2Schema }),
]);
const progressionPhaseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stable") }),
  z.strictObject({
    kind: z.literal("transitioning"),
    cueId: idV2Schema,
    causeEventId: idV2Schema,
    stepEntryEpoch: positiveSafeUIntV2Schema,
    blockingRunIds: z.array(runIdSchema),
    pendingNext: pendingNextSchema,
  }),
]);
const progressionSchema = z.strictObject({
  currentGroupId: idV2Schema,
  groupEntryEpoch: positiveSafeUIntV2Schema,
  currentStepId: idV2Schema,
  stepEntryEpoch: positiveSafeUIntV2Schema,
  stepEnteredAtRuntimeTimeMilliseconds: safeUIntV2Schema,
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
  opacity: unitIntervalV2Schema,
  transform: transformV2Schema,
});
const clockSchema = z.strictObject({
  runtimeTimeMilliseconds: safeUIntV2Schema,
  lifecycle: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("running") }),
    z.strictObject({ kind: z.literal("paused"), reason: idV2Schema }),
    z.strictObject({ kind: z.literal("terminating"), reason: idV2Schema }),
  ]),
});
const originSchema = z.strictObject({
  version: safeUIntV2Schema,
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
  stepEntryEpoch: positiveSafeUIntV2Schema,
  consumedCueIds: z.array(idV2Schema),
  cooldownUntilRuntimeTimeMilliseconds: z.record(idV2Schema, safeUIntV2Schema),
  timerStates: z.record(
    idV2Schema,
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("armed"), dueAtRuntimeTimeMilliseconds: safeUIntV2Schema }),
      z.strictObject({ kind: z.literal("fired") }),
    ]),
  ),
});
const runtimeResources = {
  surfaceStates: z.record(
    idV2Schema,
    z.strictObject({
      stateId: idV2Schema,
      transitionRunId: runIdSchema.optional(),
    }),
  ),
  nodeStates: z.record(idV2Schema, nodeStateSchema),
  mediaStates: z.record(
    idV2Schema,
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
    idV2Schema,
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("defaultPose") }),
      z.strictObject({ kind: z.literal("heldClip"), clip: heldClipSchema }),
      z.strictObject({
        kind: z.literal("heldBlend"),
        from: heldClipSchema,
        to: heldClipSchema,
        toWeight: unitIntervalV2Schema,
      }),
      z.strictObject({ kind: z.literal("active"), runId: runIdSchema }),
    ]),
  ),
  variables: z.record(idV2Schema, scalarV2Schema),
  activeRuns: z.array(runtimeRunSnapshotV2Schema),
};
const m3dRuntimeResources = {
  ...runtimeResources,
  mediaStates: z.strictObject({}),
  modelClipStates: z.strictObject({}),
  activeRuns: z.array(m3dRunSchema),
};

export const m3dCueRuntimeSnapshotV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  reliableSequence: safeUIntV2Schema,
  lastIngressSequence: safeUIntV2Schema,
  lastAllocatedRunSequence: safeUIntV2Schema,
  clock: clockSchema,
  progression: progressionSchema,
  stepExecution: stepExecutionSchema,
  ...m3dRuntimeResources,
  presentationOrigin: originSchema,
  recentEventIds: z.array(idV2Schema),
});
export const canonicalRuntimeSnapshotV2Schema = z.strictObject({
  ...m3dCueRuntimeSnapshotV2Schema.shape,
  ...runtimeResources,
});

export const runtimeVisibilitySelectionV2Schema = z.strictObject({
  projectionProfileId: idV2Schema,
  role: z.enum(["presenter", "viewer"]),
  visibleNodeIds: z.array(idV2Schema),
  visibleSurfaceIds: z.array(idV2Schema),
  visibleVariableIds: z.array(idV2Schema),
});

export const m3dCueParticipantRuntimeViewV2Schema = z.strictObject({
  projectionProfileId: idV2Schema,
  assignmentEpoch: positiveSafeUIntV2Schema,
  baseReliableSequence: safeUIntV2Schema,
  progression: projectedProgressionSchema,
  ...m3dRuntimeResources,
  clock: clockSchema,
  presentationOrigin: originSchema,
  enabledLogicalInputs: z.array(idV2Schema),
});
export const participantRuntimeViewV2Schema = z.strictObject({
  ...m3dCueParticipantRuntimeViewV2Schema.shape,
  ...runtimeResources,
});

export type M3dCueRuntimeSnapshotV2 = z.infer<typeof m3dCueRuntimeSnapshotV2Schema>;
export type RuntimeVisibilitySelectionV2 = z.infer<typeof runtimeVisibilitySelectionV2Schema>;
export type M3dCueParticipantRuntimeViewV2 = z.infer<typeof m3dCueParticipantRuntimeViewV2Schema>;
export type CanonicalRuntimeSnapshotV2 = z.infer<typeof canonicalRuntimeSnapshotV2Schema>;
export type ParticipantRuntimeViewV2 = z.infer<typeof participantRuntimeViewV2Schema>;
