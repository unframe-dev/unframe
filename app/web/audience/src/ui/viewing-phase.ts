export type ViewingPhase =
  | "permission"
  | "sdk"
  | "scanning"
  | "viewing"
  | "waiting"
  | "error"
  | "ended";
export function viewingPhase(state: {
  stage: string;
  tracking: string;
  detection: string;
  lastTagAtMs: number | null | undefined;
  contentReady?: boolean;
  ended?: boolean;
  error?: string | null;
}): ViewingPhase {
  if (state.error || state.stage === "error") return "error";
  if (state.ended) return "ended";
  if (state.stage === "starting") return "sdk";
  if (state.stage !== "running") return "permission";
  if (state.tracking !== "NORMAL" || state.detection !== "active") return "sdk";
  if (state.lastTagAtMs == null) return "scanning";
  return state.contentReady === false ? "waiting" : "viewing";
}
