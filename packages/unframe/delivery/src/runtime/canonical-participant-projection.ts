import {
  canonicalRuntimeSnapshotSchema,
  participantRuntimeViewSchema,
  type ParticipantRuntimeView,
} from "@unframe/contracts/presentation/runtime-projection";
import { parseDeliveryInputs, type DeliverySourceInput } from "../delivery/input.js";
import { buildProjectionProfile } from "../delivery/profile.js";
import { snapshotPlainJson } from "@unframe/artifacts/plain-json";
import { validateCanonicalRuntimeSnapshot } from "@unframe/playback";

const select = <T>(values: Record<string, T>, ids: readonly string[]): Record<string, T> =>
  Object.fromEntries(ids.filter((id) => Object.hasOwn(values, id)).map((id) => [id, values[id]!]));
const runKey = (id: { assignmentEpoch: number; runSequence: number }) =>
  `${id.assignmentEpoch}:${id.runSequence}`;

export const projectCanonicalParticipantRuntimeView = (
  source: DeliverySourceInput,
  role: "presenter" | "viewer",
  input: unknown,
  assignmentEpoch: number,
): ParticipantRuntimeView => {
  if (role !== "presenter" && role !== "viewer") throw new TypeError("Unknown participant role.");
  if (!Number.isSafeInteger(assignmentEpoch) || assignmentEpoch <= 0)
    throw new RangeError("Assignment epoch must be a positive safe integer.");
  const artifacts = parseDeliveryInputs(source);
  const frozen = snapshotPlainJson(input);
  if (!frozen.valid)
    throw new TypeError("Canonical snapshot must contain only plain JSON data properties.");
  const issues = validateCanonicalRuntimeSnapshot(
    artifacts.definition,
    artifacts.renderBundle,
    frozen.value,
    assignmentEpoch,
  );
  if (issues.length) throw new Error(issues.join(" "));
  const snapshot = canonicalRuntimeSnapshotSchema.parse(frozen.value);
  const { profile, selection } = buildProjectionProfile(artifacts, role);
  const nodes = new Set(selection.visibleNodeIds);
  const surfaces = new Set(selection.visibleSurfaceIds);
  const timelines = new Set(
    (profile.runtimeCatalog?.timelines ?? []).map((timeline) => timeline.timelineId),
  );
  const activeRuns = snapshot.activeRuns.filter((run) => {
    if (run.kind === "timeline") return timelines.has(run.timelineId);
    if (run.kind === "modelClip") return nodes.has(run.modelNodeId);
    return surfaces.has(run.surfaceId);
  });
  const visibleRunIds = new Set(activeRuns.map((run) => runKey(run.runId)));
  const phase = snapshot.progression.phase;
  const progression = {
    currentGroupId: snapshot.progression.currentGroupId,
    groupEntryEpoch: snapshot.progression.groupEntryEpoch,
    currentStepId: snapshot.progression.currentStepId,
    stepEntryEpoch: snapshot.progression.stepEntryEpoch,
    stepEnteredAtRuntimeTimeMilliseconds: snapshot.progression.stepEnteredAtRuntimeTimeMilliseconds,
    phase:
      phase.kind === "stable"
        ? { kind: "stable" as const }
        : {
            kind: "transitioning" as const,
            blockingRunIds: phase.blockingRunIds.filter((id) => visibleRunIds.has(runKey(id))),
            pendingNext: phase.pendingNext,
          },
  };
  const cues =
    artifacts.definition.flow.groups[progression.currentGroupId]!.steps[progression.currentStepId]!
      .cues;
  const enabledLogicalInputs =
    role === "presenter" && phase.kind === "stable"
      ? [
          ...new Set(
            cues
              .filter(
                (cue) =>
                  cue.trigger.kind === "logicalInput" &&
                  cue.trigger.actor.kind === "presenter" &&
                  !cue.guard &&
                  !(
                    cue.firePolicy.kind === "oncePerStepEntry" &&
                    snapshot.stepExecution.consumedCueIds.includes(cue.id)
                  ),
              )
              .map((cue) => (cue.trigger.kind === "logicalInput" ? cue.trigger.action : "")),
          ),
        ].sort()
      : [];
  return participantRuntimeViewSchema.parse({
    frozenAnchors: snapshot.frozenAnchors.filter((anchor) => nodes.has(anchor.nodeId)),
    projectionProfileId: profile.projectionProfileId,
    assignmentEpoch,
    baseReliableSequence: snapshot.reliableSequence,
    progression,
    nodeStates: select(snapshot.nodeStates, selection.visibleNodeIds),
    surfaceStates: select(snapshot.surfaceStates, selection.visibleSurfaceIds),
    mediaStates: select(snapshot.mediaStates, selection.visibleSurfaceIds),
    modelClipStates: select(snapshot.modelClipStates, selection.visibleNodeIds),
    variables: select(snapshot.variables, selection.visibleVariableIds),
    activeRuns,
    clock: snapshot.clock,
    presentationOrigin: snapshot.presentationOrigin,
    enabledLogicalInputs,
  });
};
