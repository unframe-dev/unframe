import {
  m3dCueRuntimeSnapshotSchema,
  canonicalRuntimeSnapshotSchema,
  runtimeVisibilitySelectionSchema,
  type M3dCueRuntimeSnapshot,
  type M3dCueParticipantRuntimeView,
  type PresentationDefinition,
  type RuntimeVisibilitySelection,
  type RenderBundle,
  presentationDefinitionSchema,
  renderBundleSchema,
} from "@unframe/contracts/presentation";
import type { CueState } from "./cue-executor.js";
import { snapshotPlainJson } from "../publication/plain-json.js";
import { hasCanonicalQuaternionSign, isUnitQuaternion } from "../validation/shared.js";

const sorted = (values: Iterable<string>) => [...values].sort();
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const equals = (actual: string[], expected: string[]) =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index]);
const activeOwner = (owner: { kind: string; groupId?: string }, currentGroupId: string) =>
  owner.kind === "presentation" || owner.groupId === currentGroupId;

const visibleResources = (definition: PresentationDefinition, role: "presenter" | "viewer") => {
  const nodes = Object.values(definition.scene.nodes).filter(
    (node) => node.audience.kind === "all" || node.audience.role === role,
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes)
    if (node.parent.kind === "node" && !nodeIds.has(node.parent.nodeId))
      throw new Error(`Visible node ${node.id} references an invisible parent.`);
  const surfaceIds = new Set(
    nodes.filter((node) => node.kind === "surface").map((node) => node.surfaceId),
  );
  return {
    visibleNodeIds: sorted(nodeIds),
    visibleSurfaceIds: sorted(surfaceIds),
  };
};

const potentiallyVisibleNativeVariables = (
  definition: PresentationDefinition,
  visibleSurfaceIds: string[],
): Set<string> => {
  const variableIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if ("value" in value && value.value && typeof value.value === "object") {
      const binding = value.value;
      if ("variableId" in binding && typeof binding.variableId === "string")
        variableIds.add(binding.variableId);
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const id of visibleSurfaceIds) {
    const surface = definition.scene.surfaces[id];
    if (surface?.renderIntent.rendererPreference !== "native-ui") continue;
    if (surface.content.kind === "structured") visit(surface.content.nodes);
    visit(surface.states);
  }
  return variableIds;
};

export const createRuntimeVisibilitySelection = (
  definition: PresentationDefinition,
  projectionProfileId: string,
  role: "presenter" | "viewer",
  visibleVariableIds: string[],
): RuntimeVisibilitySelection => {
  const selection = runtimeVisibilitySelectionSchema.parse({
    projectionProfileId,
    role,
    ...visibleResources(definition, role),
    visibleVariableIds: sorted(visibleVariableIds),
  });
  const errors = validateRuntimeVisibilitySelection(definition, selection);
  if (errors.length) throw new Error(errors.join(" "));
  return selection;
};

export const validateRuntimeVisibilitySelection = (
  definition: PresentationDefinition,
  input: unknown,
): string[] => {
  const parsed = runtimeVisibilitySelectionSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => issue.message);
  try {
    const expected = visibleResources(definition, parsed.data.role);
    const errors = (Object.keys(expected) as (keyof typeof expected)[])
      .filter((key) => !equals(parsed.data[key], expected[key]))
      .map((key) => `${key} differs from the role-visible resource closure.`);
    if (!equals(parsed.data.visibleVariableIds, sorted(new Set(parsed.data.visibleVariableIds))))
      errors.push("visibleVariableIds must be sorted and unique.");
    for (const id of parsed.data.visibleVariableIds)
      if (!Object.hasOwn(definition.flow.variables, id))
        errors.push(`Unknown visible variable ${id}.`);
    // The selected artifact closure is verified by Delivery; this bounds its IDs to visible Native UI sources.
    const possibleBindings = potentiallyVisibleNativeVariables(
      definition,
      expected.visibleSurfaceIds,
    );
    for (const id of parsed.data.visibleVariableIds)
      if (!possibleBindings.has(id))
        errors.push(`Variable ${id} is not used by a visible Native UI Surface.`);
    return errors;
  } catch (error) {
    return [(error as Error).message];
  }
};

export const validateM3dCueRuntimeSnapshot = (
  definition: PresentationDefinition,
  input: unknown,
  assignmentEpoch: number,
  complete = false,
): string[] => {
  const parsed = canonicalRuntimeSnapshotSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => issue.message);
  if (!complete) {
    const subset = m3dCueRuntimeSnapshotSchema.safeParse(input);
    if (!subset.success) return subset.error.issues.map((issue) => issue.message);
  }
  const snapshot = parsed.data;
  const issues: string[] = [];
  if (!Number.isSafeInteger(assignmentEpoch) || assignmentEpoch <= 0)
    issues.push("assignmentEpoch must be a positive safe integer.");
  const { currentGroupId, currentStepId, groupEntryEpoch, stepEntryEpoch } = snapshot.progression;
  const group = definition.flow.groups[currentGroupId];
  if (!group?.steps[currentStepId]) issues.push("Snapshot progression references an unknown Step.");
  if (snapshot.stepExecution.stepEntryEpoch !== stepEntryEpoch)
    issues.push("Step execution epoch differs from progression.");
  if (
    snapshot.progression.stepEnteredAtRuntimeTimeMilliseconds >
    snapshot.clock.runtimeTimeMilliseconds
  )
    issues.push("Step entry occurs after snapshot clock.");
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
  const expectedMedia = sorted(
    expectedSurfaces.filter(
      (id) =>
        definition.scene.surfaces[id]?.renderIntent.internalAnimation.kind === "precomputed-video",
    ),
  );
  const expectedModels = sorted(
    expectedNodes.filter((id) => definition.scene.nodes[id]?.kind === "model"),
  );
  for (const [name, actual, expected] of [
    ["nodeStates", sorted(Object.keys(snapshot.nodeStates)), expectedNodes],
    ["surfaceStates", sorted(Object.keys(snapshot.surfaceStates)), expectedSurfaces],
    ["variables", sorted(Object.keys(snapshot.variables)), expectedVariables],
    ...(complete
      ? ([
          ["mediaStates", sorted(Object.keys(snapshot.mediaStates)), expectedMedia],
          ["modelClipStates", sorted(Object.keys(snapshot.modelClipStates)), expectedModels],
        ] as const)
      : []),
  ] as const)
    if (!equals(actual, expected)) issues.push(`${name} differs from the active resource set.`);
  for (const [id, state] of Object.entries(snapshot.surfaceStates)) {
    if (!definition.scene.surfaces[id]?.states[state.stateId])
      issues.push(`surfaceStates.${id} references an unknown State.`);
    const transitions = snapshot.activeRuns.filter(
      (run) => run.kind === "surfaceTransition" && run.surfaceId === id,
    );
    if (state.transitionRunId) {
      if (
        transitions.length !== 1 ||
        transitions[0]!.runId.assignmentEpoch !== state.transitionRunId.assignmentEpoch ||
        transitions[0]!.runId.runSequence !== state.transitionRunId.runSequence
      )
        issues.push(`surfaceStates.${id} has a stale transition Run ID.`);
      if (
        transitions[0]?.kind === "surfaceTransition" &&
        state.stateId !== transitions[0].toStateId
      )
        issues.push(`surfaceStates.${id} differs from its transition target State.`);
    } else if (transitions.length) {
      issues.push(`surfaceStates.${id} is missing its transition Run ID.`);
    }
  }
  const sameRunId = (
    left: { assignmentEpoch: number; runSequence: number },
    right: { assignmentEpoch: number; runSequence: number },
  ) => left.assignmentEpoch === right.assignmentEpoch && left.runSequence === right.runSequence;
  for (const [id, state] of Object.entries(snapshot.mediaStates)) {
    const runs = snapshot.activeRuns.filter(
      (run): run is Extract<typeof run, { kind: "media" }> =>
        run.kind === "media" && run.surfaceId === id,
    );
    if (state.kind === "active") {
      if (
        runs.length !== 1 ||
        !sameRunId(state.runId, runs[0]!.runId) ||
        (runs[0]?.kind === "media" &&
          JSON.stringify(state.playback) !== JSON.stringify(runs[0].playback))
      )
        issues.push(`mediaStates.${id} differs from its active Run.`);
    } else if (runs.length) issues.push(`mediaStates.${id} has an active Run while stopped.`);
  }
  for (const [id, state] of Object.entries(snapshot.modelClipStates)) {
    const runs = snapshot.activeRuns.filter(
      (run): run is Extract<typeof run, { kind: "modelClip" }> =>
        run.kind === "modelClip" && run.modelNodeId === id,
    );
    if (state.kind === "active") {
      if (runs.length !== 1 || !sameRunId(state.runId, runs[0]!.runId))
        issues.push(`modelClipStates.${id} differs from its active Run.`);
    } else if (runs.length) issues.push(`modelClipStates.${id} has an active Run while held.`);
  }
  const runIds = new Set<string>();
  for (const run of snapshot.activeRuns) {
    const key = `${run.runId.assignmentEpoch}:${run.runId.runSequence}`;
    if (runIds.has(key)) issues.push("Duplicate Runtime Run ID.");
    runIds.add(key);
    if (run.runId.assignmentEpoch !== assignmentEpoch)
      issues.push("Runtime Run assignment epoch differs.");
    if (run.runId.runSequence > snapshot.lastAllocatedRunSequence)
      issues.push("Runtime Run sequence exceeds allocator sequence.");
    if (run.startedAtRuntimeTimeMilliseconds > snapshot.clock.runtimeTimeMilliseconds)
      issues.push("Runtime Run starts after snapshot clock.");
    if (
      run.owner.kind === "group" &&
      (run.owner.groupId !== currentGroupId || run.owner.groupEntryEpoch !== groupEntryEpoch)
    )
      issues.push("Group Runtime Run owner epoch differs from progression.");
    if (run.kind === "timeline") {
      const timeline = definition.flow.timelines[run.timelineId];
      if (!timeline) issues.push("Runtime Run references an unknown Timeline.");
      else {
        if (
          snapshot.clock.runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds >=
          timeline.durationMilliseconds
        )
          issues.push("Runtime Run deadline has passed.");
        for (const track of timeline.tracks) {
          const node = definition.scene.nodes[track.target.nodeId];
          if (!node) issues.push("Timeline Run targets an unknown Node.");
          else if (!expectedNodes.includes(node.id))
            issues.push("Timeline Run targets an inactive Node.");
          else if (!complete && node.audience.kind !== "all")
            issues.push("Timeline Run targets a role-limited Node.");
        }
      }
    }
    if (run.kind === "surfaceTransition") {
      if (!expectedSurfaces.includes(run.surfaceId))
        issues.push("Surface Runtime Run references an inactive Surface.");
      if (run.fromStateId === run.toStateId) issues.push("Surface Runtime Run must change State.");
      const surface = definition.scene.surfaces[run.surfaceId];
      if (!surface?.states[run.fromStateId] || !surface.states[run.toStateId])
        issues.push("Surface Runtime Run references an unknown State.");
      if (
        snapshot.clock.runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds >=
        run.durationMilliseconds
      )
        issues.push("Runtime Run deadline has passed.");
    }
    if (run.kind === "media") {
      const surface = definition.scene.surfaces[run.surfaceId];
      if (
        !expectedMedia.includes(run.surfaceId) ||
        surface?.renderIntent.internalAnimation.kind !== "precomputed-video"
      )
        issues.push("Media Runtime Run references an inactive or non-video Surface.");
      else if (
        run.playback.kind === "playing" &&
        run.playback.referenceRuntimeTimeMilliseconds > snapshot.clock.runtimeTimeMilliseconds
      )
        issues.push("Media Runtime Run reference time is after snapshot clock.");
    }
    if (run.kind === "modelClip") {
      if (!expectedModels.includes(run.modelNodeId))
        issues.push("Model Runtime Run references an inactive or non-model Node.");
      const model = definition.scene.nodes[run.modelNodeId];
      const assetId = model?.kind === "model" ? model.assetId : undefined;
      if (!assetId) issues.push("Model Runtime Run has no Model Asset.");
      for (const clip of run.phase.kind === "single"
        ? [run.phase.clip]
        : [run.phase.transition.from, run.phase.transition.to]) {
        if (
          clip.playback.kind === "playing" &&
          clip.playback.referenceRuntimeTimeMilliseconds > snapshot.clock.runtimeTimeMilliseconds
        )
          issues.push("Model Runtime Run reference time is after snapshot clock.");
      }
      if (run.phase.kind === "crossfade") {
        const transition = run.phase.transition;
        if (transition.fromIsHeld && transition.from.playback.kind !== "paused")
          issues.push("Held Model crossfade source must be paused.");
        if (
          transition.transitionClock.kind === "playing" &&
          transition.transitionClock.referenceRuntimeTimeMilliseconds >
            snapshot.clock.runtimeTimeMilliseconds
        )
          issues.push("Model crossfade reference time is after snapshot clock.");
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
  if (!equals(phaseRunIds, blockingRunIds))
    issues.push("Progression blocking Run IDs differ from active blocking Runs.");
  for (const timer of Object.values(snapshot.stepExecution.timerStates))
    if (
      timer.kind === "armed" &&
      timer.dueAtRuntimeTimeMilliseconds <= snapshot.clock.runtimeTimeMilliseconds
    )
      issues.push("Snapshot contains an expired armed Timer.");
  return issues;
};

export const validateCanonicalRuntimeSnapshot = (
  definition: PresentationDefinition,
  renderBundle: RenderBundle,
  input: unknown,
  assignmentEpoch: number,
): string[] => {
  const frozenDefinition = snapshotPlainJson(definition);
  const frozenBundle = snapshotPlainJson(renderBundle);
  const frozenInput = snapshotPlainJson(input);
  if (!frozenDefinition.valid || !frozenBundle.valid || !frozenInput.valid)
    return ["Canonical snapshot inputs must be plain JSON data properties."];
  const parsedDefinition = presentationDefinitionSchema.safeParse(frozenDefinition.value);
  const parsedBundle = renderBundleSchema.safeParse(frozenBundle.value);
  if (!parsedDefinition.success || !parsedBundle.success)
    return ["Canonical snapshot Definition and RenderBundle must be structurally valid."];
  definition = parsedDefinition.data;
  renderBundle = parsedBundle.data;
  const issues = validateM3dCueRuntimeSnapshot(
    definition,
    frozenInput.value,
    assignmentEpoch,
    true,
  );
  const parsed = canonicalRuntimeSnapshotSchema.safeParse(frozenInput.value);
  if (!parsed.success) return issues;
  const snapshot = parsed.data;
  const runtimeTime = snapshot.clock.runtimeTimeMilliseconds;
  const progression = snapshot.progression;
  const currentStep =
    definition.flow.groups[progression.currentGroupId]?.steps[progression.currentStepId];
  const cueIds = new Set(currentStep?.cues.map((cue) => cue.id) ?? []);
  const ensureCue = (cueId: string, label: string) => {
    if (!cueIds.has(cueId)) issues.push(`${label} references a Cue outside the current Step.`);
  };
  if (
    new Set(snapshot.stepExecution.consumedCueIds).size !==
    snapshot.stepExecution.consumedCueIds.length
  )
    issues.push("Step execution contains duplicate consumed Cue IDs.");
  for (const id of snapshot.stepExecution.consumedCueIds) ensureCue(id, "Consumed Cue");
  for (const id of Object.keys(snapshot.stepExecution.cooldownUntilRuntimeTimeMilliseconds))
    ensureCue(id, "Cooldown");
  for (const id of Object.keys(snapshot.stepExecution.timerStates)) ensureCue(id, "Timer");
  if (progression.phase.kind === "transitioning") {
    ensureCue(progression.phase.cueId, "Transitioning progression");
    if (progression.phase.stepEntryEpoch !== progression.stepEntryEpoch)
      issues.push("Transitioning progression Step epoch differs.");
    if (progression.phase.pendingNext.kind === "step" && !currentStep)
      issues.push("Pending Step target has no current Group.");
    else if (
      progression.phase.pendingNext.kind === "step" &&
      !definition.flow.groups[progression.currentGroupId]?.steps[
        progression.phase.pendingNext.stepId
      ]
    )
      issues.push("Pending Step target is unknown.");
    if (
      progression.phase.pendingNext.kind === "group" &&
      !definition.flow.groups[progression.phase.pendingNext.groupId]
    )
      issues.push("Pending Group target is unknown.");
  }
  for (const [id, value] of Object.entries(snapshot.variables)) {
    const variable = definition.flow.variables[id];
    if (variable && (value === null ? "null" : typeof value) !== variable.type)
      issues.push(`Variable ${id} has the wrong scalar type.`);
  }
  const checkRotation = (rotation: readonly [number, number, number, number], label: string) => {
    if (!isUnitQuaternion(rotation) || !hasCanonicalQuaternionSign(rotation))
      issues.push(`${label} must be a canonical unit Quaternion.`);
  };
  checkRotation(snapshot.presentationOrigin.pose.rotation, "Presentation origin rotation");
  for (const [id, state] of Object.entries(snapshot.nodeStates))
    checkRotation(state.transform.rotation, `Node ${id} rotation`);
  for (const run of snapshot.activeRuns) {
    const causeGroup = definition.flow.groups[run.cause.groupId];
    if (!causeGroup?.steps[run.cause.stepId]?.cues.some((cue) => cue.id === run.cause.cueId))
      issues.push("Runtime Run cause references an unknown Cue.");
    if (
      run.cause.groupEntryEpoch > progression.groupEntryEpoch ||
      run.cause.stepEntryEpoch > progression.stepEntryEpoch
    )
      issues.push("Runtime Run cause epoch exceeds progression.");
    const targetOwner =
      run.kind === "timeline"
        ? definition.flow.timelines[run.timelineId]?.owner
        : run.kind === "modelClip"
          ? definition.scene.nodes[run.modelNodeId]?.owner
          : definition.scene.nodes[definition.scene.surfaces[run.surfaceId]?.hostNodeId ?? ""]
              ?.owner;
    if (
      targetOwner &&
      (targetOwner.kind !== run.owner.kind ||
        (targetOwner.kind === "group" &&
          (run.owner.kind !== "group" || targetOwner.groupId !== run.owner.groupId)))
    )
      issues.push("Runtime Run owner differs from target resource owner.");
  }
  const position = (
    clock: {
      kind: string;
      positionMilliseconds?: number;
      positionAtReferenceMilliseconds?: number;
      referenceRuntimeTimeMilliseconds?: number;
    },
    speed = 1,
  ) =>
    clock.kind === "paused"
      ? clock.positionMilliseconds!
      : clock.positionAtReferenceMilliseconds! +
        (runtimeTime - clock.referenceRuntimeTimeMilliseconds!) * speed;
  for (const [surfaceId, state] of Object.entries(snapshot.mediaStates)) {
    const renders = Object.values(renderBundle.surfaces[surfaceId]?.renderSurfaces ?? {});
    const boundVideos = renders.flatMap((render) =>
      Object.values(render.stateBindings).flatMap((binding) =>
        binding.kind === "artifacts"
          ? binding.artifactIds.flatMap((id) => {
              const artifact = render.artifacts[id];
              return artifact?.kind === "video" ? [artifact] : [];
            })
          : [],
      ),
    );
    const duration = boundVideos[0]?.durationMilliseconds;
    if (duration === undefined) continue;
    const clock = state.kind === "active" ? state.playback : undefined;
    const held = state.kind === "stopped" ? state.heldPositionMilliseconds : undefined;
    const hasLoop = renders.some((render) => {
      const binding = render.stateBindings[snapshot.surfaceStates[surfaceId]?.stateId ?? ""];
      return (
        binding?.kind === "artifacts" &&
        binding.artifactIds.some((id) => {
          const artifact = render.artifacts[id];
          return artifact?.kind === "video" && artifact.loop;
        })
      );
    });
    const at = clock ? position(clock) : undefined;
    if (at !== undefined && !Number.isFinite(at))
      issues.push(`mediaStates.${surfaceId} computed position must be finite.`);
    if (
      (held !== undefined && held > duration) ||
      (at !== undefined && Number.isFinite(at) && at > duration && !hasLoop)
    )
      issues.push(`mediaStates.${surfaceId} position exceeds duration.`);
  }
  for (const [nodeId, state] of Object.entries(snapshot.modelClipStates)) {
    const node = definition.scene.nodes[nodeId];
    if (node?.kind !== "model") continue;
    const model = renderBundle.models[node.assetId];
    if (!model) {
      issues.push(`modelClipStates.${nodeId} references a missing Model Asset.`);
      continue;
    }
    const checkClip = (clip: {
      clipId: string;
      positionMilliseconds?: number;
      playback?: {
        kind: string;
        positionMilliseconds?: number;
        positionAtReferenceMilliseconds?: number;
        referenceRuntimeTimeMilliseconds?: number;
      };
      speed?: number;
    }) => {
      const catalog = model.clips[clip.clipId];
      if (!catalog) issues.push(`modelClipStates.${nodeId} references an unknown clip.`);
      else {
        const at = clip.playback ? position(clip.playback, clip.speed) : clip.positionMilliseconds!;
        if (!Number.isFinite(at))
          issues.push(`modelClipStates.${nodeId} computed position must be finite.`);
        else if (at > catalog.durationMilliseconds)
          issues.push(`modelClipStates.${nodeId} clip position exceeds duration.`);
      }
    };
    if (state.kind === "heldClip") checkClip(state.clip);
    if (state.kind === "heldBlend") {
      checkClip(state.from);
      checkClip(state.to);
    }
  }
  for (const run of snapshot.activeRuns) {
    if (run.kind !== "modelClip") continue;
    const node = definition.scene.nodes[run.modelNodeId];
    const model = node?.kind === "model" ? renderBundle.models[node.assetId] : undefined;
    if (!model) continue;
    const clips =
      run.phase.kind === "single"
        ? [run.phase.clip]
        : [run.phase.transition.from, run.phase.transition.to];
    for (const clip of clips) {
      const entry = model.clips[clip.clipId];
      if (!entry) issues.push(`Model Run ${run.modelNodeId} references an unknown clip.`);
      else {
        const at = position(clip.playback, clip.speed);
        if (!Number.isFinite(at))
          issues.push(`Model Run ${run.modelNodeId} computed position must be finite.`);
        else if (run.phase.kind === "single" && !clip.loop && at >= entry.durationMilliseconds)
          issues.push(`Model Run ${run.modelNodeId} deadline has passed.`);
      }
    }
    if (run.phase.kind === "crossfade") {
      const at = position(run.phase.transition.transitionClock);
      if (!Number.isFinite(at))
        issues.push(`Model crossfade ${run.modelNodeId} computed position must be finite.`);
      else if (at >= run.phase.transition.durationMilliseconds)
        issues.push(`Model crossfade ${run.modelNodeId} deadline has passed.`);
    }
    if (run.completion === "blocking" && clips.some((clip) => clip.loop))
      issues.push("Looping Model Run cannot block progression.");
  }
  return issues;
};

type CueSnapshotMetadata = Pick<
  M3dCueRuntimeSnapshot,
  "reliableSequence" | "lastIngressSequence" | "presentationOrigin" | "recentEventIds"
> & { lifecycle: M3dCueRuntimeSnapshot["clock"]["lifecycle"] };

export const createM3dCueRuntimeSnapshot = (
  definition: PresentationDefinition,
  state: CueState,
  metadata: CueSnapshotMetadata,
): M3dCueRuntimeSnapshot => {
  const surfaceStates = Object.fromEntries(
    Object.entries(state.surfaces).map(([surfaceId, stateId]) => {
      const transition = state.activeRuns.find(
        (run) => run.kind === "surfaceTransition" && run.surfaceId === surfaceId,
      );
      return [surfaceId, { stateId, ...(transition ? { transitionRunId: transition.runId } : {}) }];
    }),
  );
  const snapshot = m3dCueRuntimeSnapshotSchema.parse({
    schemaVersion: 2,
    reliableSequence: metadata.reliableSequence,
    lastIngressSequence: metadata.lastIngressSequence,
    lastAllocatedRunSequence: state.lastRunSequence,
    clock: {
      runtimeTimeMilliseconds: state.runtimeTimeMilliseconds,
      lifecycle: metadata.lifecycle,
    },
    progression: {
      currentGroupId: state.currentGroupId,
      groupEntryEpoch: state.groupEntryEpoch,
      currentStepId: state.currentStepId,
      stepEntryEpoch: state.stepEntryEpoch,
      stepEnteredAtRuntimeTimeMilliseconds: state.stepEnteredAtRuntimeTimeMilliseconds,
      phase: state.phase,
    },
    stepExecution: {
      stepEntryEpoch: state.stepEntryEpoch,
      consumedCueIds: state.consumedCueIds,
      cooldownUntilRuntimeTimeMilliseconds: state.cooldownUntilRuntimeTimeMilliseconds,
      timerStates: state.timerStates,
    },
    surfaceStates,
    nodeStates: state.nodes,
    mediaStates: {},
    modelClipStates: {},
    variables: state.variables,
    activeRuns: state.activeRuns,
    presentationOrigin: metadata.presentationOrigin,
    recentEventIds: metadata.recentEventIds,
  });
  const issues = validateM3dCueRuntimeSnapshot(definition, snapshot, state.assignmentEpoch);
  if (issues.length) throw new Error(issues.join(" "));
  return snapshot;
};

const select = <T>(record: Record<string, T>, ids: string[]): Record<string, T> =>
  Object.fromEntries(
    ids.flatMap((id) => (Object.hasOwn(record, id) ? [[id, cloneJson(record[id]!)] as const] : [])),
  );

export const projectM3dCueParticipantRuntimeView = (
  definition: PresentationDefinition,
  snapshot: M3dCueRuntimeSnapshot,
  profile: RuntimeVisibilitySelection,
  assignmentEpoch: number,
): M3dCueParticipantRuntimeView => {
  const errors = [
    ...validateM3dCueRuntimeSnapshot(definition, snapshot, assignmentEpoch),
    ...validateRuntimeVisibilitySelection(definition, profile),
  ];
  if (errors.length) throw new Error(errors.join(" "));
  const visibleRuns = snapshot.activeRuns.filter(
    (run) => run.kind === "timeline" || profile.visibleSurfaceIds.includes(run.surfaceId),
  );
  const visibleRunIds = new Set(
    visibleRuns.map((run) => `${run.runId.assignmentEpoch}:${run.runId.runSequence}`),
  );
  const progression = {
    currentGroupId: snapshot.progression.currentGroupId,
    groupEntryEpoch: snapshot.progression.groupEntryEpoch,
    currentStepId: snapshot.progression.currentStepId,
    stepEntryEpoch: snapshot.progression.stepEntryEpoch,
    stepEnteredAtRuntimeTimeMilliseconds: snapshot.progression.stepEnteredAtRuntimeTimeMilliseconds,
    phase:
      snapshot.progression.phase.kind === "stable"
        ? { kind: "stable" as const }
        : {
            kind: "transitioning" as const,
            blockingRunIds: snapshot.progression.phase.blockingRunIds.filter((id) =>
              visibleRunIds.has(`${id.assignmentEpoch}:${id.runSequence}`),
            ),
            pendingNext: cloneJson(snapshot.progression.phase.pendingNext),
          },
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
    projectionProfileId: profile.projectionProfileId,
    assignmentEpoch,
    baseReliableSequence: snapshot.reliableSequence,
    progression,
    nodeStates: select(snapshot.nodeStates, profile.visibleNodeIds),
    surfaceStates: select(snapshot.surfaceStates, profile.visibleSurfaceIds),
    mediaStates: select(snapshot.mediaStates, profile.visibleSurfaceIds),
    modelClipStates: select(snapshot.modelClipStates, profile.visibleNodeIds),
    variables: select(snapshot.variables, profile.visibleVariableIds),
    activeRuns: cloneJson(visibleRuns),
    clock: cloneJson(snapshot.clock),
    presentationOrigin: cloneJson(snapshot.presentationOrigin),
    enabledLogicalInputs,
  };
};
