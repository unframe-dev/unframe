import { cueTimelines, type FlowCue, type TimelineDefinition } from "../flow/flow-model";
export const timePosition = (time: number, duration: number) =>
  duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;
export const timeAtPosition = (position: number, width: number, duration: number) =>
  width > 0 ? Math.round(Math.max(0, Math.min(1, position / width)) * duration) : 0;

function buildCueTimelineView(definition: TimelineDefinition, cue: FlowCue) {
  const timelines = cueTimelines(definition, cue);
  const surfaces = cue.actions.flatMap((action, index) =>
    action.kind === "surface.setState" && action.transition?.kind === "crossfade"
      ? [
          {
            id: `${action.surfaceId}/${index}`,
            duration: action.transition.durationMilliseconds,
            completion: action.transition.completion,
          },
        ]
      : [],
  );
  return {
    timelines,
    surfaces,
    duration: Math.max(
      0,
      ...timelines.map((t) => t.timeline.durationMilliseconds),
      ...surfaces.map((t) => t.duration),
    ),
  };
}

const cueViews = new WeakMap<
  TimelineDefinition,
  WeakMap<FlowCue, ReturnType<typeof buildCueTimelineView>>
>();

export function cueTimelineView(definition: TimelineDefinition, cue: FlowCue) {
  let views = cueViews.get(definition);
  if (!views) {
    views = new WeakMap();
    cueViews.set(definition, views);
  }
  let view = views.get(cue);
  if (!view) {
    view = buildCueTimelineView(definition, cue);
    views.set(cue, view);
  }
  return view;
}
