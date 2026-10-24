import {
  decodeWireMessage,
  encodeWireMessage,
  type ConnectionSnapshotEnvelopeWire,
  type ControlServerItemWire,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
  type ParticipantRuntimeViewWire,
  type RuntimeProjectionFenceWire,
  type StateServerItemWire,
  type RuntimeRunSnapshotWire,
  type RuntimeRunIdWire,
  type ProjectedVariableDefinitionWire,
  type VariableStateWire,
} from "@unframe/contracts/presentation";
import { toParticipantView } from "./wire-view";
import { assertViewerDelivery, assertViewerInputs } from "./viewer-policy";
import { evaluateAnimationView } from "./animation-view";

export interface RuntimeStoreSnapshot {
  phase: "awaiting-snapshot" | "ready" | "resync-required" | "ended";
  view: ParticipantRuntimeView | null;
  reliableSequence: string;
  stateSequence: string;
  stateSync: "awaiting-keyframe" | "ready";
  reason: string | null;
}

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error("invalid-runtime-input");
}
function uint(value: string | undefined): number {
  const text = value ?? "0";
  requireValue(/^(0|[1-9][0-9]*)$/.test(text));
  const number = Number(text);
  requireValue(Number.isSafeInteger(number) && number >= 0);
  return number;
}
function id(value: string | undefined): asserts value is string {
  requireValue(
    typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= 128,
  );
}
function cloneWire<T extends object>(type: string, value: T): T {
  return decodeWireMessage(type, encodeWireMessage(type, value)) as T;
}
function sameWire(type: string, a: object | undefined, b: object | undefined): boolean {
  if (!a || !b) return false;
  const first = encodeWireMessage(type, a);
  const second = encodeWireMessage(type, b);
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}

function validateVariables(
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

export function createRuntimeStore(inputDelivery: DeliveryManifestWire) {
  const delivery = cloneWire("unframe.delivery.DeliveryManifest", inputDelivery);
  assertViewerDelivery(delivery);
  const profile = delivery.projectionProfile;
  requireValue(
    profile?.projectionProfileId &&
      profile.runtimeCatalog &&
      delivery.projectionInstance &&
      delivery.publication,
  );
  const catalog = profile.runtimeCatalog;
  let state: RuntimeStoreSnapshot = {
    phase: "awaiting-snapshot",
    view: null,
    reliableSequence: "0",
    stateSequence: "0",
    stateSync: "awaiting-keyframe",
    reason: null,
  };
  let wireView: ParticipantRuntimeViewWire | null = null;
  let connectionId: string | null = null;
  let projectionPending = false;
  let stateConnected = false;
  let groupChange: "exited" | "entered" | null = null;
  let maximumRunSequence = 0;
  const canceledMedia = new Set<string>();
  const canceledModels = new Set<string>();
  const fail = () => {
    wireView = null;
    state = {
      phase: "resync-required",
      view: null,
      reliableSequence: "0",
      stateSequence: "0",
      stateSync: "awaiting-keyframe",
      reason: "runtime-input-requires-resync",
    };
  };
  const checkFence = (fence: RuntimeProjectionFenceWire | undefined, origin = true) => {
    requireValue(
      fence &&
        fence.sessionId === delivery.sessionId &&
        fence.projectionProfileId === profile.projectionProfileId,
    );
    requireValue(
      uint(fence.assignmentEpoch) === uint(delivery.projectionInstance!.assignmentEpoch),
    );
    requireValue(
      sameWire("unframe.presentation.PublicationFence", fence.publication, delivery.publication),
    );
    if (origin)
      requireValue(
        wireView &&
          uint(fence.presentationOriginVersion) === uint(wireView.presentationOrigin?.version),
      );
  };
  const runKey = (runId: RuntimeRunIdWire | undefined) => {
    requireValue(
      runId &&
        uint(runId.assignmentEpoch) === uint(delivery.projectionInstance!.assignmentEpoch) &&
        uint(runId.runSequence) > 0,
    );
    return uint(runId.runSequence);
  };
  const timelineFor = (run: RuntimeRunSnapshotWire) =>
    catalog.timelines?.find((timeline) => timeline.timelineId === run.timeline?.timelineId);
  const properties = (view: ParticipantRuntimeViewWire) => {
    const result = new Set<string>();
    for (const run of view.activeRuns ?? []) {
      if (!run.timeline) continue;
      const definition = timelineFor(run);
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
  };
  const validateView = (view: ParticipantRuntimeViewWire) => {
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
        const surface = view.surfaceStates?.find(
          (value) => value.surfaceId === transition.surfaceId,
        );
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
          ? catalog.surfaces?.find(
              (item) => item.surfaceId === run.media!.surfaceId && item.hasVideo,
            )
          : catalog.nodes?.find((item) => item.nodeId === run.modelClip!.modelNodeId && item.model);
        requireValue(resource);
        requireValue(
          resource.owner?.presentation !== undefined
            ? owner.presentation !== undefined
            : resource.owner?.group?.groupId === owner.group?.groupId,
        );
      } else throw new Error("unsupported-runtime-run");
    }
    properties(view);
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
    const currentGroup = groupChange === "exited" ? null : view.progression.currentGroupId;
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
        catalog.modelClips?.filter(
          (item) => item.modelNodeId === nodeId && item.clipId === clipId,
        ) ?? [];
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
            !run.phase.transition.fromIsHeld ||
              run.phase.transition.from.playback.kind === "paused",
          );
        }
      }
    }
    return portable;
  };
  const addRun = (run: RuntimeRunSnapshotWire, time: number) => {
    requireValue(wireView && uint(run.startedAtRuntimeTimeMs) === time);
    const key = runKey(run.runId);
    requireValue(key > maximumRunSequence);
    maximumRunSequence = key;
    const cause = run.cause;
    requireValue(
      cause &&
        cause.groupId === wireView.progression!.currentGroupId &&
        uint(cause.groupEntryEpoch) === uint(wireView.progression!.groupEntryEpoch) &&
        cause.stepId === wireView.progression!.currentStepId &&
        uint(cause.stepEntryEpoch) === uint(wireView.progression!.stepEntryEpoch),
    );
    wireView.activeRuns = [...(wireView.activeRuns ?? []), run];
  };
  const findRun = (runId: RuntimeRunIdWire | undefined) => {
    requireValue(wireView);
    const run = wireView.activeRuns?.find((value) => runKey(value.runId) === runKey(runId));
    requireValue(run);
    return run;
  };
  const removeRun = (run: RuntimeRunSnapshotWire) => {
    requireValue(wireView);
    wireView.activeRuns = wireView.activeRuns!.filter((value) => value !== run);
    const transitioning = wireView.progression!.transitioning;
    if (transitioning) {
      transitioning.blockingRunIds = (transitioning.blockingRunIds ?? []).filter(
        (value) => runKey(value) !== runKey(run.runId),
      );
      if (!transitioning.blockingRunIds.length) {
        const { transitioning: _old, ...progression } = wireView.progression!;
        wireView.progression = { ...progression, stable: {} };
      }
    }
  };
  const sameRunIdentity = (old: RuntimeRunSnapshotWire, next: RuntimeRunSnapshotWire) =>
    sameWire("unframe.presentation.RuntimeRunOwner", old.owner, next.owner) &&
    sameWire("unframe.presentation.RuntimeRunCause", old.cause, next.cause) &&
    old.completion === next.completion &&
    uint(old.startedAtRuntimeTimeMs) === uint(next.startedAtRuntimeTimeMs);
  const commitTimeline = (run: RuntimeRunSnapshotWire, time: number) => {
    requireValue(wireView);
    const effective = evaluateAnimationView(delivery, toParticipantView(wireView), time).view;
    for (const track of timelineFor(run)!.tracks ?? []) {
      const target = track.target!;
      const node = wireView.nodeStates!.find((value) => value.nodeId === target.nodeId)!;
      const value = effective.nodeStates[target.nodeId!]!;
      if (target.property === 1) node.opacity = value.opacity;
      else {
        const property = ({ 2: "position", 3: "rotation", 4: "scale" } as const)[
          target.property as 2 | 3 | 4
        ];
        requireValue(property);
        node.transform = { ...node.transform!, [property]: value.transform[property] };
      }
    }
  };
  const publish = () => {
    requireValue(wireView);
    wireView.baseReliableSequence = state.reliableSequence;
    const view = validateView(wireView);
    state = {
      ...state,
      phase: view.clock.lifecycle.kind === "terminating" ? "ended" : "ready",
      view: groupChange ? null : view,
    };
  };
  const applySnapshot = (envelope: ConnectionSnapshotEnvelopeWire) => {
    requireValue(state.phase === "awaiting-snapshot");
    requireValue(envelope.schemaVersion === 2);
    id(envelope.connectionId);
    requireValue(connectionId === null || connectionId === envelope.connectionId);
    requireValue(
      sameWire(
        "unframe.presentation.ProjectionInstance",
        envelope.projectionInstance,
        delivery.projectionInstance,
      ),
    );
    checkFence(envelope.fence, false);
    const snapshot = envelope.snapshot;
    const view = snapshot?.runtimeView;
    requireValue(view && snapshot);
    const cursor = uint(envelope.reliableSequence);
    requireValue(
      snapshot.projectionProfileId === profile.projectionProfileId &&
        view.projectionProfileId === profile.projectionProfileId,
    );
    requireValue(
      uint(snapshot.assignmentEpoch) === uint(delivery.projectionInstance!.assignmentEpoch) &&
        uint(view.assignmentEpoch) === uint(delivery.projectionInstance!.assignmentEpoch),
    );
    requireValue(
      uint(snapshot.reliableSequence) === cursor && uint(view.baseReliableSequence) === cursor,
    );
    requireValue(
      view.presentationOrigin &&
        uint(view.presentationOrigin.version) === uint(envelope.fence?.presentationOriginVersion),
    );
    const presence = new Set<string>();
    for (const participant of envelope.presenceAtCut?.participants ?? []) {
      id(participant.participantId);
      requireValue(
        !presence.has(participant.participantId) && [1, 2].includes(participant.role ?? 0),
      );
      presence.add(participant.participantId);
    }
    validateView(view);
    maximumRunSequence = Math.max(0, ...(view.activeRuns ?? []).map((run) => runKey(run.runId)));
    wireView = view;
    connectionId = envelope.connectionId;
    projectionPending = false;
    stateConnected = false;
    groupChange = null;
    state = {
      phase: "ready",
      view: null,
      reliableSequence: String(cursor),
      stateSequence: "0",
      stateSync: "awaiting-keyframe",
      reason: null,
    };
    publish();
  };
  return {
    getSnapshot(): RuntimeStoreSnapshot {
      return structuredClone(state);
    },
    reset() {
      wireView = null;
      connectionId = null;
      projectionPending = false;
      stateConnected = false;
      groupChange = null;
      maximumRunSequence = 0;
      canceledMedia.clear();
      canceledModels.clear();
      state = {
        phase: "awaiting-snapshot",
        view: null,
        reliableSequence: "0",
        stateSequence: "0",
        stateSync: "awaiting-keyframe",
        reason: null,
      };
    },
    applyControl(input: ControlServerItemWire): void {
      if (state.phase === "resync-required" || state.phase === "ended") return;
      try {
        const item = cloneWire("unframe.realtime.ControlServerItem", input);
        if (item.connected) {
          requireValue(connectionId === null && item.connected.protocolVersion === "v2");
          id(item.connected.connectionId);
          requireValue(
            item.connected.progressionContractVersion ===
              delivery.capabilityProfile?.contractVersions?.progression,
          );
          requireValue(
            sameWire(
              "unframe.presentation.ProjectionInstance",
              item.connected.projectionInstance,
              delivery.projectionInstance,
            ),
          );
          connectionId = item.connected.connectionId;
          return;
        }
        if (item.connectionSnapshot) {
          applySnapshot(item.connectionSnapshot);
          return;
        }
        requireValue(state.phase === "ready" && wireView);
        if (item.projectionAdvance) {
          checkFence(item.projectionAdvance.fence);
          requireValue(
            !projectionPending &&
              uint(item.projectionAdvance.fromExclusive) === uint(state.reliableSequence),
          );
          const next = uint(item.projectionAdvance.throughSequence);
          requireValue(next > uint(state.reliableSequence));
          state.reliableSequence = String(next);
          projectionPending = true;
          publish();
          return;
        }
        if (item.stateConnectionNonce) {
          requireValue(!projectionPending);
          return;
        }
        const event = item.reliableEvent;
        requireValue(event);
        checkFence(event.fence);
        requireValue(uint(event.sequence) === uint(state.reliableSequence) + 1);
        id(event.eventId);
        const time = uint(event.occurredAtRuntimeTimeMs);
        requireValue(time >= uint(wireView.clock?.runtimeTimeMs));
        if (groupChange === "exited") requireValue(event.groupEntered);
        if (groupChange === "entered") requireValue(event.stepEntered);
        if (event.groupExited) {
          const exit = event.groupExited;
          requireValue(
            !groupChange &&
              exit.groupId === wireView.progression!.currentGroupId &&
              uint(exit.groupEntryEpoch) === uint(wireView.progression!.groupEntryEpoch) &&
              !(wireView.activeRuns ?? []).some(
                (run) => run.owner?.group?.groupId === exit.groupId,
              ),
          );
          const exitingNodes = new Set(
            (catalog.nodes ?? [])
              .filter((node) => node.owner?.group?.groupId === exit.groupId)
              .map((node) => node.nodeId),
          );
          const exitingSurfaces = new Set(
            (catalog.surfaces ?? [])
              .filter((surface) => surface.owner?.group?.groupId === exit.groupId)
              .map((surface) => surface.surfaceId),
          );
          wireView.nodeStates = (wireView.nodeStates ?? []).filter(
            (node) => !exitingNodes.has(node.nodeId),
          );
          wireView.surfaceStates = (wireView.surfaceStates ?? []).filter(
            (surface) => !exitingSurfaces.has(surface.surfaceId),
          );
          const exitingVariables = new Set(
            (catalog.variables ?? [])
              .filter((variable) => variable.owner?.group?.groupId === exit.groupId)
              .map((variable) => variable.variableId),
          );
          wireView.variables = (wireView.variables ?? []).filter(
            (variable) => !exitingVariables.has(variable.variableId),
          );
          wireView.mediaStates = (wireView.mediaStates ?? []).filter(
            (entry) => !exitingSurfaces.has(entry.surfaceId),
          );
          wireView.modelClipStates = (wireView.modelClipStates ?? []).filter(
            (entry) => !exitingNodes.has(entry.modelNodeId),
          );
          canceledMedia.clear();
          canceledModels.clear();
          groupChange = "exited";
          state.stateSync = "awaiting-keyframe";
        } else if (event.groupEntered) {
          const entry = event.groupEntered;
          const initialization = entry.initialization;
          id(entry.groupId);
          requireValue(
            groupChange === "exited" &&
              initialization &&
              uint(entry.groupEntryEpoch) === uint(wireView.progression!.groupEntryEpoch) + 1,
          );

          const ownedNodes = (catalog.nodes ?? []).filter(
            (node) => node.owner?.group?.groupId === entry.groupId,
          );
          const ownedSurfaces = (catalog.surfaces ?? []).filter(
            (surface) => surface.owner?.group?.groupId === entry.groupId,
          );
          const ownedVariables = (catalog.variables ?? []).filter(
            (variable) => variable.owner?.group?.groupId === entry.groupId,
          );
          validateVariables(initialization.variables, ownedVariables);
          wireView.variables = [
            ...(wireView.variables ?? []),
            ...(initialization.variables ?? []),
          ].sort((a, b) => (a.variableId! < b.variableId! ? -1 : 1));
          const nodes = initialization.nodeStates ?? [];
          const surfaces = initialization.surfaceStates ?? [];
          requireValue(
            nodes.length === ownedNodes.length && surfaces.length === ownedSurfaces.length,
          );
          let previous = "";
          for (const node of nodes) {
            id(node.nodeId);
            requireValue(
              node.nodeId > previous && ownedNodes.some((owned) => owned.nodeId === node.nodeId),
            );
            previous = node.nodeId;
          }
          previous = "";
          for (const surface of surfaces) {
            id(surface.surfaceId);
            requireValue(
              surface.surfaceId > previous &&
                ownedSurfaces.some((owned) => owned.surfaceId === surface.surfaceId),
            );
            previous = surface.surfaceId;
          }
          wireView.nodeStates = [...(wireView.nodeStates ?? []), ...nodes].sort((a, b) =>
            a.nodeId! < b.nodeId! ? -1 : 1,
          );
          wireView.surfaceStates = [...(wireView.surfaceStates ?? []), ...surfaces].sort((a, b) =>
            a.surfaceId! < b.surfaceId! ? -1 : 1,
          );
          wireView.mediaStates = [
            ...(wireView.mediaStates ?? []),
            ...(initialization.mediaStates ?? []),
          ].sort((a, b) => (a.surfaceId! < b.surfaceId! ? -1 : 1));
          wireView.modelClipStates = [
            ...(wireView.modelClipStates ?? []),
            ...(initialization.modelClipStates ?? []),
          ].sort((a, b) => (a.modelNodeId! < b.modelNodeId! ? -1 : 1));
          wireView.progression = {
            ...wireView.progression!,
            currentGroupId: entry.groupId,
            groupEntryEpoch: entry.groupEntryEpoch!,
          };
          groupChange = "entered";
        } else if (event.timelineStarted) {
          const started = event.timelineStarted;
          id(started.timelineId);
          const { timelineId, ...run } = started;
          addRun({ ...run, timeline: { timelineId } }, time);
        } else if (event.timelineCompleted || event.timelineCanceled) {
          const ended = event.timelineCompleted ?? event.timelineCanceled!;
          const run = findRun(ended.runId);
          requireValue(run.timeline && run.timeline.timelineId === ended.timelineId);
          if (event.timelineCompleted)
            requireValue(
              time >= uint(run.startedAtRuntimeTimeMs) + uint(timelineFor(run)?.durationMs),
            );
          if (event.timelineCanceled) {
            requireValue([1, 2, 3].includes(event.timelineCanceled.reason ?? 0));
            if (event.timelineCanceled.reason === 2)
              requireValue(run.owner?.group?.groupId === wireView.progression!.currentGroupId);
          }
          if (event.timelineCanceled?.reason !== 3) commitTimeline(run, time);
          removeRun(run);
        } else if (event.surfaceTransitionStarted) {
          const started = event.surfaceTransitionStarted;
          const run = started.run;
          const surface = wireView.surfaceStates?.find(
            (value) => value.surfaceId === started.surfaceId,
          );
          requireValue(
            run?.surfaceTransition &&
              surface &&
              !surface.transitionRunId &&
              surface.stateId === started.fromStateId,
          );
          requireValue(sameWire("unframe.presentation.RuntimeRunId", run.runId, started.runId));
          const transition = run.surfaceTransition;
          requireValue(
            transition.surfaceId === started.surfaceId &&
              transition.fromStateId === started.fromStateId &&
              transition.toStateId === started.stateId &&
              uint(transition.durationMs) === uint(started.durationMs) &&
              transition.easing === started.easing &&
              uint(run.startedAtRuntimeTimeMs) === uint(started.startedAtRuntimeTimeMs),
          );
          id(started.stateId);
          wireView.surfaceStates = wireView.surfaceStates!.map((value) =>
            value === surface
              ? { ...value, stateId: started.stateId!, transitionRunId: started.runId! }
              : value,
          );
          addRun(run, time);
        } else if (event.surfaceTransitionCompleted) {
          const completed = event.surfaceTransitionCompleted;
          const run = findRun(completed.runId);
          const transition = run.surfaceTransition;
          const surface = wireView.surfaceStates?.find(
            (value) => value.surfaceId === completed.surfaceId,
          );
          requireValue(
            transition &&
              surface &&
              transition.surfaceId === completed.surfaceId &&
              transition.toStateId === completed.stateId &&
              surface.transitionRunId &&
              runKey(surface.transitionRunId) === runKey(run.runId),
          );
          requireValue(time >= uint(run.startedAtRuntimeTimeMs) + uint(transition.durationMs));
          id(completed.stateId);
          wireView.surfaceStates = wireView.surfaceStates!.map((value) =>
            value === surface
              ? { surfaceId: surface.surfaceId!, stateId: completed.stateId! }
              : value,
          );
          removeRun(run);
        } else if (
          event.mediaStarted ||
          event.mediaPaused ||
          event.mediaResumed ||
          event.mediaSeeked
        ) {
          const change =
            event.mediaStarted ?? event.mediaPaused ?? event.mediaResumed ?? event.mediaSeeked!;
          const run = change.run;
          requireValue(
            run?.media &&
              run.media.surfaceId === change.surfaceId &&
              sameWire("unframe.presentation.RuntimeRunId", run.runId, change.runId),
          );
          const media = wireView.mediaStates?.find((entry) => entry.surfaceId === change.surfaceId);
          requireValue(media);
          if (event.mediaStarted) {
            requireValue(
              media.stopped &&
                run.media.playback?.playing &&
                sameWire(
                  "unframe.realtime.PlaybackClock",
                  run.media.playback,
                  event.mediaStarted.playback,
                ),
            );
            addRun(run, time);
          } else {
            const old = findRun(change.runId);
            requireValue(
              old.media?.surfaceId === change.surfaceId &&
                media.active &&
                sameRunIdentity(old, run),
            );
            if (event.mediaPaused)
              requireValue(
                old.media!.playback?.playing &&
                  run.media.playback?.paused &&
                  (run.media.playback.paused.positionMs ?? 0) ===
                    (event.mediaPaused.positionMs ?? 0),
              );
            if (event.mediaResumed)
              requireValue(
                old.media!.playback?.paused &&
                  sameWire("unframe.realtime.PlaybackClock", run.media.playback, {
                    playing: event.mediaResumed.playback!,
                  }),
              );
            if (event.mediaSeeked)
              requireValue(
                sameWire(
                  "unframe.realtime.PlaybackClock",
                  run.media.playback,
                  event.mediaSeeked.playback,
                ),
              );
            wireView.activeRuns = wireView.activeRuns!.map((entry) =>
              entry === old ? run : entry,
            );
          }
          wireView.mediaStates = wireView.mediaStates!.map((entry) =>
            entry === media
              ? {
                  surfaceId: change.surfaceId!,
                  active: { runId: run.runId!, playback: run.media!.playback! },
                }
              : entry,
          );
        } else if (event.mediaStoppedSeeked) {
          const change = event.mediaStoppedSeeked;
          const media = wireView.mediaStates?.find((entry) => entry.surfaceId === change.surfaceId);
          requireValue(media?.stopped);
          media.stopped.heldPositionMs = change.heldPositionMs ?? 0;
        } else if (event.mediaStopped || event.mediaCompleted || event.mediaCanceled) {
          const change = event.mediaStopped ?? event.mediaCompleted ?? event.mediaCanceled!;
          const run = findRun(change.runId);
          requireValue(run.media?.surfaceId === change.surfaceId);
          const media = wireView.mediaStates?.find((entry) => entry.surfaceId === change.surfaceId);
          requireValue(media?.active);
          if (event.mediaCanceled) {
            requireValue([1, 2].includes(event.mediaCanceled.reason ?? 0));
            if (event.mediaCanceled.reason === 1) {
              requireValue(run.owner?.group?.groupId === wireView.progression!.currentGroupId);
              canceledMedia.add(change.surfaceId!);
              wireView.mediaStates = wireView.mediaStates!.filter((entry) => entry !== media);
            } else
              wireView.mediaStates = wireView.mediaStates!.map((entry) =>
                entry === media
                  ? { surfaceId: change.surfaceId!, stopped: { heldPositionMs: 0 } }
                  : entry,
              );
          } else {
            const held =
              event.mediaStopped?.heldPositionMs ?? event.mediaCompleted?.heldPositionMs ?? 0;
            requireValue(Number.isFinite(held) && held >= 0);
            wireView.mediaStates = wireView.mediaStates!.map((entry) =>
              entry === media
                ? {
                    surfaceId: change.surfaceId!,
                    stopped: { heldPositionMs: event.mediaCompleted ? 0 : held },
                  }
                : entry,
            );
          }
          removeRun(run);
        } else if (
          event.modelClipStarted ||
          event.modelClipPaused ||
          event.modelClipResumed ||
          event.modelClipCrossfadeStarted ||
          event.modelClipCrossfadeCompleted
        ) {
          const change =
            event.modelClipStarted ??
            event.modelClipPaused ??
            event.modelClipResumed ??
            event.modelClipCrossfadeStarted ??
            event.modelClipCrossfadeCompleted!;
          const run = change.run;
          requireValue(
            run?.modelClip &&
              run.modelClip.modelNodeId === change.modelNodeId &&
              sameWire("unframe.presentation.RuntimeRunId", run.runId, change.runId),
          );
          const model = wireView.modelClipStates?.find(
            (entry) => entry.modelNodeId === change.modelNodeId,
          );
          requireValue(model);
          if (event.modelClipStarted)
            requireValue(
              sameWire(
                "unframe.realtime.ClipPlayback",
                run.modelClip.single,
                event.modelClipStarted.playback,
              ),
            );
          if (event.modelClipCrossfadeStarted)
            requireValue(
              sameWire(
                "unframe.realtime.ModelClipCrossfade",
                run.modelClip.crossfade,
                event.modelClipCrossfadeStarted.crossfade,
              ),
            );
          if (event.modelClipCrossfadeCompleted)
            requireValue(
              sameWire(
                "unframe.realtime.ClipPlayback",
                run.modelClip.single,
                event.modelClipCrossfadeCompleted.playback,
              ),
            );
          if (event.modelClipStarted || event.modelClipCrossfadeStarted) {
            if (model.active) removeRun(findRun(model.active.runId));
            addRun(run, time);
          } else {
            const old = findRun(change.runId);
            requireValue(
              model.active &&
                old.modelClip?.modelNodeId === change.modelNodeId &&
                sameRunIdentity(old, run),
            );
            const phase = run.modelClip;
            if (event.modelClipPaused) {
              requireValue(
                phase.single
                  ? phase.single.playback?.paused
                  : phase.crossfade?.transitionClock?.paused &&
                      phase.crossfade.to?.playback?.paused &&
                      phase.crossfade.from?.playback?.paused,
              );
            }
            if (event.modelClipResumed) {
              requireValue(
                phase.single
                  ? phase.single.playback?.playing
                  : phase.crossfade?.transitionClock?.playing &&
                      phase.crossfade.to?.playback?.playing &&
                      (phase.crossfade.fromIsHeld || phase.crossfade.from?.playback?.playing),
              );
            }
            if (event.modelClipCrossfadeCompleted) {
              const transition = old.modelClip!.crossfade;
              requireValue(
                transition?.transitionClock?.playing &&
                  sameWire("unframe.realtime.ClipPlayback", transition.to, phase.single),
              );
              const clock = transition.transitionClock.playing;
              requireValue(
                (clock.positionAtReferenceMs ?? 0) + time - uint(clock.referenceRuntimeTimeMs) >=
                  uint(transition.durationMs),
              );
            }
            wireView.activeRuns = wireView.activeRuns!.map((entry) =>
              entry === old ? run : entry,
            );
          }
          wireView.modelClipStates = wireView.modelClipStates!.map((entry) =>
            entry === model
              ? { modelNodeId: change.modelNodeId!, active: { runId: run.runId! } }
              : entry,
          );
        } else if (event.modelClipStopped || event.modelClipCompleted || event.modelClipCanceled) {
          const change =
            event.modelClipStopped ?? event.modelClipCompleted ?? event.modelClipCanceled!;
          const run = findRun(change.runId);
          requireValue(run.modelClip?.modelNodeId === change.modelNodeId);
          const model = wireView.modelClipStates?.find(
            (entry) => entry.modelNodeId === change.modelNodeId,
          );
          requireValue(model?.active);
          if (event.modelClipCanceled) {
            requireValue([1, 2].includes(event.modelClipCanceled.reason ?? 0));
            if (event.modelClipCanceled.reason === 1) {
              requireValue(run.owner?.group?.groupId === wireView.progression!.currentGroupId);
              canceledModels.add(change.modelNodeId!);
              wireView.modelClipStates = wireView.modelClipStates!.filter(
                (entry) => entry !== model,
              );
            } else
              wireView.modelClipStates = wireView.modelClipStates!.map((entry) =>
                entry === model ? { modelNodeId: change.modelNodeId!, defaultPose: {} } : entry,
              );
          } else {
            const clip = event.modelClipCompleted?.heldPose ?? event.modelClipStopped?.clip;
            const blend = event.modelClipStopped?.blend;
            requireValue(Boolean(clip) !== Boolean(blend));
            wireView.modelClipStates = wireView.modelClipStates!.map((entry) =>
              entry === model
                ? clip
                  ? { modelNodeId: change.modelNodeId!, heldClip: clip }
                  : { modelNodeId: change.modelNodeId!, heldBlend: blend! }
                : entry,
            );
          }
          removeRun(run);
        } else if (event.variableChanged) {
          const variable = event.variableChanged.state;
          requireValue(variable);
          const index =
            wireView.variables?.findIndex((old) => old.variableId === variable.variableId) ?? -1;
          requireValue(index >= 0);
          wireView.variables![index] = variable;
        } else if (event.nodeStateCommitted) {
          const node = event.nodeStateCommitted.state;
          requireValue(node);
          const index = wireView.nodeStates?.findIndex((old) => old.nodeId === node.nodeId) ?? -1;
          requireValue(index >= 0);
          wireView.nodeStates![index] = node;
        } else if (event.surfaceStateChanged) {
          const change = event.surfaceStateChanged;
          const surface = wireView.surfaceStates?.find((old) => old.surfaceId === change.surfaceId);
          requireValue(
            surface &&
              !surface.transitionRunId &&
              surface.stateId === change.fromStateId &&
              change.stateId,
          );
          surface.stateId = change.stateId;
        } else if (event.presentationOriginChanged) {
          const origin = event.presentationOriginChanged.origin;
          requireValue(
            origin && uint(origin.version) === uint(wireView.presentationOrigin?.version) + 1,
          );
          wireView.presentationOrigin = origin;
        } else if (event.runtimeStatusChanged) {
          wireView.clock = { runtimeTimeMs: String(time), ...event.runtimeStatusChanged };
        } else if (event.presentationEnded) {
          requireValue((event.presentationEnded.reason ?? 0) > 0);
          wireView.clock = {
            runtimeTimeMs: String(time),
            terminating: { reason: event.presentationEnded.reason! },
          };
        } else if (event.stepEntered) {
          const step = event.stepEntered;
          const progression = wireView.progression!;
          requireValue(
            step.groupId === progression.currentGroupId &&
              uint(step.groupEntryEpoch) === uint(progression.groupEntryEpoch),
          );
          requireValue(
            uint(step.stepEntryEpoch) === uint(progression.stepEntryEpoch) + 1 &&
              uint(step.enteredAtRuntimeTimeMs) === time,
          );
          id(step.stepId);
          groupChange = null;
          wireView.progression = {
            currentGroupId: progression.currentGroupId!,
            groupEntryEpoch: progression.groupEntryEpoch!,
            currentStepId: step.stepId,
            stepEntryEpoch: step.stepEntryEpoch!,
            stepEnteredAtRuntimeTimeMs: String(time),
            stable: {},
          };
        } else if (event.logicalInputAccepted) {
          id(event.logicalInputAccepted.logicalEventName);
        } else if (event.cueAccepted) {
          const cue = event.cueAccepted;
          id(cue.cueId);
          requireValue(
            cue.groupId === wireView.progression!.currentGroupId &&
              cue.stepId === wireView.progression!.currentStepId,
          );
        } else if (event.surfaceInteractionAccepted) {
          id(event.surfaceInteractionAccepted.interactionId);
          requireValue(
            wireView.surfaceStates?.some(
              (surface) => surface.surfaceId === event.surfaceInteractionAccepted!.surfaceId,
            ),
          );
        } else if (event.participantPresenceChanged) {
          id(event.participantPresenceChanged.participantId);
          requireValue([1, 2].includes(event.participantPresenceChanged.role ?? 0));
        } else throw new Error("unsupported-runtime-event");
        if (
          event.timelineStarted ||
          event.timelineCompleted ||
          event.timelineCanceled ||
          event.surfaceTransitionStarted ||
          event.surfaceTransitionCompleted
        ) {
          state.stateSync = "awaiting-keyframe";
        }
        wireView.clock = { ...wireView.clock!, runtimeTimeMs: String(time) };
        state.reliableSequence = String(uint(event.sequence));
        projectionPending = false;
        publish();
      } catch {
        fail();
      }
    },
    applyState(input: StateServerItemWire): void {
      if (state.phase === "resync-required" || state.phase === "ended") return;
      try {
        const item = cloneWire("unframe.realtime.StateServerItem", input);
        requireValue(state.phase === "ready" && wireView);
        if (item.connected) {
          requireValue(
            !stateConnected &&
              state.stateSequence === "0" &&
              item.connected.connectionId === connectionId,
          );
          stateConnected = true;
          return;
        }
        if (groupChange) {
          state.stateSync = "awaiting-keyframe";
          return;
        }
        const frame = item.stateFrame;
        requireValue(frame);
        requireValue([1, 2].includes(frame.kind ?? 0));
        const sequence = uint(frame.frameSequence);
        requireValue(sequence > 0);
        if (sequence <= uint(state.stateSequence)) return;
        try {
          checkFence(frame.fence);
        } catch {
          state.stateSync = "awaiting-keyframe";
          return;
        }
        // Independent streams can deliver a State cut before or after its matching Control cut.
        if (
          uint(frame.baseReliableSequence) !== uint(state.reliableSequence) ||
          (frame.kind === 2 &&
            (state.stateSync !== "ready" || sequence !== uint(state.stateSequence) + 1))
        ) {
          state.stateSync = "awaiting-keyframe";
          return;
        }
        requireValue(!frame.anchorBindings?.length);
        const elements = frame.elements ?? [];
        if (frame.kind === 1) requireValue(elements.length === wireView.nodeStates?.length);
        const ownedProperties = properties(wireView);
        let previous = "";
        for (const element of elements) {
          id(element.elementId);
          requireValue(element.elementId > previous);
          previous = element.elementId;
          const node = wireView.nodeStates?.find((value) => value.nodeId === element.elementId);
          const patch = element.node;
          requireValue(node && patch && Object.keys(patch).length > 0);
          requireValue(!patch.transform || Object.keys(patch.transform).length > 0);
          const owns = (property: number) =>
            ownedProperties.has(`${element.elementId}:${property}`);
          requireValue(
            !(owns(1) && patch.opacity !== undefined) &&
              !(owns(2) && patch.transform?.position) &&
              !(owns(3) && patch.transform?.rotation) &&
              !(owns(4) && patch.transform?.scale),
          );
          if (frame.kind === 1)
            requireValue(
              patch.active !== undefined &&
                patch.visible !== undefined &&
                (owns(1) || patch.opacity !== undefined) &&
                (owns(2) || patch.transform?.position) &&
                (owns(3) || patch.transform?.rotation) &&
                (owns(4) || patch.transform?.scale),
            );
          if (patch.active !== undefined) node.active = patch.active;
          if (patch.visible !== undefined) node.visible = patch.visible;
          if (patch.opacity !== undefined) node.opacity = patch.opacity;
          if (patch.transform) node.transform = { ...node.transform!, ...patch.transform };
        }
        state.stateSequence = String(sequence);
        state.stateSync = "ready";
        publish();
      } catch {
        fail();
      }
    },
  };
}
