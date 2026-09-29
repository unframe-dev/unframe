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
  mediaStates: z.strictObject({}),
  modelClipStates: z.strictObject({}),
  variables: z.record(idV2Schema, scalarV2Schema),
  activeRuns: z.array(runtimeRunSnapshotV2Schema),
};

export const m3dCueRuntimeSnapshotV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  reliableSequence: safeUIntV2Schema,
  lastIngressSequence: safeUIntV2Schema,
  lastAllocatedRunSequence: safeUIntV2Schema,
  clock: clockSchema,
  progression: progressionSchema,
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
  projectionProfileId: idV2Schema,
  assignmentEpoch: positiveSafeUIntV2Schema,
  baseReliableSequence: safeUIntV2Schema,
  progression: projectedProgressionSchema,
  ...runtimeResources,
  clock: clockSchema,
  presentationOrigin: originSchema,
  enabledLogicalInputs: z.array(idV2Schema),
});

export type M3dCueRuntimeSnapshotV2 = z.infer<typeof m3dCueRuntimeSnapshotV2Schema>;
export type RuntimeVisibilitySelectionV2 = z.infer<typeof runtimeVisibilitySelectionV2Schema>;
export type M3dCueParticipantRuntimeViewV2 = z.infer<typeof m3dCueParticipantRuntimeViewV2Schema>;
