import {
  runtimeAuthorityVersions,
  type ConnectionSnapshotEnvelopeWire,
  type ControlServerItemWire,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
  type ParticipantRuntimeViewWire,
  type RuntimeProjectionFenceWire,
  type StateServerItemWire,
  type RuntimeRunSnapshotWire,
  type RuntimeRunIdWire,
} from "@unframe/contracts/presentation";
import { toParticipantView } from "./wire-view";
import { assertViewerDelivery, assertViewerRuntimeCapabilities } from "./viewer-policy";
import { evaluateAnimationView } from "./animation-view";
import { requireValue, uint, id, cloneWire, sameWire } from "./runtime-input";
import {
  runtimeRunSequence,
  runtimeTimeline,
  timelineProperties,
  validateRuntimeView,
  validateVariables,
} from "./runtime-view-validation";

export interface RuntimeStoreSnapshot {
  phase: "awaiting-snapshot" | "ready" | "resync-required" | "ended";
  view: ParticipantRuntimeView | null;
  reliableSequence: string;
  stateSequence: string;
  stateSync: "awaiting-keyframe" | "ready";
  reason: string | null;
}

export interface RuntimeCoreState {
  snapshot: RuntimeStoreSnapshot;
  wireView: ParticipantRuntimeViewWire | null;
  connectionId: string | null;
  projectionPending: boolean;
  stateConnected: boolean;
  groupChange: "exited" | "entered" | null;
  maximumRunSequence: number;
  canceledMedia: Set<string>;
  canceledModels: Set<string>;
}

export type RuntimeAction =
  | { kind: "control"; item: ControlServerItemWire }
  | { kind: "state"; item: StateServerItemWire }
  | { kind: "restart-state" }
  | { kind: "reset" };

export function createRuntimeState(): RuntimeCoreState {
  return {
    snapshot: {
      phase: "awaiting-snapshot",
      view: null,
      reliableSequence: "0",
      stateSequence: "0",
      stateSync: "awaiting-keyframe",
      reason: null,
    },
    wireView: null,
    connectionId: null,
    projectionPending: false,
    stateConnected: false,
    groupChange: null,
    maximumRunSequence: 0,
    canceledMedia: new Set(),
    canceledModels: new Set(),
  };
}

export function createRuntimeReducer(inputDelivery: DeliveryManifestWire) {
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
  return (previous: RuntimeCoreState, action: RuntimeAction): RuntimeCoreState => {
    if (action.kind === "reset") return createRuntimeState();
    let state = { ...previous.snapshot };
    let wireView = previous.wireView ? structuredClone(previous.wireView) : null;
    let { connectionId, projectionPending, stateConnected, groupChange, maximumRunSequence } =
      previous;
    const canceledMedia = new Set(previous.canceledMedia);
    const canceledModels = new Set(previous.canceledModels);
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
    const runKey = (runId: RuntimeRunIdWire | undefined) =>
      runtimeRunSequence(delivery.projectionInstance!.assignmentEpoch, runId);
    const timelineFor = (run: RuntimeRunSnapshotWire) => runtimeTimeline(catalog, run);
    const validateView = (view: ParticipantRuntimeViewWire) =>
      validateRuntimeView(view, {
        catalog,
        assignmentEpoch: delivery.projectionInstance!.assignmentEpoch,
        groupExited: groupChange === "exited",
        canceledMedia,
        canceledModels,
      });
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
      requireValue(envelope.schemaVersion === runtimeAuthorityVersions.snapshot);
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
    const actions = {
      restartState(): void {
        if (state.phase !== "ready") return;
        stateConnected = false;
        state.stateSequence = "0";
        state.stateSync = "awaiting-keyframe";
      },
      applyControl(input: ControlServerItemWire): void {
        if (state.phase === "resync-required" || state.phase === "ended") return;
        try {
          const item = cloneWire("unframe.realtime.ControlServerItem", input);
          if (item.connected) {
            requireValue(
              connectionId === null &&
                item.connected.protocolVersion === runtimeAuthorityVersions.protocol,
            );
            assertViewerRuntimeCapabilities(item.connected.requiredCapabilities);
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
          if (event.runtimeViewReplaced) {
            const replacement = event.runtimeViewReplaced.runtimeView;
            requireValue(
              replacement &&
                replacement.projectionProfileId === profile.projectionProfileId &&
                uint(replacement.assignmentEpoch) ===
                  uint(delivery.projectionInstance!.assignmentEpoch) &&
                uint(replacement.baseReliableSequence) === uint(event.sequence) &&
                uint(replacement.presentationOrigin?.version) ===
                  uint(wireView.presentationOrigin?.version) &&
                uint(replacement.clock?.runtimeTimeMs) === time,
            );
            canceledMedia.clear();
            canceledModels.clear();
            validateRuntimeView(replacement, {
              catalog,
              assignmentEpoch: delivery.projectionInstance!.assignmentEpoch,
            });
            wireView = replacement;
            maximumRunSequence = Math.max(
              maximumRunSequence,
              ...(replacement.activeRuns ?? []).map((run) => runKey(run.runId)),
            );
            groupChange = null;
            projectionPending = false;
            state.reliableSequence = String(uint(event.sequence));
            state.stateSync = "awaiting-keyframe";
            publish();
            return;
          }
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
            wireView.surfaceStates = [...(wireView.surfaceStates ?? []), ...surfaces].sort(
              (a, b) => (a.surfaceId! < b.surfaceId! ? -1 : 1),
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
            const media = wireView.mediaStates?.find(
              (entry) => entry.surfaceId === change.surfaceId,
            );
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
            const media = wireView.mediaStates?.find(
              (entry) => entry.surfaceId === change.surfaceId,
            );
            requireValue(media?.stopped);
            media.stopped.heldPositionMs = change.heldPositionMs ?? 0;
          } else if (event.mediaStopped || event.mediaCompleted || event.mediaCanceled) {
            const change = event.mediaStopped ?? event.mediaCompleted ?? event.mediaCanceled!;
            const run = findRun(change.runId);
            requireValue(run.media?.surfaceId === change.surfaceId);
            const media = wireView.mediaStates?.find(
              (entry) => entry.surfaceId === change.surfaceId,
            );
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
          } else if (
            event.modelClipStopped ||
            event.modelClipCompleted ||
            event.modelClipCanceled
          ) {
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
            const surface = wireView.surfaceStates?.find(
              (old) => old.surfaceId === change.surfaceId,
            );
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
          } else if (event.gestureInputAccepted) {
            requireValue(
              [1, 2, 3, 4, 5, 6, 7, 8].includes(event.gestureInputAccepted.gesture ?? 0),
            );
          } else if (event.zoneInputAccepted) {
            id(event.zoneInputAccepted.zoneId);
            requireValue([1, 2].includes(event.zoneInputAccepted.edge ?? 0));
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
                item.connected.connectionId === connectionId &&
                uint(item.connected.nextStateFrameSequence) > 0,
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
          const ownedProperties = timelineProperties(catalog, wireView);
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
    if (action.kind === "control") actions.applyControl(action.item);
    else if (action.kind === "state") actions.applyState(action.item);
    else actions.restartState();
    return {
      snapshot: state,
      wireView,
      connectionId,
      projectionPending,
      stateConnected,
      groupChange,
      maximumRunSequence,
      canceledMedia,
      canceledModels,
    };
  };
}
