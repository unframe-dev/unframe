import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";
import fixture from "../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import { TimelinePanel } from "./timeline-panel";

type Definition = NonNullable<ProjectSnapshot["definition"]>;
const definition = () => structuredClone(fixture) as unknown as Definition;

it("connects a Timeline action to its track without carrying focus into another Cue", async () => {
  const project = definition();
  const cue = project.flow.groups.intro!.steps.start!.cues[0]!;
  cue.actions = [
    { kind: "timeline.play", timelineId: "focus", completion: "nonBlocking", conflict: "reject" },
  ];
  project.flow.timelines.focus = {
    id: "focus",
    owner: { kind: "presentation" },
    durationMilliseconds: 600,
    tracks: [
      {
        target: { nodeId: "title", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0.72, easingToNext: "cubicOut" },
          { timeMilliseconds: 600, value: 1 },
        ],
      },
    ],
  };
  project.flow.groups.intro!.steps.start!.cues.push({ ...cue, id: "other" });
  const user = userEvent.setup();
  render(<TimelinePanel definition={project} />);
  await user.click(screen.getByRole("button", { name: "Step start" }));
  await user.click(screen.getByRole("button", { name: "Cue wave" }));
  await user.click(screen.getByRole("button", { name: "Timeline focus を時間軸で表示" }));
  expect(screen.getByRole("group", { name: "Timeline focus" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cue 発火から 0 ms" }));
  await user.click(screen.getByRole("button", { name: "Timeline focus を時間軸で表示" }));
  expect(screen.getByRole("group", { name: "Timeline focus" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cue other" }));
  expect(screen.getByRole("group", { name: "Timeline focus" })).not.toHaveFocus();
});

it("opens the initial Group with keyboard-selectable Steps and Cues and exposes all action details", async () => {
  const project = definition();
  const cue = project.flow.groups.intro!.steps.start!.cues[0]!;
  cue.guard = {
    kind: "compare",
    left: { kind: "variable", variableId: "counter" },
    operator: "gte",
    right: 2,
  };
  cue.trigger = { kind: "timer", afterMilliseconds: 500 };
  cue.actions.push({
    kind: "surface.setState",
    surfaceId: "baked",
    stateId: "default",
    transition: {
      kind: "crossfade",
      durationMilliseconds: 700,
      easing: "cubicOut",
      completion: "blocking",
    },
  });
  render(<TimelinePanel definition={project} revision="saved-42" />);
  expect(screen.getByText("定義の保存 revision: saved-42")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Cue wave" })).not.toBeInTheDocument();
  const user = userEvent.setup();
  screen.getByRole("button", { name: "Step start" }).focus();
  await user.keyboard("{Enter}");
  screen.getByRole("button", { name: "Cue wave" }).focus();
  await user.keyboard(" ");
  expect(screen.getByRole("heading", { name: "Cue wave" })).toBeInTheDocument();
  expect(screen.getByText("Step 開始から 500 ms")).toBeInTheDocument();
  expect(screen.getByText("条件付き（成立は未確定）")).toBeInTheDocument();
  const actions = screen.getByRole("list", { name: "Actions" });
  expect(within(actions).getByText("modelClip.play")).toBeInTheDocument();
  expect(within(actions).getByText("surface.setState")).toBeInTheDocument();
  expect(within(actions).getByText("700 ms")).toBeInTheDocument();
  expect(screen.getByText("この Cue に timeline.play はありません。")).toBeInTheDocument();
});

it("preserves selected IDs on saved updates and clears deleted Cues, Steps, Groups and unavailable definitions", async () => {
  const project = definition();
  const extra = structuredClone(project.flow.groups.intro!);
  extra.id = "other";
  project.flow.groups.other = extra;
  const user = userEvent.setup();
  const view = render(<TimelinePanel definition={project} revision="r1" />);
  await user.click(screen.getByRole("button", { name: "Step start" }));
  await user.click(screen.getByRole("button", { name: "Cue wave" }));
  const next = structuredClone(project);
  next.flow.groups.intro!.steps.start!.cues[0]!.priority = 12;
  view.rerender(<TimelinePanel definition={next} revision="r2" />);
  expect(screen.getByRole("button", { name: "Step start" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Cue wave" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("定義の保存 revision: r2")).toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
  const noCue = structuredClone(next);
  noCue.flow.groups.intro!.steps.start!.cues = [
    { ...next.flow.groups.intro!.steps.start!.cues[0]!, id: "replacement" },
  ];
  view.rerender(<TimelinePanel definition={noCue} />);
  expect(screen.queryByRole("heading", { name: "Cue wave" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cue replacement" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  view.rerender(<TimelinePanel definition={next} />);
  expect(screen.getByRole("button", { name: "Cue wave" })).toHaveAttribute("aria-pressed", "false");
  const noStep = structuredClone(next);
  noStep.flow.groups.intro!.initialStepId = "replacement";
  noStep.flow.groups.intro!.steps = { replacement: { id: "replacement", cues: [] } };
  view.rerender(<TimelinePanel definition={noStep} />);
  expect(screen.getByRole("button", { name: "Step replacement" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  view.rerender(<TimelinePanel definition={next} />);
  expect(screen.getByRole("button", { name: "Step start" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const noGroup = structuredClone(next);
  delete noGroup.flow.groups.intro;
  noGroup.flow.initialGroupId = "other";
  view.rerender(<TimelinePanel definition={noGroup} />);
  expect(screen.getByRole("combobox", { name: "Group" })).toHaveValue("");
  view.rerender(<TimelinePanel definition={next} />);
  expect(screen.getByRole("combobox", { name: "Group" })).toHaveValue("");
  await user.selectOptions(screen.getByRole("combobox", { name: "Group" }), "intro");
  await user.click(screen.getByRole("button", { name: "Step start" }));
  await user.click(screen.getByRole("button", { name: "Cue wave" }));
  view.rerender(<TimelinePanel definition={null} revision="invalid" />);
  expect(
    screen.getByText("定義を検証できません。既存の Diagnostics を確認してください。"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cue wave" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "intro の Step と遷移" })).not.toBeInTheDocument();
  view.rerender(<TimelinePanel definition={next} />);
  expect(screen.getByRole("combobox", { name: "Group" })).toHaveValue("");
});

it("allows first load after null and treats Groups and Cue-less Steps as normal empty states", async () => {
  const view = render(<TimelinePanel definition={null} />);
  const project = definition();
  project.flow.groups.intro!.steps.start!.cues = [];
  view.rerender(<TimelinePanel definition={project} />);
  expect(screen.getByRole("combobox", { name: "Group" })).toHaveValue("intro");
  await userEvent.setup().click(screen.getByRole("button", { name: "Step start" }));
  expect(screen.getByText("この Step に Cue はありません。")).toBeInTheDocument();
  project.flow.groups = {};
  view.rerender(<TimelinePanel definition={structuredClone(project)} />);
  expect(screen.getByText("Group は定義されていません。")).toBeInTheDocument();
});

it("shows every transition including Group initial Steps, cycles, stay and end without hiding unreachable nodes", () => {
  const project = definition();
  const cue = project.flow.groups.intro!.steps.start!.cues[0]!;
  project.flow.groups.intro!.steps.start!.cues = [
    { ...cue, id: "branch", next: { kind: "step", stepId: "branch" } },
    { ...cue, id: "leave", next: { kind: "group", groupId: "other" } },
    { ...cue, id: "stay", next: { kind: "stay" } },
    { ...cue, id: "end", next: { kind: "end" } },
  ];
  project.flow.groups.intro!.steps.branch = {
    id: "branch",
    cues: [{ ...cue, id: "back", next: { kind: "step", stepId: "start" } }],
  };
  project.flow.groups.intro!.steps.isolated = { id: "isolated", cues: [] };
  project.flow.groups.other = {
    id: "other",
    initialStepId: "entry",
    steps: { entry: { id: "entry", cues: [] } },
  };
  render(<TimelinePanel definition={project} />);
  expect(screen.getByRole("button", { name: "Step start" })).toHaveAccessibleDescription(
    "初期 Step",
  );
  expect(screen.getByRole("button", { name: "Step isolated" })).toHaveAccessibleDescription(
    "初期 Step から到達不可",
  );
  const transitions = screen.getByRole("list", { name: "Cue の遷移" });
  expect(
    within(transitions).getByText("start → Group other / 初期 Step entry / Cue leave"),
  ).toBeInTheDocument();
  expect(
    within(transitions).getByText("start → stay / Step start に留まる / Cue stay"),
  ).toBeInTheDocument();
  expect(within(transitions).getByText("start → end / 終了 / Cue end")).toBeInTheDocument();
  expect(within(transitions).getByText("branch → Step start / Cue back")).toBeInTheDocument();
  expect(
    screen
      .getByRole("group", { name: "intro の Step と遷移" })
      .querySelectorAll("path[marker-end]"),
  ).toHaveLength(5);
});

it("shows sorted candidate Cues without selecting one automatically", async () => {
  const project = definition();
  const cue = project.flow.groups.intro!.steps.start!.cues[0]!;
  project.flow.groups.intro!.steps.start!.cues = [
    { ...cue, id: "z", priority: 1, order: 1 },
    { ...cue, id: "a", priority: 1, order: 1 },
    { ...cue, id: "last", priority: 0, order: 0 },
    { ...cue, id: "first", priority: 1, order: 0 },
  ];
  render(<TimelinePanel definition={project} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Step start" }));
  const cues = within(screen.getByRole("region", { name: "Cue 一覧" })).getAllByRole("button");
  expect(cues.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Cue first",
    "Cue a",
    "Cue z",
    "Cue last",
  ]);
  expect(cues.every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
});
