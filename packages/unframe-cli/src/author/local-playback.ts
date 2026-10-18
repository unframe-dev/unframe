import type { PresentationDefinition } from "@unframe/contracts/presentation";
import {
  advanceCueClock,
  createCueState,
  executeCueEvent,
  type CueInput,
} from "@unframe/unframe-core";
import { AuthorError } from "./contract.js";
import type { PreviewPlaybackCommand, PreviewPlaybackResponse } from "./preview-contract.js";
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
  visibleNodeIds,
  visibleSurfaceIds,
  visibleTimelineIds,
  now,
}: {
  requestId: string;
  definition: PresentationDefinition;
  visibleNodeIds: ReadonlySet<string>;
  visibleSurfaceIds: ReadonlySet<string>;
  visibleTimelineIds: ReadonlySet<string>;
  now: () => number;
}) => {
  let runEpoch = 1;
  let state = createCueState(definition, runEpoch);
  let sequence = 0n;
  let playing = false;
  let referenceTime = now();
  let referenceRuntimeTime = 0;
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
    const time = now();
    if (playing && !state.ended)
      state = advanceCueClock(
        definition,
        state,
        referenceRuntimeTime + Math.max(0, Math.floor(time - referenceTime)),
      ).state;
    switch (command.command) {
      case "play":
        if (!playing && !state.ended) {
          playing = true;
          referenceTime = time;
          referenceRuntimeTime = state.runtimeTimeMilliseconds;
          state = advanceCueClock(definition, state, state.runtimeTimeMilliseconds).state;
        }
        break;
      case "pause":
        playing = false;
        break;
      case "reset":
        state = createCueState(definition, ++runEpoch);
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
        state = executeCueEvent(definition, state, entry.input).state;
        state = advanceCueClock(definition, state, state.runtimeTimeMilliseconds).state;
        break;
      }
      case "poll":
        break;
    }
    if (state.ended) playing = false;
    sequence += 1n;
    return {
      state: projectPlaybackWire(
        requestId,
        sequence,
        state,
        playing,
        visibleNodeIds,
        visibleSurfaceIds,
        visibleTimelineIds,
      ),
      inputs: availableInputs().map(({ cue }) => ({ cueId: cue.id, label: cue.id })),
      groupId: state.currentGroupId,
      stepId: state.currentStepId,
      ended: state.ended,
    };
  };
};
