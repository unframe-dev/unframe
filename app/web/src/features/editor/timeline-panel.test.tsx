import { render, screen } from "@testing-library/react";
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

it("waits for explicit Cue selection after selecting a Step", async () => {
  render(<TimelinePanel definition={definition()} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Step start" }));
  expect(screen.getByRole("button", { name: "Cue wave" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("region", { name: "Cue 詳細" })).not.toBeInTheDocument();
});
