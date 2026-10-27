import type {
  ParticipantRuntimeViewWire,
  ProjectedRuntimeCatalogWire,
  ProjectedVariableDefinitionWire,
  VariableStateWire,
  RuntimeRunSnapshotWire,
  RuntimeRunIdWire,
} from "@unframe/contracts/presentation";
import { requireValue, uint, id } from "./runtime-input";
import { toParticipantView } from "./wire-view";
import { assertViewerInputs } from "./viewer-policy";

export interface RuntimeViewValidationContext {
  catalog: ProjectedRuntimeCatalogWire;
  assignmentEpoch: string | undefined;
  groupExited?: boolean;
  canceledMedia?: ReadonlySet<string>;
  canceledModels?: ReadonlySet<string>;
}

export function validateVariables(
  variables: VariableStateWire[] | undefined,
  definitions: ProjectedVariableDefinitionWire[],
) {
  requireValue((variables?.length ?? 0) === definitions.length);
  let previous = "";
  for (const variable of variables ?? []) {
    id(variable.variableId);
    requireValue(variable.variableId > previous);
    previous = variable.variableId;
    const definition = definitions.find((value) => value.variableId === variable.variableId);
    const value = variable.value;
    requireValue(definition && value);
    requireValue(
      (definition.type === 1 && typeof value.stringValue === "string") ||
        (definition.type === 2 &&
          typeof value.numberValue === "number" &&
          Number.isFinite(value.numberValue)) ||
        (definition.type === 3 && typeof value.booleanValue === "boolean") ||
        (definition.type === 4 && value.nullValue !== undefined),
    );
  }
}

export function runtimeRunSequence(
  assignmentEpoch: string | undefined,
  runId: RuntimeRunIdWire | undefined,
) {
  requireValue(
    runId && uint(runId.assignmentEpoch) === uint(assignmentEpoch) && uint(runId.runSequence) > 0,
  );
  return uint(runId.runSequence);
}
export function runtimeTimeline(catalog: ProjectedRuntimeCatalogWire, run: RuntimeRunSnapshotWire) {
  return catalog.timelines?.find((timeline) => timeline.timelineId === run.timeline?.timelineId);
}
export function timelineProperties(
  catalog: ProjectedRuntimeCatalogWire,
  view: ParticipantRuntimeViewWire,
) {
  const result = new Set<string>();
  for (const run of view.activeRuns ?? []) {
    if (!run.timeline) continue;
    const definition = runtimeTimeline(catalog, run);
    requireValue(definition);
    for (const track of definition.tracks ?? []) {
      requireValue(
        track.target && view.nodeStates?.some((node) => node.nodeId === track.target!.nodeId),
      );
      const key = `${track.target.nodeId}:${track.target.property}`;
      requireValue(!result.has(key));
      result.add(key);
    }
  }
  return result;
}
export function validateRuntimeView(
  view: ParticipantRuntimeViewWire,
  context: RuntimeViewValidationContext,
) {
  const {
    catalog,
    assignmentEpoch,
    groupExited = false,
    canceledMedia = new Set<string>(),
    canceledModels = new Set<string>(),
  } = context;
  const runKey = (runId: RuntimeRunIdWire | undefined) =>
    runtimeRunSequence(assignmentEpoch, runId);
  const timelineFor = (run: RuntimeRunSnapshotWire) => runtimeTimeline(catalog, run);
  assertViewerInputs(view.enabledLogicalInputs);

  requireValue(view.progression);
  const runIds = new Set<number>();
  for (const run of view.activeRuns ?? []) {
    const key = runKey(run.runId);
    requireValue(!runIds.has(key));
    runIds.add(key);
    requireValue([1, 2].includes(run.completion ?? 0));
    requireValue(uint(run.startedAtRuntimeTimeMs) <= uint(view.clock?.runtimeTimeMs));
    const owner = run.owner;
    requireValue(
      owner &&
        (owner.presentation !== undefined ||
          (owner.group?.groupId === view.progression.currentGroupId &&
            uint(owner.group.groupEntryEpoch) === uint(view.progression.groupEntryEpoch))),
    );
    const cause = run.cause;
    requireValue(cause);
    id(cause.cueId);
    id(cause.causeEventId);
    id(cause.groupId);
    id(cause.stepId);
    requireValue(uint(cause.groupEntryEpoch) > 0 && uint(cause.stepEntryEpoch) > 0);
    requireValue(
      uint(cause.groupEntryEpoch) <= uint(view.progression.groupEntryEpoch) &&
        uint(cause.stepEntryEpoch) <= uint(view.progression.stepEntryEpoch),
    );
    if (uint(cause.groupEntryEpoch) === uint(view.progression.groupEntryEpoch))
      requireValue(cause.groupId === view.progression.currentGroupId);
    if (owner.group)
      requireValue(
        cause.groupId === owner.group.groupId &&
          uint(cause.groupEntryEpoch) === uint(owner.group.groupEntryEpoch),
      );
    if (run.timeline) {
      const definition = timelineFor(run);
      requireValue(definition && uint(definition.durationMs) > 0 && definition.tracks?.length);
      requireValue(
        Number.isSafeInteger(uint(run.startedAtRuntimeTimeMs) + uint(definition.durationMs)),
      );
      requireValue(
        definition.owner?.presentation !== undefined
          ? owner.presentation !== undefined
          : definition.owner?.group?.groupId === owner.group?.groupId,
      );
    } else if (run.surfaceTransition) {
      const transition = run.surfaceTransition;
      requireValue(run.completion === 1);
      const surface = view.surfaceStates?.find((value) => value.surfaceId === transition.surfaceId);
      const definition = catalog.surfaces?.find(
        (value) => value.surfaceId === transition.surfaceId,
      );
      requireValue(
        surface &&
          definition &&
          surface.stateId === transition.toStateId &&
          surface.transitionRunId &&
          runKey(surface.transitionRunId) === key,
      );
      requireValue(
        definition.reachableStateIds?.includes(transition.toStateId ?? "") &&
          definition.reachableStateIds?.includes(transition.fromStateId ?? "") &&
          transition.fromStateId !== transition.toStateId,
      );
      requireValue(
        uint(transition.durationMs) > 0 && [1, 2, 3, 4].includes(transition.easing ?? 0),
      );
      requireValue(
        Number.isSafeInteger(uint(run.startedAtRuntimeTimeMs) + uint(transition.durationMs)),
      );
      requireValue(
        definition.owner?.presentation !== undefined
          ? owner.presentation !== undefined
          : definition.owner?.group?.groupId === owner.group?.groupId,
      );
    } else if (run.media || run.modelClip) {
      const resource = run.media
        ? catalog.surfaces?.find((item) => item.surfaceId === run.media!.surfaceId && item.hasVideo)
        : catalog.nodes?.find((item) => item.nodeId === run.modelClip!.modelNodeId && item.model);
      requireValue(resource);
      requireValue(
        resource.owner?.presentation !== undefined
          ? owner.presentation !== undefined
          : resource.owner?.group?.groupId === owner.group?.groupId,
      );
    } else throw new Error("unsupported-runtime-run");
  }
  timelineProperties(catalog, view);
  if (view.progression.transitioning) {
    const blocking = view.progression.transitioning.blockingRunIds ?? [];
    requireValue(blocking.length > 0 && view.progression.transitioning.pendingNext);
    const seen = new Set<number>();
    for (const value of blocking) {
      const key = runKey(value);
      requireValue(
        !seen.has(key) &&
          view.activeRuns?.some((run) => runKey(run.runId) === key && run.completion === 1),
      );
      seen.add(key);
    }
  }
  const currentGroup = groupExited ? null : view.progression.currentGroupId;
  const owned = (owner: { group?: { groupId?: string }; presentation?: object } | undefined) =>
    owner?.presentation !== undefined || owner?.group?.groupId === currentGroup;
  const nodes = (catalog.nodes ?? []).filter((node) => owned(node.owner));
  const surfaces = (catalog.surfaces ?? []).filter((surface) => owned(surface.owner));
  const variableIds = new Set<string>();
  for (const definition of catalog.variables ?? []) {
    id(definition.variableId);
    requireValue(
      !variableIds.has(definition.variableId) && [1, 2, 3, 4].includes(definition.type ?? 0),
    );
    requireValue(
      definition.owner &&
        (definition.owner.presentation !== undefined || definition.owner.group?.groupId),
    );
    variableIds.add(definition.variableId);
  }
  validateVariables(
    view.variables,
    (catalog.variables ?? []).filter((variable) => owned(variable.owner)),
  );
  requireValue(!nodes.some((node) => node.parent?.presenterAnchor !== undefined));
  requireValue(
    (view.nodeStates?.length ?? 0) === nodes.length &&
      (view.surfaceStates?.length ?? 0) === surfaces.length,
  );
  let previous = "";
  for (const node of view.nodeStates ?? []) {
    id(node.nodeId);
    requireValue(node.nodeId > previous && nodes.some((item) => item.nodeId === node.nodeId));
    previous = node.nodeId;
  }
  previous = "";
  for (const surface of view.surfaceStates ?? []) {
    id(surface.surfaceId);
    requireValue(surface.surfaceId > previous);
    previous = surface.surfaceId;
    requireValue(
      (!surface.transitionRunId ||
        view.activeRuns?.some(
          (run) =>
            run.surfaceTransition?.surfaceId === surface.surfaceId &&
            runKey(run.runId) === runKey(surface.transitionRunId),
        )) &&
        surfaces.some(
          (item) =>
            item.surfaceId === surface.surfaceId &&
            item.reachableStateIds?.includes(surface.stateId ?? ""),
        ),
    );
  }
  const portable = toParticipantView(view);
  const videoIds = surfaces
    .filter((item) => item.hasVideo && !canceledMedia.has(item.surfaceId!))
    .map((item) => item.surfaceId!);
  const modelIds = nodes
    .filter((item) => item.model && !canceledModels.has(item.nodeId!))
    .map((item) => item.nodeId!);
  requireValue(
    Object.keys(portable.mediaStates).length === videoIds.length &&
      Object.keys(portable.modelClipStates).length === modelIds.length,
  );
  const playbackValid = (clock: { kind: string; referenceRuntimeTimeMilliseconds?: number }) =>
    requireValue(
      clock.kind !== "playing" ||
        clock.referenceRuntimeTimeMilliseconds! <= uint(view.clock?.runtimeTimeMs),
    );
  const clipValid = (nodeId: string, clipId: string, position?: number) => {
    const definitions =
      catalog.modelClips?.filter((item) => item.modelNodeId === nodeId && item.clipId === clipId) ??
      [];
    requireValue(definitions.length === 1 && uint(definitions[0]!.durationMs) > 0);
    if (position !== undefined) requireValue(position <= uint(definitions[0]!.durationMs));
  };
  for (const [surfaceId, media] of Object.entries(portable.mediaStates)) {
    requireValue(videoIds.includes(surfaceId));
    if (media.kind === "active") {
      const run = portable.activeRuns.find(
        (item) =>
          item.kind === "media" &&
          item.surfaceId === surfaceId &&
          item.runId.runSequence === media.runId.runSequence,
      );
      requireValue(
        run?.kind === "media" && JSON.stringify(run.playback) === JSON.stringify(media.playback),
      );
      playbackValid(media.playback);
    }
  }
  for (const [nodeId, model] of Object.entries(portable.modelClipStates)) {
    requireValue(modelIds.includes(nodeId));
    if (model.kind === "heldClip")
      clipValid(nodeId, model.clip.clipId, model.clip.positionMilliseconds);
    if (model.kind === "heldBlend") {
      clipValid(nodeId, model.from.clipId, model.from.positionMilliseconds);
      clipValid(nodeId, model.to.clipId, model.to.positionMilliseconds);
    }
    if (model.kind === "active")
      requireValue(
        portable.activeRuns.some(
          (run) =>
            run.kind === "modelClip" &&
            run.modelNodeId === nodeId &&
            run.runId.runSequence === model.runId.runSequence,
        ),
      );
  }
  const resourceRuns = new Set<string>();
  for (const run of portable.activeRuns) {
    if (run.kind === "media") {
      const media = portable.mediaStates[run.surfaceId];
      requireValue(media?.kind === "active" && media.runId.runSequence === run.runId.runSequence);
      const key = `media:${run.surfaceId}`;
      requireValue(!resourceRuns.has(key));
      resourceRuns.add(key);
    }
    if (run.kind === "modelClip") {
      const model = portable.modelClipStates[run.modelNodeId];
      requireValue(model?.kind === "active" && model.runId.runSequence === run.runId.runSequence);
      const key = `model:${run.modelNodeId}`;
      requireValue(!resourceRuns.has(key));
      resourceRuns.add(key);
      const clips =
        run.phase.kind === "single"
          ? [run.phase.clip]
          : [run.phase.transition.from, run.phase.transition.to];
      for (const clip of clips) {
        clipValid(run.modelNodeId, clip.clipId);
        playbackValid(clip.playback);
      }
      const target = run.phase.kind === "single" ? run.phase.clip : run.phase.transition.to;
      requireValue(!(target.loop && run.completion === "blocking"));
      if (run.phase.kind === "crossfade") {
        playbackValid(run.phase.transition.transitionClock);
        requireValue(
          !run.phase.transition.fromIsHeld || run.phase.transition.from.playback.kind === "paused",
        );
      }
    }
  }
  return portable;
}
