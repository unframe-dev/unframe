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
    groupEntryEpoch: positiveSafeUIntV2Schema,
    groupId: idV2Schema,
    kind: z.literal("group"),
  }),
]);
const causeSchema = z.strictObject({
  causeEventId: idV2Schema,
  cueId: idV2Schema,
  groupEntryEpoch: positiveSafeUIntV2Schema,
  groupId: idV2Schema,
  stepEntryEpoch: positiveSafeUIntV2Schema,
  stepId: idV2Schema,
});
const runBase = {
  cause: causeSchema,
  owner: ownerSchema,
  runId: runIdSchema,
  startedAtRuntimeTimeMilliseconds: safeUIntV2Schema,
};
export const runtimeRunSnapshotV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...runBase,
    completion: z.enum(["blocking", "nonBlocking"]),
    kind: z.literal("timeline"),
    timelineId: idV2Schema,
  }),
  z.strictObject({
    ...runBase,
    completion: z.literal("blocking"),
    durationMilliseconds: positiveSafeUIntV2Schema,
    easing: z.enum(["linear", "cubicIn", "cubicOut", "cubicInOut"]),
    fromStateId: idV2Schema,
    kind: z.literal("surfaceTransition"),
    surfaceId: idV2Schema,
    toStateId: idV2Schema,
  }),
]);

const pendingNextSchema = z.union([
  z.strictObject({ kind: z.literal("stay") }),
  z.strictObject({ kind: z.literal("end") }),
  z.strictObject({ kind: z.literal("step"), stepId: idV2Schema }),
  z.strictObject({ groupId: idV2Schema, kind: z.literal("group") }),
]);
const progressionPhaseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stable") }),
  z.strictObject({
    blockingRunIds: z.array(runIdSchema),
    causeEventId: idV2Schema,
    cueId: idV2Schema,
    kind: z.literal("transitioning"),
    pendingNext: pendingNextSchema,
    stepEntryEpoch: positiveSafeUIntV2Schema,
  }),
]);
const progressionSchema = z.strictObject({
  currentGroupId: idV2Schema,
  currentStepId: idV2Schema,
  groupEntryEpoch: positiveSafeUIntV2Schema,
  phase: progressionPhaseSchema,
  stepEnteredAtRuntimeTimeMilliseconds: safeUIntV2Schema,
  stepEntryEpoch: positiveSafeUIntV2Schema,
});
const projectedProgressionSchema = z.strictObject({
  ...progressionSchema.shape,
  phase: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("stable") }),
    z.strictObject({
      blockingRunIds: z.array(runIdSchema),
      kind: z.literal("transitioning"),
      pendingNext: pendingNextSchema,
    }),
  ]),
});
const nodeStateSchema = z.strictObject({
  active: z.boolean(),
  opacity: unitIntervalV2Schema,
  transform: transformV2Schema,
  visible: z.boolean(),
});
const clockSchema = z.strictObject({
  lifecycle: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("running") }),
    z.strictObject({ kind: z.literal("paused"), reason: idV2Schema }),
    z.strictObject({ kind: z.literal("terminating"), reason: idV2Schema }),
  ]),
  runtimeTimeMilliseconds: safeUIntV2Schema,
});
const originSchema = z.strictObject({
  pose: z.strictObject({
    position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    rotation: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
  }),
  version: safeUIntV2Schema,
});
const stepExecutionSchema = z.strictObject({
  consumedCueIds: z.array(idV2Schema),
  cooldownUntilRuntimeTimeMilliseconds: z.record(idV2Schema, safeUIntV2Schema),
  stepEntryEpoch: positiveSafeUIntV2Schema,
  timerStates: z.record(
    idV2Schema,
    z.discriminatedUnion("kind", [
      z.strictObject({ dueAtRuntimeTimeMilliseconds: safeUIntV2Schema, kind: z.literal("armed") }),
      z.strictObject({ kind: z.literal("fired") }),
    ]),
  ),
});
const runtimeResources = {
  activeRuns: z.array(runtimeRunSnapshotV2Schema),
  mediaStates: z.strictObject({}),
  modelClipStates: z.strictObject({}),
  nodeStates: z.record(idV2Schema, nodeStateSchema),
  surfaceStates: z.record(
    idV2Schema,
    z.strictObject({
      stateId: idV2Schema,
      transitionRunId: runIdSchema.optional(),
    }),
  ),
  variables: z.record(idV2Schema, scalarV2Schema),
};

export const m3dCueRuntimeSnapshotV2Schema = z.strictObject({
  clock: clockSchema,
  lastAllocatedRunSequence: safeUIntV2Schema,
  lastIngressSequence: safeUIntV2Schema,
  progression: progressionSchema,
  reliableSequence: safeUIntV2Schema,
  schemaVersion: z.literal(2),
  stepExecution: stepExecutionSchema,
  ...runtimeResources,
  presentationOrigin: originSchema,
  recentEventIds: z.array(idV2Schema),
});

export const runtimeVisibilitySelectionV2Schema = z.strictObject({
  projectionProfileId: idV2Schema,
  role: z.enum(["presenter", "viewer"]),
  visibleNodeIds: z.array(idV2Schema),
  visibleSurfaceIds: z.array(idV2Schema),
  visibleVariableIds: z.array(idV2Schema),
});

export const m3dCueParticipantRuntimeViewV2Schema = z.strictObject({
  assignmentEpoch: positiveSafeUIntV2Schema,
  baseReliableSequence: safeUIntV2Schema,
  progression: projectedProgressionSchema,
  projectionProfileId: idV2Schema,
  ...runtimeResources,
  clock: clockSchema,
  enabledLogicalInputs: z.array(idV2Schema),
  presentationOrigin: originSchema,
});

export type M3dCueRuntimeSnapshotV2 = z.infer<typeof m3dCueRuntimeSnapshotV2Schema>;
export type RuntimeVisibilitySelectionV2 = z.infer<typeof runtimeVisibilitySelectionV2Schema>;
export type M3dCueParticipantRuntimeViewV2 = z.infer<typeof m3dCueParticipantRuntimeViewV2Schema>;
