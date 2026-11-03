import type { PreviewSnapshot } from "./preview-store";
import type { UnityNotification } from "../infra/unity-exchange";
export function canControlPreview(state: PreviewSnapshot): boolean {
  return state.status === "ready" && state.loaded !== null;
}
export function acceptsNotification(
  state: PreviewSnapshot,
  notification: UnityNotification,
): boolean {
  return (
    state.loaded?.requestId === notification.requestId &&
    state.playback?.state.sequence === notification.sequence
  );
}
export function requiresRecovery(notification: UnityNotification): boolean {
  return notification.phase === "spatial" || notification.outcome !== "rejected";
}

export function previewStatusLabel(state: PreviewSnapshot): string {
  if (state.status === "loading" || state.phase === "pending" || state.phase === "building") {
    if (state.phase === "pending") return "更新待ち";
    if (state.phase === "building") return "ビルド中";
    return "表示反映中";
  }
  if (state.phase === "failed" && state.loaded) return "更新失敗";
  return {
    idle: "待機中",
    ready: "表示確認済み",
    recovering: "表示を復旧中",
    "reload-required": "再読込が必要",
    error: state.displayed ? "更新失敗" : "表示失敗",
  }[state.status];
}
