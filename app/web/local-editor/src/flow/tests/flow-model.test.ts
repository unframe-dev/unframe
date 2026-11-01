import { expect, it } from "vitest";
import type { ProjectSnapshot } from "@unframe/contracts/author-http";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import { createTimelineView, cueTimelines, triggerTiming, type FlowCue } from "../flow-model";

type Definition = NonNullable<ProjectSnapshot["definition"]>;
it("orders candidate cues by priority, order, then ID without changing the definition", () => {
  const definition = structuredClone(fixture) as unknown as Definition;
  const cue = definition.flow.groups.intro!.steps.start!.cues[0]!;
  definition.flow.groups.intro!.steps.start!.cues = [
    { ...cue, id: "z", priority: 1, order: 1 },
    { ...cue, id: "a", priority: 1, order: 1 },
    { ...cue, id: "last", priority: 0, order: 0 },
    { ...cue, id: "first", priority: 1, order: 0 },
  ];
  const before = structuredClone(definition);
  expect(createTimelineView(definition).groups[0]?.steps[0]?.cues.map((entry) => entry.id)).toEqual(
    ["first", "a", "z", "last"],
  );
  expect(definition).toEqual(before);
});

it("resolves group transitions to initial Steps and keeps cycles, branches, stay, end and unreachable Steps", () => {
  const definition = structuredClone(fixture) as unknown as Definition;
  const cue = definition.flow.groups.intro!.steps.start!.cues[0]!;
  definition.flow.groups.intro!.steps = {
    start: {
      id: "start",
      cues: [
        { ...cue, id: "branch", next: { kind: "step", stepId: "second" } },
        { ...cue, id: "leave", next: { kind: "group", groupId: "other" } },
        { ...cue, id: "stay", next: { kind: "stay" } },
      ],
    },
    second: {
      id: "second",
      cues: [
        { ...cue, id: "back", next: { kind: "step", stepId: "start" } },
        { ...cue, id: "end", next: { kind: "end" } },
      ],
    },
    isolated: { id: "isolated", cues: [] },
  };
  definition.flow.groups.other = {
    id: "other",
    initialStepId: "entry",
    steps: { entry: { id: "entry", cues: [] } },
  };
  const group = createTimelineView(definition).groups.find((entry) => entry.id === "intro");
  expect(group?.steps.map((step) => [step.id, step.reachable])).toEqual([
    ["isolated", false],
    ["second", true],
    ["start", true],
  ]);
  expect(group?.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        cueId: "leave",
        target: { kind: "group", groupId: "other", stepId: "entry" },
        label: "Group other / 初期 Step entry",
      }),
      expect.objectContaining({ cueId: "stay", target: { kind: "stay", stepId: "start" } }),
      expect.objectContaining({ cueId: "end", target: { kind: "end" } }),
      expect.objectContaining({ cueId: "back", target: { kind: "step", stepId: "start" } }),
    ]),
  );
});

it("follows paths through another Group without treating its record order as execution order", () => {
  const definition = structuredClone(fixture) as unknown as Definition;
  const cue = definition.flow.groups.intro!.steps.start!.cues[0]!;
  definition.flow.groups.intro!.initialStepId = "entry";
  definition.flow.groups.intro!.steps.entry = {
    id: "entry",
    cues: [{ ...cue, next: { kind: "group", groupId: "other" } }],
  };
  definition.flow.groups.other = {
    id: "other",
    initialStepId: "foreign",
    steps: {
      foreign: { id: "foreign", cues: [{ ...cue, next: { kind: "group", groupId: "intro" } }] },
    },
  };
  expect(
    createTimelineView(definition)
      .groups.find((group) => group.id === "intro")
      ?.steps.map((step) => [step.id, step.reachable]),
  ).toEqual([
    ["entry", true],
    ["start", false],
  ]);
});

it("expands only timeline.play actions at their action indexes on the same Cue origin", () => {
  const definition = structuredClone(fixture) as unknown as Definition;
  const cue = definition.flow.groups.intro!.steps.start!.cues[0]!;
  definition.flow.timelines.focus = {
    id: "focus",
    owner: { kind: "presentation" },
    durationMilliseconds: 600,
    tracks: [
      {
        target: { nodeId: "node-baked", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0.72, easingToNext: "cubicOut" },
          { timeMilliseconds: 600, value: 1 },
        ],
      },
    ],
  };
  cue.actions = [
    { kind: "timeline.stop", timelineId: "focus" },
    { kind: "timeline.play", timelineId: "focus", completion: "blocking", conflict: "reject" },
    { kind: "timeline.play", timelineId: "focus", completion: "nonBlocking", conflict: "reject" },
  ];
  const timelines = cueTimelines(definition, cue);
  expect(
    timelines.map(({ timeline, actionIndex, completion }) => [
      timeline.id,
      actionIndex,
      completion,
    ]),
  ).toEqual([
    ["focus", 1, "blocking"],
    ["focus", 2, "nonBlocking"],
  ]);
  expect(timelines[0]?.timeline.tracks[0]?.keyframes).toEqual([
    { timeMilliseconds: 0, value: 0.72, easingToNext: "cubicOut" },
    { timeMilliseconds: 600, value: 1 },
  ]);
});

it.each<[FlowCue["trigger"], string]>([
  [{ kind: "timer", afterMilliseconds: 500 }, "Step 開始から 500 ms"],
  [
    { kind: "timelineCompleted", timelineId: "focus" },
    "Timeline focus の完了を待つ依存関係（発火時刻は未確定）",
  ],
  [
    { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
    "手動入力・外部イベントの発火時刻は未確定",
  ],
  [
    { kind: "mediaCompleted", surfaceId: "video" },
    "Surface video の Media 完了待ち（発火時刻は未確定）",
  ],
  [
    { kind: "modelClipCompleted", nodeId: "model", clipId: "wave" },
    "Model model / Clip wave の完了待ち（発火時刻は未確定）",
  ],
])("describes trigger timing without inferring an absolute Cue time: %j", (trigger, expected) => {
  const definition = structuredClone(fixture) as unknown as Definition;
  const cue = definition.flow.groups.intro!.steps.start!.cues[0]!;
  cue.trigger = trigger;
  expect(triggerTiming(cue)).toBe(expected);
});
