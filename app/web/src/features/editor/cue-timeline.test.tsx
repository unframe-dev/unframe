import { render, screen, within } from "@testing-library/react";
import { assert, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";
import { CueTimeline } from "./cue-timeline";

type Timeline = NonNullable<ProjectSnapshot["definition"]>["flow"]["timelines"][string];
const focus = (): Timeline => ({
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
});

it("selects keyframes by keyboard and shows the current value and outgoing easing", async () => {
  const user = userEvent.setup();
  render(
    <CueTimeline timelines={[{ timeline: focus(), completion: "nonBlocking", actionIndex: 0 }]} />,
  );
  const first = screen.getByRole("button", { name: "Cue 発火から 0 ms" });
  first.focus();
  await user.keyboard("{Enter}");
  const details = screen.getByRole("region", { name: "選択したキーフレーム" });
  expect(within(details).getByText("0.72")).toBeInTheDocument();
  expect(within(details).getByText("cubicOut")).toBeInTheDocument();
  expect(first).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Cue 発火から 600 ms" }));
  expect(within(details).getByText("1")).toBeInTheDocument();
  expect(within(details).getByText("なし（最終キー）")).toBeInTheDocument();
});

it("preserves a selected keyframe by Timeline, track and time when objects and array order change", async () => {
  const original = focus();
  const entries = [{ timeline: original, completion: "nonBlocking" as const, actionIndex: 0 }];
  const view = render(<CueTimeline timelines={entries} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Cue 発火から 600 ms" }));
  const updated = structuredClone(original);
  updated.tracks[0]?.keyframes.splice(1, 0, {
    timeMilliseconds: 300,
    value: 0.8,
    easingToNext: "linear",
  });
  const selected = updated.tracks[0]?.keyframes.find(
    (keyframe) => keyframe.timeMilliseconds === 600,
  );
  assert.isDefined(selected);
  selected.value = 0.95;
  updated.tracks.unshift({
    target: { nodeId: "body", property: "transform.rotation" },
    keyframes: [{ timeMilliseconds: 600, value: [0, 0, 0, 1] }],
  });
  view.rerender(
    <CueTimeline
      timelines={[
        { timeline: { ...focus(), id: "other" }, completion: "blocking", actionIndex: 1 },
        { ...entries[0], timeline: updated, completion: "nonBlocking", actionIndex: 0 },
      ]}
    />,
  );
  const details = screen.getByRole("region", { name: "選択したキーフレーム" });
  expect(within(details).getByText("focus / title / opacity")).toBeInTheDocument();
  expect(within(details).getByText("0.95")).toBeInTheDocument();
});

it.each(["keyframe", "track", "property", "timeline"] as const)(
  "clears selection when its %s disappears without selecting another or reviving it",
  async (removed) => {
    const original = focus();
    const entry = { timeline: original, completion: "blocking" as const, actionIndex: 0 };
    const view = render(<CueTimeline timelines={[entry]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cue 発火から 0 ms" }));
    const replacement: Timeline = {
      ...original,
      id: removed === "timeline" ? "replacement" : "focus",
      tracks: [
        {
          target: {
            nodeId: removed === "track" ? "replacement" : "title",
            property: removed === "property" ? "transform.scale" : "opacity",
          },
          keyframes: [{ timeMilliseconds: removed === "keyframe" ? 300 : 0, value: 0.5 }],
        },
      ],
    };
    view.rerender(<CueTimeline timelines={[{ ...entry, timeline: replacement }]} />);
    expect(screen.queryByRole("region", { name: "選択したキーフレーム" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
    view.rerender(<CueTimeline timelines={[entry]} />);
    expect(screen.queryByRole("region", { name: "選択したキーフレーム" })).not.toBeInTheDocument();
  },
);

it("clears selection when all play actions are removed", async () => {
  const entry = { timeline: focus(), completion: "blocking" as const, actionIndex: 0 };
  const view = render(<CueTimeline timelines={[entry]} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Cue 発火から 0 ms" }));
  view.rerender(<CueTimeline timelines={[]} />);
  expect(screen.queryByRole("region", { name: "選択したキーフレーム" })).not.toBeInTheDocument();
  view.rerender(<CueTimeline timelines={[entry]} />);
  expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
});

it("preserves selection when unrelated Cue actions shift play action indexes and order", async () => {
  const view = render(
    <CueTimeline
      timelines={[
        { timeline: focus(), completion: "blocking", actionIndex: 0 },
        { timeline: { ...focus(), id: "other" }, completion: "nonBlocking", actionIndex: 1 },
      ]}
    />,
  );
  const lane = screen.getByRole("group", { name: "focus / title / opacity" });
  await userEvent.setup().click(within(lane).getByRole("button", { name: "Cue 発火から 600 ms" }));
  view.rerender(
    <CueTimeline
      timelines={[
        { timeline: { ...focus(), id: "other" }, completion: "nonBlocking", actionIndex: 2 },
        { timeline: focus(), completion: "blocking", actionIndex: 3 },
      ]}
    />,
  );
  const details = screen.getByRole("region", { name: "選択したキーフレーム" });
  expect(within(details).getByText("focus / title / opacity")).toBeInTheDocument();
  expect(screen.getByRole("button", { pressed: true })).toHaveAccessibleName("Cue 発火から 600 ms");
});

it("shows exact vector values for the selected keyframe", async () => {
  const movement: Timeline = {
    ...focus(),
    tracks: [
      {
        target: { nodeId: "title", property: "transform.position" },
        keyframes: [{ timeMilliseconds: 0, value: [0, 1, 2] }],
      },
    ],
  };
  render(
    <CueTimeline timelines={[{ timeline: movement, completion: "blocking", actionIndex: 0 }]} />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Cue 発火から 0 ms" }));
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  expect(screen.getByText("[0, 1, 2]")).toBeInTheDocument();
});

it("shows a normal empty state when the Cue has no timeline.play actions", () => {
  render(<CueTimeline timelines={[]} />);
  expect(screen.getByText("この Cue に timeline.play はありません。")).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("zooms the shared chart using keyboard controls without changing source data", async () => {
  const timeline = focus();
  const before = structuredClone(timeline);
  render(<CueTimeline timelines={[{ timeline, completion: "blocking", actionIndex: 0 }]} />);
  const zoom = screen.getByRole("combobox", { name: "時間軸のズーム" });
  zoom.focus();
  await userEvent.setup().selectOptions(zoom, "2");
  expect(zoom).toHaveValue("2");
  const scroll = screen.getByLabelText("アニメーション時間軸の横スクロール");
  expect(scroll.firstElementChild).toHaveStyle({ minWidth: "1560px" });
  expect(timeline).toEqual(before);
});

it("aligns multiple Timeline tracks to Cue firing with one maximum duration ruler", () => {
  const movement: Timeline = {
    ...focus(),
    id: "movement",
    durationMilliseconds: 1200,
    tracks: [
      {
        target: { nodeId: "body", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 600, value: [0, 1, 2], easingToNext: "linear" },
          { timeMilliseconds: 1200, value: [3, 4, 5] },
        ],
      },
    ],
  };
  render(
    <CueTimeline
      timelines={[
        { timeline: focus(), completion: "nonBlocking", actionIndex: 0 },
        { timeline: movement, completion: "blocking", actionIndex: 1 },
      ]}
    />,
  );
  expect(
    screen.getByText("Cue 発火からの時間（Step の滞在時間ではありません）"),
  ).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Cue 発火から 0–1200 ms" })).toBeInTheDocument();
  expect(screen.getByText("duration: 600 ms")).toBeInTheDocument();
  expect(screen.getByText("duration: 1200 ms")).toBeInTheDocument();
  expect(screen.getByText("nonBlocking: 完了を待たずに遷移")).toBeInTheDocument();
  expect(screen.getByText("blocking: 開始した Run の完了まで遷移を待機")).toBeInTheDocument();
  const focusLane = screen.getByRole("group", { name: "focus / title / opacity" });
  expect(within(focusLane).getByRole("button", { name: "Cue 発火から 600 ms" })).toHaveStyle({
    left: "50%",
  });
  const movementLane = screen.getByRole("group", { name: "movement / body / transform.position" });
  expect(within(movementLane).getByRole("button", { name: "Cue 発火から 600 ms" })).toHaveStyle({
    left: "50%",
  });
  expect(within(movementLane).getByRole("button", { name: "Cue 発火から 1200 ms" })).toHaveStyle({
    left: "100%",
  });
});
