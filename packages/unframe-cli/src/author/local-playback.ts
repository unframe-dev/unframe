import type { PresentationDefinition, RenderBundle } from "@unframe/contracts/presentation";
import {
  advanceCueClock,
  createCueState,
  executeCueEvent,
  runtimeRunDeadline,
  type CueInput,
  type CueCapture,
  type CueState,
} from "@unframe/unframe-core";
import { AuthorError } from "./contract.js";
import type {
  CueOccurrence,
  PreviewPlaybackCommand,
  PreviewPlaybackResponse,
} from "./preview-contract.js";
import { projectPlaybackWire } from "./playback-wire.js";

type Cue = PresentationDefinition["flow"]["groups"][string]["steps"][string]["cues"][number];
const cueInput = (cue: Cue, causeEventId: string): CueInput | undefined => {
  const base = { payload: {}, causeEventId };
  const actor = { kind: "participant", role: "presenter" } as const;
  switch (cue.trigger.kind) {
    case "logicalInput":
      return { ...base, actor, kind: "logicalInput", action: cue.trigger.action };
    case "semanticEvent":
      return {
        ...base,
        actor:
          cue.trigger.actor.kind === "presenter"
            ? actor
            : { kind: "system", source: cue.trigger.actor.source ?? "runtime" },
        kind: "semanticEvent",
        event: cue.trigger.event,
      };
    case "surfaceInteraction":
      return {
        ...base,
        actor,
        kind: "surfaceInteraction",
        surfaceId: cue.trigger.surfaceId,
        interactionId: cue.trigger.interactionId,
      };
    default:
      return undefined;
  }
};

export const createLocalPlayback = ({
  requestId,
  definition,
  renderBundle,
  visibleNodeIds,
  visibleSurfaceIds,
  visibleTimelineIds,
  now,
}: {
  requestId: string;
  definition: PresentationDefinition;
  renderBundle?: RenderBundle;
  visibleNodeIds: ReadonlySet<string>;
  visibleSurfaceIds: ReadonlySet<string>;
  visibleTimelineIds: ReadonlySet<string>;
  now: () => number;
}) => {
  let runEpoch = 1;
  let state = createCueState(definition, runEpoch, renderBundle);
  let sequence = 0n;
  let playing = false;
  let referenceTime = now();
  let referenceRuntimeTime = 0;
  let occurrenceSequence = 0;
  type Recorded = { metadata: CueOccurrence; checkpoint: CueState };
  const occurrences = new Map<string, Recorded>();
  const inspectionIds = new Map<string, string>();
  type Inspection = {
    inspectionId: string;
    occurrence: Recorded;
    normal: CueState;
    offset: number;
  };
  let inspection: Inspection | undefined;
  let lastResponse: PreviewPlaybackResponse | undefined;
  type Checkpoint = {
    state: CueState;
    inspection: Inspection | undefined;
    occurrences: Array<[string, Recorded]>;
  };
  let lastGood: Checkpoint | undefined;
  let pending: Checkpoint | undefined;
  let acknowledgedSequence: string | undefined;
  const copy = <T>(value: T): T => structuredClone(value);
  const reject = (message: string): never => {
    throw new AuthorError(409, "preview-inspection-unavailable", message);
  };
  const record = (capture: CueCapture) => {
    const checkpoint = copy(capture.state);
    const durationMilliseconds = Math.max(
      0,
      ...checkpoint.activeRuns
        .filter(
          (run) =>
            (run.kind === "timeline"
              ? visibleTimelineIds.has(run.timelineId)
              : run.kind === "modelClip"
                ? visibleNodeIds.has(run.modelNodeId)
                : visibleSurfaceIds.has(run.surfaceId)) &&
            run.cause.causeEventId === capture.causeEventId &&
            run.cause.cueId === capture.cueId &&
            run.startedAtRuntimeTimeMilliseconds === checkpoint.runtimeTimeMilliseconds,
        )
        .map((run) => runtimeRunDeadline(definition, checkpoint, run))
        .filter(Number.isFinite)
        .map((deadline) => Math.max(0, deadline - checkpoint.runtimeTimeMilliseconds)),
    );
    const metadata: CueOccurrence = {
      occurrenceId: `${requestId}:${++occurrenceSequence}`,
      cueId: capture.cueId,
      groupId: checkpoint.currentGroupId,
      stepId: checkpoint.currentStepId,
      groupEntryEpoch: checkpoint.groupEntryEpoch,
      stepEntryEpoch: checkpoint.stepEntryEpoch,
      runtimeTimeMilliseconds: checkpoint.runtimeTimeMilliseconds,
      durationMilliseconds,
    };
    occurrences.set(JSON.stringify([metadata.groupId, metadata.stepId, metadata.cueId]), {
      metadata,
      checkpoint,
    });
  };
  const advanceNormal = (to: number) => {
    const advanced = advanceCueClock(definition, state, to, { capture: true });
    for (const capture of advanced.captures) record(capture);
    state = advanced.state;
  };
  const setOffset = (offset: number) => {
    if (!inspection) return;
    inspection.offset = offset;
    state = copy(inspection.occurrence.checkpoint);
    state.runtimeTimeMilliseconds += offset;
  };
  const availableInputs = () =>
    (definition.flow.groups[state.currentGroupId]?.steps[state.currentStepId]?.cues ?? []).flatMap(
      (cue) => {
        const input = cueInput(cue, `preview:${requestId}:${sequence + 1n}`);
        if (!input) return [];
        const trial = executeCueEvent(definition, state, input);
        return trial.outcome.kind === "accepted" && trial.outcome.cueId === cue.id
          ? [{ cue, input }]
          : [];
      },
    );

  return (command: PreviewPlaybackCommand): PreviewPlaybackResponse => {
    if (command.requestId !== requestId) reject("Preview request is stale.");
    if (command.command === "invalidateDisplay") reject("Preview display requires a new load.");
    if (command.command === "applied") {
      if (
        command.sequence === acknowledgedSequence &&
        command.sequence === lastResponse?.state.sequence
      )
        return copy(lastResponse);
      const confirmed = pending;
      if (!confirmed || command.sequence !== lastResponse?.state.sequence)
        reject("Playback acknowledgement is stale.");
      lastGood = copy(confirmed);
      acknowledgedSequence = command.sequence;
      pending = undefined;
      return copy(lastResponse!);
    }
    if (command.command === "recover") {
      if (!lastGood || command.sequence !== lastResponse?.state.sequence)
        reject("No confirmed playback state is available for recovery.");
      const restored = lastGood ?? reject("No confirmed playback state is available for recovery.");
      state = copy(restored.state);
      inspection = copy(restored.inspection);
      occurrences.clear();
      for (const [key, occurrence] of restored.occurrences) occurrences.set(key, copy(occurrence));
      playing = false;
    }
    if (command.command === "seekCue") {
      if (!inspection || inspection.inspectionId !== command.inspectionId)
        reject("Cue inspection is stale.");
      if (
        !Number.isSafeInteger(command.timeMilliseconds) ||
        command.timeMilliseconds < 0 ||
        command.timeMilliseconds >
          (inspection ?? reject("Cue inspection is stale.")).occurrence.metadata
            .durationMilliseconds
      )
        throw new AuthorError(400, "preview-time-invalid", "Cue inspection time is out of range.");
    }
    if (command.command === "inspectCue") {
      const previous = inspectionIds.get(command.inspectionId);
      if (
        previous &&
        (previous !== command.occurrenceId || inspection?.inspectionId !== command.inspectionId)
      )
        reject("Cue inspection ID has already been used.");
      if (inspection && inspection.inspectionId !== command.inspectionId)
        reject("Leave the current Cue inspection before starting another.");
      if (
        ![...occurrences.values()].some(
          (entry) => entry.metadata.occurrenceId === command.occurrenceId,
        )
      )
        reject("Cue occurrence is no longer available.");
    }
    if (
      command.command === "leaveInspection" &&
      inspection?.inspectionId !== command.inspectionId &&
      (!inspectionIds.has(command.inspectionId) || inspection)
    )
      reject("Cue inspection is stale.");
    if (inspection && (command.command === "input" || command.command === "reset"))
      reject("Normal playback commands are unavailable during Cue inspection.");
    const time = now();
    if (playing && !state.ended) {
      const target = referenceRuntimeTime + Math.max(0, Math.floor(time - referenceTime));
      if (inspection) {
        const duration = inspection.occurrence.metadata.durationMilliseconds;
        const offset = Math.min(
          duration,
          target - inspection.occurrence.checkpoint.runtimeTimeMilliseconds,
        );
        setOffset(offset);
        if (offset === duration) playing = false;
      } else advanceNormal(target);
    }
    switch (command.command) {
      case "play":
        if (
          !playing &&
          !state.ended &&
          (!inspection || inspection.offset < inspection.occurrence.metadata.durationMilliseconds)
        ) {
          playing = true;
          referenceTime = time;
          referenceRuntimeTime = state.runtimeTimeMilliseconds;
          if (!inspection) advanceNormal(state.runtimeTimeMilliseconds);
        }
        break;
      case "pause":
        playing = false;
        break;
      case "reset":
        state = createCueState(definition, ++runEpoch, renderBundle);
        occurrences.clear();
        lastGood = undefined;
        pending = undefined;
        acknowledgedSequence = undefined;
        playing = false;
        referenceTime = time;
        referenceRuntimeTime = 0;
        break;
      case "input": {
        const entry = playing && availableInputs().find(({ cue }) => cue.id === command.cueId);
        if (!entry)
          throw new AuthorError(
            409,
            "preview-input-unavailable",
            "Preview input is not currently executable.",
          );
        const result = executeCueEvent(definition, state, entry.input, { capture: true });
        if (result.capture) record(result.capture);
        state = result.state;
        advanceNormal(state.runtimeTimeMilliseconds);
        break;
      }
      case "inspectCue": {
        if (!inspection) {
          const occurrence =
            [...occurrences.values()].find(
              (entry) => entry.metadata.occurrenceId === command.occurrenceId,
            ) ?? reject("Cue occurrence is no longer available.");
          inspection = {
            inspectionId: command.inspectionId,
            occurrence,
            normal: copy(state),
            offset: 0,
          };
          inspectionIds.set(command.inspectionId, command.occurrenceId);
          playing = false;
          setOffset(0);
        }
        break;
      }
      case "seekCue":
        playing = false;
        setOffset(command.timeMilliseconds);
        break;
      case "leaveInspection":
        if (inspection) {
          state = copy(inspection.normal);
          inspection = undefined;
          playing = false;
        }
        break;
      case "recover":
      case "poll":
        break;
    }
    if (state.ended) playing = false;
    sequence += 1n;
    const response: PreviewPlaybackResponse = {
      state: projectPlaybackWire(
        requestId,
        sequence,
        state,
        playing,
        visibleNodeIds,
        visibleSurfaceIds,
        visibleTimelineIds,
      ),
      mode: inspection ? "inspection" : "normal",
      inspection: inspection
        ? {
            inspectionId: inspection.inspectionId,
            occurrenceId: inspection.occurrence.metadata.occurrenceId,
            timeMilliseconds: inspection.offset,
            durationMilliseconds: inspection.occurrence.metadata.durationMilliseconds,
          }
        : null,
      occurrences: [...occurrences.values()].map((entry) => copy(entry.metadata)),
      inputs: inspection
        ? []
        : availableInputs().map(({ cue }) => ({ cueId: cue.id, label: cue.id })),
      groupId: state.currentGroupId,
      stepId: state.currentStepId,
      ended: state.ended,
    };
    pending = copy({ state, inspection, occurrences: [...occurrences.entries()] });
    lastResponse = response;
    return copy(response);
  };
};
