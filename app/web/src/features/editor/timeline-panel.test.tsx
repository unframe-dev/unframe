import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assert, expect, it } from "vitest";
import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";
import definitionFixture from "../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import { TimelinePanel } from "./timeline-panel";

type Definition = NonNullable<ProjectSnapshot["definition"]>;
const definition = () => structuredClone(definitionFixture) as unknown as Definition;

it("distinguishes an unavailable definition from an empty Timeline catalog", () => {
  const view = render(<TimelinePanel definition={null} />);
  expect(
    screen.getByText("定義を取得できていません。読み込み状態と診断を確認してください。"),
  ).toBeInTheDocument();
  view.rerender(<TimelinePanel definition={definition()} />);
  expect(screen.getByText("Timeline は定義されていません。")).toBeInTheDocument();
});

const revealDefinition = () => {
  const project = definition();
  project.flow.timelines.reveal = {
    id: "reveal",
    owner: { kind: "group", groupId: "intro" },
    durationMilliseconds: 1000,
    tracks: [
      {
        target: { nodeId: "node-baked", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "cubicIn" },
          { timeMilliseconds: 250, value: 0.5, easingToNext: "cubicOut" },
          { timeMilliseconds: 251, value: 0.6, easingToNext: "linear" },
          { timeMilliseconds: 1000, value: 1 },
        ],
      },
      {
        target: { nodeId: "node-baked", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 1, 2], easingToNext: "linear" },
          { timeMilliseconds: 1000, value: [3, 4, 5] },
        ],
      },
      {
        target: { nodeId: "node-baked", property: "transform.rotation" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 0, 0, 1], easingToNext: "linear" },
          { timeMilliseconds: 1000, value: [0, 1, 0, 0] },
        ],
      },
    ],
  };
  return project;
};

it("shows a shared duration ruler and places every track's markers at proportional times", () => {
  render(<TimelinePanel definition={revealDefinition()} />);
  expect(screen.getByText("所有: group / intro")).toBeInTheDocument();
  expect(screen.getByText("長さ: 1000 ms")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "時間目盛 0–1000 ms" })).toBeInTheDocument();
  const lane = screen.getByRole("img", { name: "node-baked / opacity のキー位置" });
  expect(lane.querySelectorAll("polygon")).toHaveLength(4);
  expect(lane.querySelector('[data-time-ms="0"]')).toHaveAttribute("transform", "translate(20 20)");
  expect(lane.querySelector('[data-time-ms="250"]')).toHaveAttribute(
    "transform",
    "translate(260 20)",
  );
  const closeMarker = lane.querySelector('[data-time-ms="251"]');
  const closePosition = closeMarker?.getAttribute("transform")?.match(/^translate\(([\d.]+)/)?.[1];
  expect(Number(closePosition)).toBeCloseTo(260.96);
  expect(lane.querySelector('[data-time-ms="1000"]')).toHaveAttribute(
    "transform",
    "translate(980 20)",
  );
  expect(screen.getAllByRole("img", { name: /のキー位置/ })).toHaveLength(3);
});

it("exposes exact scalar, vector and quaternion values and outgoing easing in keyboard-accessible details", async () => {
  const user = userEvent.setup();
  render(<TimelinePanel definition={revealDefinition()} />);
  const summary = screen.getByText("node-baked / opacity のキーフレーム (4)");
  summary.focus();
  await user.keyboard("{Enter}");
  const table = screen.getByRole("table", { name: "node-baked / opacity のキーフレーム" });
  expect(within(table).getByRole("row", { name: "250 ms 0.5 cubicOut" })).toBeInTheDocument();
  expect(
    within(table).getByRole("row", { name: "1000 ms 1 なし（最終キー）" }),
  ).toBeInTheDocument();
  await user.click(screen.getByText("node-baked / transform.position のキーフレーム (2)"));
  expect(screen.getByRole("cell", { name: "[0, 1, 2]" })).toBeInTheDocument();
  await user.click(screen.getByText("node-baked / transform.rotation のキーフレーム (2)"));
  expect(screen.getByRole("cell", { name: "[0, 0, 0, 1]" })).toBeInTheDocument();
});

it("selects a Timeline and reflects replacement definitions without retaining old tracks", async () => {
  const project = revealDefinition();
  const reveal = project.flow.timelines.reveal;
  assert.isDefined(reveal);
  project.flow.timelines.exit = {
    ...structuredClone(reveal),
    id: "exit",
    owner: { kind: "presentation" },
    durationMilliseconds: 2000,
  };
  for (const track of project.flow.timelines.exit.tracks) {
    const finalKeyframe = track.keyframes.at(-1);
    assert.isDefined(finalKeyframe);
    finalKeyframe.timeMilliseconds = 2000;
  }
  const view = render(<TimelinePanel definition={project} />);
  await userEvent
    .setup()
    .selectOptions(screen.getByRole("combobox", { name: "Timeline を選択" }), "exit");
  expect(screen.getByRole("heading", { name: "exit" })).toBeInTheDocument();
  expect(screen.getByText("所有: presentation")).toBeInTheDocument();
  expect(screen.getByText("長さ: 2000 ms")).toBeInTheDocument();
  const next = structuredClone(project);
  const exit = next.flow.timelines.exit;
  assert.isDefined(exit);
  exit.durationMilliseconds = 3000;
  exit.tracks = [
    {
      target: { nodeId: "node-native", property: "transform.scale" },
      keyframes: [
        { timeMilliseconds: 0, value: [1, 1, 1], easingToNext: "linear" },
        { timeMilliseconds: 3000, value: [2, 2, 2] },
      ],
    },
  ];
  view.rerender(<TimelinePanel definition={next} />);
  expect(screen.getByRole("combobox")).toHaveValue("exit");
  expect(screen.getByRole("img", { name: "時間目盛 0–3000 ms" })).toBeInTheDocument();
  expect(
    screen.queryByRole("img", { name: "node-baked / opacity のキー位置" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "node-native / transform.scale のキー位置" }),
  ).toBeInTheDocument();
});

it("falls back when the selected Timeline disappears and clears unavailable or empty catalogs", async () => {
  const project = revealDefinition();
  const reveal = project.flow.timelines.reveal;
  assert.isDefined(reveal);
  project.flow.timelines.exit = { ...structuredClone(reveal), id: "exit" };
  const view = render(<TimelinePanel definition={project} />);
  await userEvent.setup().selectOptions(screen.getByRole("combobox"), "exit");
  view.rerender(<TimelinePanel definition={revealDefinition()} />);
  expect(screen.getByRole("combobox")).toHaveValue("reveal");
  expect(screen.queryByRole("heading", { name: "exit" })).not.toBeInTheDocument();
  view.rerender(<TimelinePanel definition={null} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  view.rerender(<TimelinePanel definition={definition()} />);
  expect(screen.getByText("Timeline は定義されていません。")).toBeInTheDocument();
  view.rerender(<TimelinePanel definition={project} />);
  expect(screen.getByRole("combobox")).toHaveValue("reveal");
});
