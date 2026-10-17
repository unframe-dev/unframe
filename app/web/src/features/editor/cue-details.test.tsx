import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { FlowCue } from "./model/timeline-view";
import { CueDetails } from "./cue-details";

it("keeps all action parameters visible and distinguishes immediate updates, crossfades, stopping and completion", () => {
  const cue: FlowCue = {
    id: "inspect",
    priority: 2,
    order: 3,
    trigger: { kind: "timelineCompleted", timelineId: "focus" },
    fixedPayload: { reason: "finished" },
    firePolicy: { kind: "repeatable", cooldownMilliseconds: 120 },
    actions: [
      {
        kind: "surface.setState",
        surfaceId: "screen",
        stateId: "summary",
        transition: {
          kind: "crossfade",
          durationMilliseconds: 400,
          easing: "cubicOut",
          completion: "blocking",
        },
      },
      {
        kind: "surface.setState",
        surfaceId: "screen",
        stateId: "cover",
        transition: { kind: "cut" },
      },
      { kind: "node.patch", nodeId: "model", patch: { opacity: { kind: "literal", value: 0.4 } } },
      { kind: "variable.set", variableId: "counter", value: { kind: "literal", value: 7 } },
      { kind: "timeline.play", timelineId: "focus", completion: "blocking", conflict: "reject" },
      { kind: "timeline.stop", timelineId: "fade" },
      { kind: "media.play", surfaceId: "video" },
      { kind: "media.pause", surfaceId: "video" },
      { kind: "media.seek", surfaceId: "video", positionSeconds: { kind: "literal", value: 1.5 } },
      {
        kind: "modelClip.play",
        nodeId: "model",
        clipId: "wave",
        speed: 2,
        loop: true,
        completion: "nonBlocking",
        transition: { kind: "crossfade", durationMilliseconds: 250, easing: "linear" },
        conflict: "reject",
      },
      { kind: "modelClip.pause", nodeId: "model" },
      { kind: "modelClip.resume", nodeId: "model" },
      { kind: "modelClip.stop", nodeId: "model" },
    ],
    next: { kind: "group", groupId: "finale" },
  };
  render(
    <CueDetails cue={cue} destination={{ kind: "group", groupId: "finale", stepId: "closing" }} />,
  );
  expect(
    screen.getByText("Timeline focus の完了を待つ依存関係（発火時刻は未確定）"),
  ).toBeInTheDocument();
  expect(screen.getByText("120 ms")).toBeInTheDocument();
  expect(screen.getByText("reason")).toBeInTheDocument();
  expect(screen.getByText('"finished"')).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Cue 詳細" }).querySelector("pre")).toBeNull();
  expect(screen.getByText("Group finale / 初期 Step closing")).toBeInTheDocument();
  const actions = screen.getByRole("list", { name: "Actions" });
  expect(within(actions).getAllByRole("listitem")).toHaveLength(13);
  expect(
    within(actions).getByText("crossfade による State 遷移（即時更新ではありません）"),
  ).toBeInTheDocument();
  expect(within(actions).getByText("即時の State 更新")).toBeInTheDocument();
  expect(within(actions).getByText("即時の Node 更新")).toBeInTheDocument();
  expect(within(actions).getByText("即時の Variable 更新")).toBeInTheDocument();
  expect(within(actions).getByText("Timeline fade を停止する action")).toBeInTheDocument();
  expect(within(actions).getByText("1.5")).toBeInTheDocument();
  const clip = within(actions).getByRole("heading", { name: "Model clip を再生" }).closest("li");
  expect(clip).toHaveTextContent("再生速度2 倍");
  expect(clip).toHaveTextContent("ループする");
  expect(clip).toHaveTextContent("250 ms");
  expect(clip).toHaveTextContent("完了を待たない");
  expect(clip).toHaveTextContent("競合時は拒否");
});

const baseCue: FlowCue = {
  id: "details",
  priority: 0,
  order: 0,
  trigger: { kind: "timer", afterMilliseconds: 900 },
  firePolicy: { kind: "oncePerStepEntry" },
  actions: [],
  next: { kind: "stay" },
};

it("opens the selected Timeline without editing the Cue", async () => {
  const onSelectTimeline = vi.fn();
  const cue: FlowCue = {
    ...baseCue,
    actions: [
      { kind: "timeline.play", timelineId: "focus", completion: "nonBlocking", conflict: "reject" },
      { kind: "timeline.play", timelineId: "reveal", completion: "blocking", conflict: "reject" },
    ],
  };
  const original = structuredClone(cue);
  render(
    <CueDetails
      cue={cue}
      destination={{ kind: "stay", stepId: "intro" }}
      onSelectTimeline={onSelectTimeline}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Timeline reveal を時間軸で表示" }));
  expect(onSelectTimeline).toHaveBeenCalledExactlyOnceWith("reveal");
  expect(cue).toEqual(original);
  expect(screen.getByText("条件なし")).toBeInTheDocument();
  expect(screen.getByText("Step 開始から 900 ms")).toBeInTheDocument();
  expect(screen.getByText("Step に入るたびに1回")).toBeInTheDocument();
});

it.each<{ trigger: FlowCue["trigger"]; title: string; details: string[] }>([
  {
    trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
    title: "操作入力",
    details: ["next", "発表者（presenter）"],
  },
  {
    trigger: {
      kind: "semanticEvent",
      event: "remote",
      actor: { kind: "system", source: "runtime" },
    },
    title: "イベント受信",
    details: ["remote", "システム（system） / Runtime（runtime）"],
  },
  {
    trigger: {
      kind: "surfaceInteraction",
      surfaceId: "screen",
      interactionId: "tap",
      actor: { kind: "system" },
    },
    title: "Surface への操作",
    details: ["screen", "tap", "システム（system）"],
  },
  {
    trigger: {
      kind: "zoneEdge",
      actor: { kind: "system", source: "tracking" },
      subject: { kind: "anchor", owner: { kind: "presenter" }, target: "leftHand" },
      zoneId: "stage",
      edge: "exit",
      dwellMilliseconds: 0,
      hysteresisMeters: 0.2,
    },
    title: "Zone から出る",
    details: [
      "stage",
      "退出（exit）",
      "発表者（presenter）の左手（leftHand）",
      "0 ms",
      "0.2 m",
      "システム（system） / 位置追跡（tracking）",
    ],
  },
  {
    trigger: {
      kind: "motion",
      actor: { kind: "system", source: "tracking" },
      subject: { kind: "participant", owner: { kind: "presenter" } },
      minimumDistanceMeters: 0.5,
      windowMilliseconds: 1000,
    },
    title: "移動を検出",
    details: ["発表者（presenter）の参加者（participant）", "0.5 m", "1000 ms"],
  },
  {
    trigger: { kind: "mediaCompleted", surfaceId: "video" },
    title: "Media の完了",
    details: ["video", "Surface video の Media 完了待ち（発火時刻は未確定）"],
  },
  {
    trigger: { kind: "modelClipCompleted", nodeId: "avatar", clipId: "bow" },
    title: "Model clip の完了",
    details: ["avatar", "bow", "Model avatar / Clip bow の完了待ち（発火時刻は未確定）"],
  },
])("shows $title trigger targets and parameters", ({ trigger, title, details }) => {
  render(<CueDetails cue={{ ...baseCue, trigger }} destination={{ kind: "end" }} />);
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  for (const detail of details) expect(screen.getByText(detail)).toBeInTheDocument();
  expect(screen.getByText("この Cue に action はありません。")).toBeInTheDocument();
});

it("shows recursive conditions and every reference without assuming they are satisfied", () => {
  const cue: FlowCue = {
    ...baseCue,
    guard: {
      kind: "all",
      guards: [
        {
          kind: "compare",
          left: { kind: "variable", variableId: "score" },
          operator: "gte",
          right: 5,
        },
        {
          kind: "any",
          guards: [
            {
              kind: "compare",
              left: { kind: "eventPayload", field: "mode" },
              operator: "eq",
              right: "ready",
            },
            {
              kind: "not",
              guard: {
                kind: "compare",
                left: { kind: "surfaceState", surfaceId: "screen" },
                operator: "neq",
                right: "cover",
              },
            },
          ],
        },
        {
          kind: "compare",
          left: { kind: "nodeField", nodeId: "avatar", field: "opacity" },
          operator: "lt",
          right: 0.7,
        },
      ],
    },
  };
  render(<CueDetails cue={cue} destination={{ kind: "end" }} />);
  for (const text of [
    "条件付き（成立は未確定）",
    "すべて満たす",
    "いずれかを満たす",
    "次の条件を満たさない",
    "変数 score ≧（以上） 5",
    'イベント入力 mode ＝（等しい） "ready"',
    'Surface screen の State ≠（異なる） "cover"',
    "Node avatar の不透明度（opacity） ＜（より小さい） 0.7",
  ]) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
});

it("shows referenced action values, false and zero literals, transforms and immediate clip transitions", () => {
  const cue: FlowCue = {
    ...baseCue,
    fixedPayload: { empty: "", missing: null, enabled: false, count: 0 },
    actions: [
      {
        kind: "node.patch",
        nodeId: "avatar",
        patch: {
          active: { kind: "literal", value: false },
          visible: { kind: "variable", variableId: "visibility" },
          opacity: { kind: "eventPayload", field: "alpha" },
          transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [2, 3, 4] },
        },
      },
      {
        kind: "variable.set",
        variableId: "score",
        value: { kind: "eventPayload", field: "points" },
      },
      {
        kind: "media.seek",
        surfaceId: "video",
        positionSeconds: { kind: "variable", variableId: "position" },
      },
      {
        kind: "modelClip.play",
        nodeId: "avatar",
        clipId: "idle",
        speed: 1,
        loop: false,
        completion: "blocking",
        transition: { kind: "immediate" },
        conflict: "reject",
      },
    ],
  };
  render(<CueDetails cue={cue} destination={{ kind: "step", stepId: "closing" }} />);
  const actions = screen.getByRole("list", { name: "Actions" });
  for (const text of [
    "false（偽）",
    "変数 visibility の値",
    "イベント入力 alpha の値",
    "1, 2, 3",
    "0, 0, 0, 1",
    "2, 3, 4",
    "イベント入力 points の値",
    "変数 position の値",
    "即時（immediate）",
    "しない",
    "Run の完了まで遷移を待つ（blocking）",
  ]) {
    expect(within(actions).getByText(text)).toBeInTheDocument();
  }
  expect(screen.getByText('""')).toBeInTheDocument();
  expect(screen.getByText("null（値なし）")).toBeInTheDocument();
  expect(screen.getAllByText("0")).toHaveLength(3);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
