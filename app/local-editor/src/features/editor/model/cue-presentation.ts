import type { FlowCue } from "./timeline-view";

type Action = FlowCue["actions"][number];
type Trigger = FlowCue["trigger"];
export type CueGuard = NonNullable<FlowCue["guard"]>;
export type DetailRow = readonly [label: string, value: string];

function unreachable(value: never): never {
  throw new Error(`Unsupported Cue variant: ${String(value)}`);
}
export function scalarLabel(value: string | number | boolean | null): string {
  if (value === null) return "null（値なし）";
  if (typeof value === "boolean") return value ? "true（真）" : "false（偽）";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
export function actionValueLabel(
  value: Extract<Action, { kind: "variable.set" }>["value"],
): string {
  switch (value.kind) {
    case "literal":
      return scalarLabel(value.value);
    case "variable":
      return `変数 ${value.variableId} の値`;
    case "eventPayload":
      return `イベント入力 ${value.field} の値`;
    default:
      return unreachable(value);
  }
}
const completionLabel = (value: "blocking" | "nonBlocking") =>
  value === "blocking" ? "Run の完了まで遷移を待つ（blocking）" : "完了を待たない（nonBlocking）";
const easingLabel = (value: "linear" | "cubicIn" | "cubicOut" | "cubicInOut") =>
  ({
    linear: "一定速度（linear）",
    cubicIn: "加速（cubicIn）",
    cubicOut: "減速（cubicOut）",
    cubicInOut: "加速して減速（cubicInOut）",
  })[value];

export function actionPresentation(action: Action): {
  title: string;
  rows: DetailRow[];
  note?: string;
  tone: "state" | "animation";
} {
  switch (action.kind) {
    case "surface.setState":
      return {
        title: "Surface の状態を切り替え",
        tone: "state",
        note:
          action.transition?.kind === "crossfade"
            ? "crossfade による State 遷移（即時更新ではありません）"
            : "即時の State 更新",
        rows: [
          ["Surface", action.surfaceId],
          ["State", action.stateId],
          [
            "切り替え",
            action.transition?.kind === "crossfade" ? "クロスフェード（crossfade）" : "即時（cut）",
          ],
          ...(action.transition?.kind === "crossfade"
            ? ([
                ["所要時間", `${action.transition.durationMilliseconds} ms`],
                ["補間", easingLabel(action.transition.easing)],
                ["完了", completionLabel(action.transition.completion)],
              ] satisfies DetailRow[])
            : []),
        ],
      };
    case "node.patch":
      return {
        title: "Node を更新",
        tone: "state",
        note: "即時の Node 更新",
        rows: [
          ["Node", action.nodeId],
          ...(action.patch.active
            ? ([["有効", actionValueLabel(action.patch.active)]] satisfies DetailRow[])
            : []),
          ...(action.patch.visible
            ? ([["表示", actionValueLabel(action.patch.visible)]] satisfies DetailRow[])
            : []),
          ...(action.patch.opacity
            ? ([["不透明度", actionValueLabel(action.patch.opacity)]] satisfies DetailRow[])
            : []),
          ...(action.patch.transform
            ? ([
                ["位置 (x, y, z)", action.patch.transform.position.join(", ")],
                ["回転 (x, y, z, w)", action.patch.transform.rotation.join(", ")],
                ["拡大率 (x, y, z)", action.patch.transform.scale.join(", ")],
              ] satisfies DetailRow[])
            : []),
        ],
      };
    case "variable.set":
      return {
        title: "変数を設定",
        tone: "state",
        note: "即時の Variable 更新",
        rows: [
          ["変数", action.variableId],
          ["値", actionValueLabel(action.value)],
        ],
      };
    case "timeline.play":
      return {
        title: "Timeline を再生",
        tone: "animation",
        rows: [
          ["Timeline", action.timelineId],
          ["完了", completionLabel(action.completion)],
          ["競合", "競合時は拒否（reject）"],
        ],
      };
    case "timeline.stop":
      return {
        title: "Timeline を停止",
        tone: "animation",
        note: `Timeline ${action.timelineId} を停止する action`,
        rows: [["Timeline", action.timelineId]],
      };
    case "media.play":
      return { title: "Media を再生", tone: "animation", rows: [["Surface", action.surfaceId]] };
    case "media.pause":
      return {
        title: "Media を一時停止",
        tone: "animation",
        rows: [["Surface", action.surfaceId]],
      };
    case "media.seek":
      return {
        title: "Media の再生位置を変更",
        tone: "animation",
        rows: [
          ["Surface", action.surfaceId],
          ["再生位置（秒）", actionValueLabel(action.positionSeconds)],
        ],
      };
    case "modelClip.play":
      return {
        title: "Model clip を再生",
        tone: "animation",
        rows: [
          ["Node", action.nodeId],
          ["Clip", action.clipId],
          ["再生速度", `${action.speed} 倍`],
          ["ループ", action.loop ? "する" : "しない"],
          ["完了", completionLabel(action.completion)],
          [
            "切り替え",
            action.transition.kind === "immediate"
              ? "即時（immediate）"
              : "クロスフェード（crossfade）",
          ],
          ...(action.transition.kind === "crossfade"
            ? ([
                ["所要時間", `${action.transition.durationMilliseconds} ms`],
                ["補間", easingLabel(action.transition.easing)],
              ] satisfies DetailRow[])
            : []),
          ["競合", "競合時は拒否（reject）"],
        ],
      };
    case "modelClip.pause":
      return { title: "Model clip を一時停止", tone: "animation", rows: [["Node", action.nodeId]] };
    case "modelClip.resume":
      return { title: "Model clip を再開", tone: "animation", rows: [["Node", action.nodeId]] };
    case "modelClip.stop":
      return { title: "Model clip を停止", tone: "animation", rows: [["Node", action.nodeId]] };
    default:
      return unreachable(action);
  }
}
function actorLabel(actor: Extract<Trigger, { kind: "logicalInput" }>["actor"]): string {
  switch (actor.kind) {
    case "presenter":
      return "発表者（presenter）";
    case "system":
      return `システム（system）${actor.source ? ` / ${{ tracking: "位置追跡", timer: "タイマー", timeline: "Timeline", media: "Media", runtime: "Runtime" }[actor.source]}（${actor.source}）` : ""}`;
    default:
      return unreachable(actor);
  }
}
function subjectLabel(subject: Extract<Trigger, { kind: "motion" }>["subject"]): string {
  switch (subject.kind) {
    case "participant":
      return "発表者（presenter）の参加者（participant）";
    case "anchor":
      return `発表者（presenter）の${{ head: "頭", leftHand: "左手", rightHand: "右手", bothHands: "両手", eitherHand: "いずれかの手", body: "身体" }[subject.target]}（${subject.target}）`;
    default:
      return unreachable(subject);
  }
}
const motionPresetLabels = {
  swipeLeft: "左へスワイプ（swipeLeft）",
  swipeRight: "右へスワイプ（swipeRight）",
  swipeDown: "下へスワイプ（swipeDown）",
  swipeUp: "上へスワイプ（swipeUp）",
  pushForward: "前へ押す（pushForward）",
  pullBackward: "手前へ引く（pullBackward）",
  spreadHands: "両手を広げる（spreadHands）",
  closeHands: "両手を閉じる（closeHands）",
} as const;
export function triggerPresentation(trigger: Trigger): { title: string; rows: DetailRow[] } {
  switch (trigger.kind) {
    case "logicalInput":
      return {
        title: "操作入力",
        rows: [
          ["入力", trigger.action],
          ["発信者", actorLabel(trigger.actor)],
        ],
      };
    case "semanticEvent":
      return {
        title: "イベント受信",
        rows: [
          ["イベント", trigger.event],
          ["発信者", actorLabel(trigger.actor)],
        ],
      };
    case "surfaceInteraction":
      return {
        title: "Surface への操作",
        rows: [
          ["Surface", trigger.surfaceId],
          ["操作", trigger.interactionId],
          ["発信者", actorLabel(trigger.actor)],
        ],
      };
    case "zoneEdge":
      return {
        title: trigger.edge === "enter" ? "Zone に入る" : "Zone から出る",
        rows: [
          ["Zone", trigger.zoneId],
          ["境界", trigger.edge === "enter" ? "進入（enter）" : "退出（exit）"],
          ["発信者", actorLabel(trigger.actor)],
          ["追跡対象", subjectLabel(trigger.subject)],
          ...(trigger.dwellMilliseconds !== undefined
            ? ([["滞留時間", `${trigger.dwellMilliseconds} ms`]] satisfies DetailRow[])
            : []),
          ...(trigger.hysteresisMeters !== undefined
            ? ([["境界の余裕", `${trigger.hysteresisMeters} m`]] satisfies DetailRow[])
            : []),
        ],
      };
    case "motion":
      return {
        title: "移動を検出",
        rows: [
          ["発信者", actorLabel(trigger.actor)],
          ["追跡対象", subjectLabel(trigger.subject)],
          ...("preset" in trigger
            ? ([["動作", motionPresetLabels[trigger.preset]]] satisfies DetailRow[])
            : []),
          ["最小移動距離", `${trigger.minimumDistanceMeters} m`],
          ["検出期間", `${trigger.windowMilliseconds} ms`],
        ],
      };
    case "timer":
      return { title: "タイマー", rows: [["待ち時間", `${trigger.afterMilliseconds} ms`]] };
    case "timelineCompleted":
      return { title: "Timeline の完了", rows: [["Timeline", trigger.timelineId]] };
    case "mediaCompleted":
      return { title: "Media の完了", rows: [["Surface", trigger.surfaceId]] };
    case "modelClipCompleted":
      return {
        title: "Model clip の完了",
        rows: [
          ["Node", trigger.nodeId],
          ["Clip", trigger.clipId],
        ],
      };
    default:
      return unreachable(trigger);
  }
}
export function comparisonLabel(guard: Extract<CueGuard, { kind: "compare" }>): string {
  const reference = guard.left;
  let left: string;
  switch (reference.kind) {
    case "variable":
      left = `変数 ${reference.variableId}`;
      break;
    case "eventPayload":
      left = `イベント入力 ${reference.field}`;
      break;
    case "surfaceState":
      left = `Surface ${reference.surfaceId} の State`;
      break;
    case "nodeField":
      left = `Node ${reference.nodeId} の${{ active: "有効", visible: "表示", opacity: "不透明度" }[reference.field]}（${reference.field}）`;
      break;
    default:
      return unreachable(reference);
  }
  return `${left} ${{ eq: "＝（等しい）", neq: "≠（異なる）", gt: "＞（より大きい）", gte: "≧（以上）", lt: "＜（より小さい）", lte: "≦（以下）" }[guard.operator]} ${scalarLabel(guard.right)}`;
}
