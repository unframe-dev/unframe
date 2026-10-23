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
  return notification.outcome !== "rejected";
}
