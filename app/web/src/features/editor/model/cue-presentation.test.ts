import { expect, it } from "vitest";
import type { FlowCue } from "./timeline-view";
import {
  actionPresentation,
  actionValueLabel,
  comparisonLabel,
  scalarLabel,
  triggerPresentation,
} from "./cue-presentation";

it.each([
  [0, "0"],
  [7, "7"],
  ["7", '"7"'],
  [false, "false（偽）"],
  ["false（偽）", '"false（偽）"'],
  [null, "null（値なし）"],
  ["null（値なし）", '"null（値なし）"'],
  ["", '""'],
  ["空文字", '"空文字"'],
  ['say "hello"\nnext', '"say \\"hello\\"\\nnext"'],
] as const)("keeps scalar type and content visible for %j", (value, expected) => {
  expect(scalarLabel(value)).toBe(expected);
});

it("distinguishes literal reference-like text from variable and event references", () => {
  expect(actionValueLabel({ kind: "literal", value: "変数 score の値" })).toBe('"変数 score の値"');
  expect(actionValueLabel({ kind: "variable", variableId: "score" })).toBe("変数 score の値");
  expect(actionValueLabel({ kind: "literal", value: "イベント入力 score の値" })).toBe(
    '"イベント入力 score の値"',
  );
  expect(actionValueLabel({ kind: "eventPayload", field: "score" })).toBe(
    "イベント入力 score の値",
  );
});

it.each<{
  transition: Extract<FlowCue["actions"][number], { kind: "surface.setState" }>["transition"];
  note: string;
  rows: string[][];
}>([
  {
    transition: { kind: "cut" },
    note: "即時の State 更新",
    rows: [["切り替え", "即時（cut）"]],
  },
  {
    transition: {
      kind: "crossfade",
      durationMilliseconds: 400,
      easing: "cubicOut",
      completion: "blocking",
    },
    note: "crossfade による State 遷移（即時更新ではありません）",
    rows: [
      ["切り替え", "クロスフェード（crossfade）"],
      ["所要時間", "400 ms"],
      ["補間", "減速（cubicOut）"],
      ["完了", "Run の完了まで遷移を待つ（blocking）"],
    ],
  },
])("distinguishes State transitions: $note", ({ transition, note, rows }) => {
  const presentation = actionPresentation({
    kind: "surface.setState",
    surfaceId: "screen",
    stateId: "cover",
    transition,
  });
  expect(presentation.note).toBe(note);
  expect(presentation.rows).toEqual([["Surface", "screen"], ["State", "cover"], ...rows]);
});

it.each([
  ["blocking", "Run の完了まで遷移を待つ（blocking）"],
  ["nonBlocking", "完了を待たない（nonBlocking）"],
] as const)("describes %s Timeline completion", (completion, expected) => {
  expect(
    actionPresentation({
      kind: "timeline.play",
      timelineId: "focus",
      completion,
      conflict: "reject",
    }).rows,
  ).toContainEqual(["完了", expected]);
});

it.each<{
  transition: Extract<FlowCue["actions"][number], { kind: "modelClip.play" }>["transition"];
  rows: string[][];
}>([
  { transition: { kind: "immediate" }, rows: [["切り替え", "即時（immediate）"]] },
  {
    transition: { kind: "crossfade", durationMilliseconds: 250, easing: "linear" },
    rows: [
      ["切り替え", "クロスフェード（crossfade）"],
      ["所要時間", "250 ms"],
      ["補間", "一定速度（linear）"],
    ],
  },
])("describes clip transition parameters: $transition.kind", ({ transition, rows }) => {
  const presentation = actionPresentation({
    kind: "modelClip.play",
    nodeId: "model",
    clipId: "wave",
    speed: 2,
    loop: true,
    completion: "nonBlocking",
    transition,
    conflict: "reject",
  });
  expect(presentation.rows).toEqual([
    ["Node", "model"],
    ["Clip", "wave"],
    ["再生速度", "2 倍"],
    ["ループ", "する"],
    ["完了", "完了を待たない（nonBlocking）"],
    ...rows,
    ["競合", "競合時は拒否（reject）"],
  ]);
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
      subject: { kind: "anchor", owner: { kind: "presenter" }, target: "bothHands" },
      preset: "spreadHands",
      minimumDistanceMeters: 0.5,
      windowMilliseconds: 1000,
    },
    title: "移動を検出",
    details: ["発表者（presenter）の両手（bothHands）", "0.5 m", "1000 ms"],
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
    details: ["video"],
  },
  {
    trigger: { kind: "modelClipCompleted", nodeId: "avatar", clipId: "bow" },
    title: "Model clip の完了",
    details: ["avatar", "bow"],
  },
])("shows $title trigger targets and parameters", ({ trigger, title, details }) => {
  const presentation = triggerPresentation(trigger);
  expect(presentation.title).toBe(title);
  expect(presentation.rows.map(([, value]) => value)).toEqual(expect.arrayContaining(details));
});

it.each([
  ["swipeLeft", "左へスワイプ（swipeLeft）"],
  ["swipeRight", "右へスワイプ（swipeRight）"],
  ["swipeDown", "下へスワイプ（swipeDown）"],
  ["swipeUp", "上へスワイプ（swipeUp）"],
  ["pushForward", "前へ押す（pushForward）"],
  ["pullBackward", "手前へ引く（pullBackward）"],
  ["spreadHands", "両手を広げる（spreadHands）"],
  ["closeHands", "両手を閉じる（closeHands）"],
] as const)("shows motion preset %s", (preset, expected) => {
  const motion = {
    kind: "motion",
    actor: { kind: "system", source: "tracking" },
    minimumDistanceMeters: 0.5,
    windowMilliseconds: 1000,
  } as const;
  const presentation =
    preset === "spreadHands" || preset === "closeHands"
      ? triggerPresentation({
          ...motion,
          preset,
          subject: { kind: "anchor", owner: { kind: "presenter" }, target: "bothHands" },
        })
      : triggerPresentation({
          ...motion,
          preset,
          subject: { kind: "anchor", owner: { kind: "presenter" }, target: "rightHand" },
        });
  expect(presentation.rows).toContainEqual(["動作", expected]);
});

it("preserves false literals, references and transforms in Node updates", () => {
  const presentation = actionPresentation({
    kind: "node.patch",
    nodeId: "avatar",
    patch: {
      active: { kind: "literal", value: false },
      visible: { kind: "variable", variableId: "visibility" },
      opacity: { kind: "eventPayload", field: "alpha" },
      transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [2, 3, 4] },
    },
  });
  expect(presentation.rows).toEqual([
    ["Node", "avatar"],
    ["有効", "false（偽）"],
    ["表示", "変数 visibility の値"],
    ["不透明度", "イベント入力 alpha の値"],
    ["位置 (x, y, z)", "1, 2, 3"],
    ["回転 (x, y, z, w)", "0, 0, 0, 1"],
    ["拡大率 (x, y, z)", "2, 3, 4"],
  ]);
});

it.each<Parameters<typeof comparisonLabel>[0] & { expected: string }>([
  {
    kind: "compare",
    left: { kind: "variable", variableId: "score" },
    operator: "gte",
    right: 5,
    expected: "変数 score ≧（以上） 5",
  },
  {
    kind: "compare",
    left: { kind: "eventPayload", field: "mode" },
    operator: "eq",
    right: "ready",
    expected: 'イベント入力 mode ＝（等しい） "ready"',
  },
  {
    kind: "compare",
    left: { kind: "surfaceState", surfaceId: "screen" },
    operator: "neq",
    right: "cover",
    expected: 'Surface screen の State ≠（異なる） "cover"',
  },
  {
    kind: "compare",
    left: { kind: "nodeField", nodeId: "avatar", field: "opacity" },
    operator: "lt",
    right: 0.7,
    expected: "Node avatar の不透明度（opacity） ＜（より小さい） 0.7",
  },
])("describes guard references and comparisons: $expected", ({ expected, ...guard }) => {
  expect(comparisonLabel(guard)).toBe(expected);
});
