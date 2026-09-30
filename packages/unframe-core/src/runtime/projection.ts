import {
  m3dCueRuntimeSnapshotV2Schema,
  runtimeVisibilitySelectionV2Schema,
  type M3dCueRuntimeSnapshotV2,
  type M3dCueParticipantRuntimeViewV2,
  type PresentationDefinitionV2,
  type RuntimeVisibilitySelectionV2,
} from "@unframe/contracts/presentation/v2";
import type { CueState } from "./cue-executor.js";

const sorted = (values: Iterable<string>) => [...values].sort();
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const equals = (actual: Array<string>, expected: Array<string>) =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index]);
const activeOwner = (owner: { groupId?: string; kind: string }, currentGroupId: string) =>
  owner.kind === "presentation" || owner.groupId === currentGroupId;

const visibleResources = (definition: PresentationDefinitionV2, role: "presenter" | "viewer") => {
  const nodes = Object.values(definition.scene.nodes).filter(
    (node) => node.audience.kind === "all" || node.audience.role === role,
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (node.parent.kind === "node" && !nodeIds.has(node.parent.nodeId)) {
      throw new Error(`Visible node ${node.id} references an invisible parent.`);
    }
  }
  const surfaceIds = new Set(
    nodes.filter((node) => node.kind === "surface").map((node) => node.surfaceId),
  );
  return {
    visibleNodeIds: sorted(nodeIds),
    visibleSurfaceIds: sorted(surfaceIds),
  };
};

const potentiallyVisibleNativeVariables = (
  definition: PresentationDefinitionV2,
  visibleSurfaceIds: Array<string>,
): Set<string> => {
  const variableIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }
    if ("value" in value && value.value && typeof value.value === "object") {
      const binding = value.value;
      if ("variableId" in binding && typeof binding.variableId === "string") {
        variableIds.add(binding.variableId);
      }
    }
    for (const child of Object.values(value)) {
      visit(child);
    }
  };
  for (const id of visibleSurfaceIds) {
    const surface = definition.scene.surfaces[id];
    if (surface?.renderIntent.rendererPreference !== "native-ui") {
      continue;
    }
    if (surface.content.kind === "structured") {
      visit(surface.content.nodes);
    }
    visit(surface.states);
  }
  return variableIds;
};

export const createRuntimeVisibilitySelection = (
  definition: PresentationDefinitionV2,
  projectionProfileId: string,
  role: "presenter" | "viewer",
  visibleVariableIds: Array<string>,
): RuntimeVisibilitySelectionV2 => {
  const selection = runtimeVisibilitySelectionV2Schema.parse({
    projectionProfileId,
    role,
    ...visibleResources(definition, role),
    visibleVariableIds: sorted(visibleVariableIds),
  });
  const errors = validateRuntimeVisibilitySelection(definition, selection);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }
  return selection;
};

export const validateRuntimeVisibilitySelection = (
  definition: PresentationDefinitionV2,
  input: unknown,
): Array<string> => {
  const parsed = runtimeVisibilitySelectionV2Schema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => issue.message);
  }
  try {
    const expected = visibleResources(definition, parsed.data.role);
    const errors = (Object.keys(expected) as Array<keyof typeof expected>)
      .filter((key) => !equals(parsed.data[key], expected[key]))
      .map((key) => `${key} differs from the role-visible resource closure.`);
    if (!equals(parsed.data.visibleVariableIds, sorted(new Set(parsed.data.visibleVariableIds)))) {
      errors.push("visibleVariableIds must be sorted and unique.");
    }
    for (const id of parsed.data.visibleVariableIds) {
      if (!Object.hasOwn(definition.flow.variables, id)) {
        errors.push(`Unknown visible variable ${id}.`);
      }
    }
    // The selected artifact closure is verified by Delivery; this bounds its IDs to visible Native UI sources.
    const possibleBindings = potentiallyVisibleNativeVariables(
      definition,
      expected.visibleSurfaceIds,
    );
    for (const id of parsed.data.visibleVariableIds) {
      if (!possibleBindings.has(id)) {
        errors.push(`Variable ${id} is not used by a visible Native UI Surface.`);
      }
    }
    return errors;
  } catch (error) {
    return [(error as Error).message];
  }
};

export const validateM3dCueRuntimeSnapshot = (
  definition: PresentationDefinitionV2,
  input: unknown,
  assignmentEpoch: number,
): Array<string> => {
  const parsed = m3dCueRuntimeSnapshotV2Schema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => issue.message);
  }
  const snapshot = parsed.data;
  const issues: Array<string> = [];
  if (!Number.isSafeInteger(assignmentEpoch) || assignmentEpoch <= 0) {
    issues.push("assignmentEpoch must be a positive safe integer.");
  }
  const { currentGroupId, currentStepId, groupEntryEpoch, stepEntryEpoch } = snapshot.progression;
  const group = definition.flow.groups[currentGroupId];
  if (!group?.steps[currentStepId]) {
    issues.push("Snapshot progression references an unknown Step.");
  }
  if (snapshot.stepExecution.stepEntryEpoch !== stepEntryEpoch) {
    issues.push("Step execution epoch differs from progression.");
  }
  if (
    snapshot.progression.stepEnteredAtRuntimeTimeMilliseconds >
    snapshot.clock.runtimeTimeMilliseconds
  ) {
    issues.push("Step entry occurs after snapshot clock.");
  }
  const expectedNodes = sorted(
    Object.values(definition.scene.nodes)
      .filter((node) => activeOwner(node.owner, currentGroupId))
      .map((node) => node.id),
  );
  const expectedSurfaces = sorted(
    Object.values(definition.scene.surfaces)
      .filter((surface) => {
        const host = definition.scene.nodes[surface.hostNodeId];
        return host && activeOwner(host.owner, currentGroupId);
      })
      .map((surface) => surface.id),
  );
  const expectedVariables = sorted(
    Object.values(definition.flow.variables)
      .filter((variable) => activeOwner(variable.owner, currentGroupId))
      .map((variable) => variable.id),
  );
  for (const [name, actual, expected] of [
    ["nodeStates", sorted(Object.keys(snapshot.nodeStates)), expectedNodes],
    ["surfaceStates", sorted(Object.keys(snapshot.surfaceStates)), expectedSurfaces],
    ["variables", sorted(Object.keys(snapshot.variables)), expectedVariables],
  ] as const) {
    if (!equals(actual, expected)) {
      issues.push(`${name} differs from the active resource set.`);
    }
  }
  for (const [id, state] of Object.entries(snapshot.surfaceStates)) {
    if (!definition.scene.surfaces[id]?.states[state.stateId]) {
      issues.push(`surfaceStates.${id} references an unknown State.`);
    }
    const transitions = snapshot.activeRuns.filter(
      (run) => run.kind === "surfaceTransition" && run.surfaceId === id,
    );
    if (state.transitionRunId) {
      if (
        transitions.length !== 1 ||
        transitions[0]!.runId.assignmentEpoch !== state.transitionRunId.assignmentEpoch ||
        transitions[0]!.runId.runSequence !== state.transitionRunId.runSequence
      ) {
        issues.push(`surfaceStates.${id} has a stale transition Run ID.`);
      }
      if (
        transitions[0]?.kind === "surfaceTransition" &&
        state.stateId !== transitions[0].toStateId
      ) {
        issues.push(`surfaceStates.${id} differs from its transition target State.`);
      }
    } else if (transitions.length) {
      issues.push(`surfaceStates.${id} is missing its transition Run ID.`);
    }
  }
  const runIds = new Set<string>();
  for (const run of snapshot.activeRuns) {
    const key = `${run.runId.assignmentEpoch}:${run.runId.runSequence}`;
    if (runIds.has(key)) {
      issues.push("Duplicate Runtime Run ID.");
    }
    runIds.add(key);
    if (run.runId.assignmentEpoch !== assignmentEpoch) {
      issues.push("Runtime Run assignment epoch differs.");
    }
    if (run.runId.runSequence > snapshot.lastAllocatedRunSequence) {
      issues.push("Runtime Run sequence exceeds allocator sequence.");
    }
    if (run.startedAtRuntimeTimeMilliseconds > snapshot.clock.runtimeTimeMilliseconds) {
      issues.push("Runtime Run starts after snapshot clock.");
    }
    if (
      run.owner.kind === "group" &&
      (run.owner.groupId !== currentGroupId || run.owner.groupEntryEpoch !== groupEntryEpoch)
    ) {
      issues.push("Group Runtime Run owner epoch differs from progression.");
    }
    if (run.kind === "timeline") {
      const timeline = definition.flow.timelines[run.timelineId];
      if (!timeline) {
        issues.push("Runtime Run references an unknown Timeline.");
      } else {
        if (
          snapshot.clock.runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds >=
          timeline.durationMilliseconds
        ) {
          issues.push("Runtime Run deadline has passed.");
        }
        for (const track of timeline.tracks) {
          if (definition.scene.nodes[track.target.nodeId]?.audience.kind !== "all") {
            issues.push("Timeline Run targets a role-limited Node.");
          }
        }
      }
    }
    if (run.kind === "surfaceTransition") {
      if (!expectedSurfaces.includes(run.surfaceId)) {
        issues.push("Surface Runtime Run references an inactive Surface.");
      }
      if (run.fromStateId === run.toStateId) {
        issues.push("Surface Runtime Run must change State.");
      }
      const surface = definition.scene.surfaces[run.surfaceId];
      if (!surface?.states[run.fromStateId] || !surface.states[run.toStateId]) {
        issues.push("Surface Runtime Run references an unknown State.");
      }
      if (
        snapshot.clock.runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds >=
        run.durationMilliseconds
      ) {
        issues.push("Runtime Run deadline has passed.");
      }
    }
  }
  const blockingRunIds = snapshot.activeRuns
    .filter((run) => run.completion === "blocking")
    .map((run) => `${run.runId.assignmentEpoch}:${run.runId.runSequence}`)
    .sort();
  const phaseRunIds =
    snapshot.progression.phase.kind === "transitioning"
      ? snapshot.progression.phase.blockingRunIds
          .map((id) => `${id.assignmentEpoch}:${id.runSequence}`)
          .sort()
      : [];
  if (!equals(phaseRunIds, blockingRunIds)) {
    issues.push("Progression blocking Run IDs differ from active blocking Runs.");
  }
  for (const timer of Object.values(snapshot.stepExecution.timerStates)) {
    if (
      timer.kind === "armed" &&
      timer.dueAtRuntimeTimeMilliseconds <= snapshot.clock.runtimeTimeMilliseconds
    ) {
      issues.push("Snapshot contains an expired armed Timer.");
    }
  }
  return issues;
};

type CueSnapshotMetadata = Pick<
  M3dCueRuntimeSnapshotV2,
  "reliableSequence" | "lastIngressSequence" | "presentationOrigin" | "recentEventIds"
> & { lifecycle: M3dCueRuntimeSnapshotV2["clock"]["lifecycle"] };

export const createM3dCueRuntimeSnapshot = (
  definition: PresentationDefinitionV2,
  state: CueState,
  metadata: CueSnapshotMetadata,
): M3dCueRuntimeSnapshotV2 => {
  const surfaceStates = Object.fromEntries(
    Object.entries(state.surfaces).map(([surfaceId, stateId]) => {
      const transition = state.activeRuns.find(
        (run) => run.kind === "surfaceTransition" && run.surfaceId === surfaceId,
      );
      return [surfaceId, { stateId, ...(transition ? { transitionRunId: transition.runId } : {}) }];
    }),
  );
  const snapshot = m3dCueRuntimeSnapshotV2Schema.parse({
    activeRuns: state.activeRuns,
    clock: {
      lifecycle: metadata.lifecycle,
      runtimeTimeMilliseconds: state.runtimeTimeMilliseconds,
    },
    lastAllocatedRunSequence: state.lastRunSequence,
    lastIngressSequence: metadata.lastIngressSequence,
    mediaStates: {},
    modelClipStates: {},
    nodeStates: state.nodes,
    presentationOrigin: metadata.presentationOrigin,
    progression: {
      currentGroupId: state.currentGroupId,
      currentStepId: state.currentStepId,
      groupEntryEpoch: state.groupEntryEpoch,
      phase: state.phase,
      stepEnteredAtRuntimeTimeMilliseconds: state.stepEnteredAtRuntimeTimeMilliseconds,
      stepEntryEpoch: state.stepEntryEpoch,
    },
    recentEventIds: metadata.recentEventIds,
    reliableSequence: metadata.reliableSequence,
    schemaVersion: 2,
    stepExecution: {
      consumedCueIds: state.consumedCueIds,
      cooldownUntilRuntimeTimeMilliseconds: state.cooldownUntilRuntimeTimeMilliseconds,
      stepEntryEpoch: state.stepEntryEpoch,
      timerStates: state.timerStates,
    },
    surfaceStates,
    variables: state.variables,
  });
  const issues = validateM3dCueRuntimeSnapshot(definition, snapshot, state.assignmentEpoch);
  if (issues.length) {
    throw new Error(issues.join(" "));
  }
  return snapshot;
};

const select = <T>(record: Record<string, T>, ids: Array<string>): Record<string, T> =>
  Object.fromEntries(
    ids.flatMap((id) => (Object.hasOwn(record, id) ? [[id, cloneJson(record[id]!)] as const] : [])),
  );

export const projectM3dCueParticipantRuntimeView = (
  definition: PresentationDefinitionV2,
  snapshot: M3dCueRuntimeSnapshotV2,
  profile: RuntimeVisibilitySelectionV2,
  assignmentEpoch: number,
): M3dCueParticipantRuntimeViewV2 => {
  const errors = [
    ...validateM3dCueRuntimeSnapshot(definition, snapshot, assignmentEpoch),
    ...validateRuntimeVisibilitySelection(definition, profile),
  ];
  if (errors.length) {
    throw new Error(errors.join(" "));
  }
  const visibleRuns = snapshot.activeRuns.filter(
    (run) => run.kind === "timeline" || profile.visibleSurfaceIds.includes(run.surfaceId),
  );
  const visibleRunIds = new Set(
    visibleRuns.map((run) => `${run.runId.assignmentEpoch}:${run.runId.runSequence}`),
  );
  const progression = {
    currentGroupId: snapshot.progression.currentGroupId,
    currentStepId: snapshot.progression.currentStepId,
    groupEntryEpoch: snapshot.progression.groupEntryEpoch,
    phase:
      snapshot.progression.phase.kind === "stable"
        ? { kind: "stable" as const }
        : {
            blockingRunIds: snapshot.progression.phase.blockingRunIds.filter((id) =>
              visibleRunIds.has(`${id.assignmentEpoch}:${id.runSequence}`),
            ),
            kind: "transitioning" as const,
            pendingNext: cloneJson(snapshot.progression.phase.pendingNext),
          },
    stepEnteredAtRuntimeTimeMilliseconds: snapshot.progression.stepEnteredAtRuntimeTimeMilliseconds,
    stepEntryEpoch: snapshot.progression.stepEntryEpoch,
  };
  const enabledLogicalInputs = sorted(
    new Set(
      (snapshot.progression.phase.kind === "stable"
        ? Object.values(
            definition.flow.groups[snapshot.progression.currentGroupId]!.steps[
              snapshot.progression.currentStepId
            ]!.cues,
          )
        : []
      )
        .filter(
          (cue) =>
            cue.trigger.kind === "logicalInput" &&
            cue.trigger.actor.kind === "presenter" &&
            profile.role === "presenter" &&
            !cue.guard &&
            !(
              cue.firePolicy.kind === "oncePerStepEntry" &&
              snapshot.stepExecution.consumedCueIds.includes(cue.id)
            ) &&
            (snapshot.stepExecution.cooldownUntilRuntimeTimeMilliseconds[cue.id] ?? 0) <=
              snapshot.clock.runtimeTimeMilliseconds,
        )
        .map((cue) => (cue.trigger.kind === "logicalInput" ? cue.trigger.action : "")),
    ),
  );
  return {
    activeRuns: cloneJson(visibleRuns),
    assignmentEpoch,
    baseReliableSequence: snapshot.reliableSequence,
    clock: cloneJson(snapshot.clock),
    enabledLogicalInputs,
    mediaStates: {},
    modelClipStates: {},
    nodeStates: select(snapshot.nodeStates, profile.visibleNodeIds),
    presentationOrigin: cloneJson(snapshot.presentationOrigin),
    progression,
    projectionProfileId: profile.projectionProfileId,
    surfaceStates: select(snapshot.surfaceStates, profile.visibleSurfaceIds),
    variables: select(snapshot.variables, profile.visibleVariableIds),
  };
};
