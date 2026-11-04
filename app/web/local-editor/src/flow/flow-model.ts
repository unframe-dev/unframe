import type { ProjectSnapshot } from "@unframe-dev/contracts/author-http";

export type TimelineDefinition = NonNullable<ProjectSnapshot["definition"]>;
export type FlowGroup = TimelineDefinition["flow"]["groups"][string];
export type FlowCue = FlowGroup["steps"][string]["cues"][number];
export type CueDestination =
  | { kind: "step" | "stay"; stepId: string }
  | { kind: "group"; groupId: string; stepId: string }
  | { kind: "end" };
export type StepEdge = {
  fromStepId: string;
  cueId: string;
  conditional: boolean;
  target: CueDestination;
  label: string;
};

const compareId = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function cueDestination(
  definition: TimelineDefinition,
  stepId: string,
  cue: FlowCue,
): CueDestination {
  switch (cue.next.kind) {
    case "stay":
      return { kind: "stay", stepId };
    case "step":
      return { kind: "step", stepId: cue.next.stepId };
    case "group":
      return {
        kind: "group",
        groupId: cue.next.groupId,
        stepId: definition.flow.groups[cue.next.groupId]!.initialStepId,
      };
    case "end":
      return { kind: "end" };
  }
}

export function destinationLabel(target: CueDestination): string {
  switch (target.kind) {
    case "stay":
      return `stay / Step ${target.stepId} に留まる`;
    case "step":
      return `Step ${target.stepId}`;
    case "group":
      return `Group ${target.groupId} / 初期 Step ${target.stepId}`;
    case "end":
      return "end / 終了";
  }
}

function reachableSteps(definition: TimelineDefinition, group: FlowGroup) {
  const visited = new Map<string, Set<string>>();
  const pending = [{ groupId: group.id, stepId: group.initialStepId }];
  while (pending.length) {
    const current = pending.pop()!;
    const steps = visited.get(current.groupId) ?? new Set<string>();
    if (steps.has(current.stepId)) continue;
    steps.add(current.stepId);
    visited.set(current.groupId, steps);
    for (const cue of definition.flow.groups[current.groupId]!.steps[current.stepId]!.cues) {
      const target = cueDestination(definition, current.stepId, cue);
      if (target.kind !== "end")
        pending.push({
          groupId: target.kind === "group" ? target.groupId : current.groupId,
          stepId: target.stepId,
        });
    }
  }
  return visited.get(group.id) ?? new Set<string>();
}

function buildTimelineView(definition: TimelineDefinition) {
  return {
    initialGroupId: definition.flow.initialGroupId,
    groups: Object.values(definition.flow.groups)
      .sort(compareId)
      .map((group) => {
        const reachable = reachableSteps(definition, group);
        const steps = Object.values(group.steps)
          .sort(compareId)
          .map((step) => ({
            ...step,
            reachable: reachable.has(step.id),
            cues: [...step.cues].sort(
              (a, b) => b.priority - a.priority || a.order - b.order || compareId(a, b),
            ),
          }));
        return {
          ...group,
          steps,
          edges: steps.flatMap((step) =>
            step.cues.map((cue): StepEdge => {
              const target = cueDestination(definition, step.id, cue);
              return {
                fromStepId: step.id,
                cueId: cue.id,
                conditional: cue.guard !== undefined,
                target,
                label: destinationLabel(target),
              };
            }),
          ),
        };
      }),
  };
}

const timelineViews = new WeakMap<TimelineDefinition, ReturnType<typeof buildTimelineView>>();

// Project definitions are immutable snapshots; replacement snapshots get their own view.
export function createTimelineView(definition: TimelineDefinition) {
  let view = timelineViews.get(definition);
  if (!view) {
    view = buildTimelineView(definition);
    timelineViews.set(definition, view);
  }
  return view;
}

export type TimelineGroupView = ReturnType<typeof buildTimelineView>["groups"][number];

export function cueTimelines(definition: TimelineDefinition, cue: FlowCue) {
  return cue.actions.flatMap((action, actionIndex) =>
    action.kind === "timeline.play"
      ? [
          {
            timeline: definition.flow.timelines[action.timelineId]!,
            completion: action.completion,
            actionIndex,
          },
        ]
      : [],
  );
}

export function triggerTiming(cue: FlowCue): string {
  switch (cue.trigger.kind) {
    case "timer":
      return `Step 開始から ${cue.trigger.afterMilliseconds} ms`;
    case "timelineCompleted":
      return `Timeline ${cue.trigger.timelineId} の完了を待つ依存関係（発火時刻は未確定）`;
    case "mediaCompleted":
      return `Surface ${cue.trigger.surfaceId} の Media 完了待ち（発火時刻は未確定）`;
    case "modelClipCompleted":
      return `Model ${cue.trigger.nodeId} / Clip ${cue.trigger.clipId} の完了待ち（発火時刻は未確定）`;
    default:
      return "手動入力・外部イベントの発火時刻は未確定";
  }
}

const progressionOrders = new WeakMap<TimelineGroupView, TimelineGroupView["steps"]>();

export function progressionSteps(group: TimelineGroupView) {
  const cached = progressionOrders.get(group);
  if (cached) return cached;
  const steps = new Map(group.steps.map((step) => [step.id, step]));
  const visited = new Set<string>();
  const ordered: TimelineGroupView["steps"] = [];
  const visit = (id: string) => {
    const step = steps.get(id);
    if (!step || visited.has(id)) return;
    visited.add(id);
    ordered.push(step);
    for (const cue of step.cues) {
      if (cue.next.kind === "step") visit(cue.next.stepId);
    }
  };
  visit(group.initialStepId);
  for (const step of group.steps) visit(step.id);
  progressionOrders.set(group, ordered);
  return ordered;
}
