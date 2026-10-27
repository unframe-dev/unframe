import { expect, test } from "vitest";
import { viewingPhase } from "../viewing-phase";
const running = {
  stage: "running",
  tracking: "NORMAL",
  detection: "active",
  lastTagAtMs: 42,
} as const;
test("カメラ許可、SDK準備、認識、視聴を実状態から分ける", () => {
  expect(viewingPhase({ ...running, stage: "ready" })).toBe("permission");
  expect(viewingPhase({ ...running, tracking: "LIMITED" })).toBe("sdk");
  expect(viewingPhase({ ...running, detection: "waiting" })).toBe("sdk");
  expect(viewingPhase({ ...running, lastTagAtMs: null })).toBe("scanning");
  expect(viewingPhase(running)).toBe("viewing");
  expect(viewingPhase({ ...running, contentReady: false })).toBe("waiting");
});
test("位置合わせ後も追跡低下では準備へ戻り終了・失敗は視聴表示にしない", () => {
  expect(viewingPhase({ ...running, tracking: "LIMITED" })).toBe("sdk");
  expect(viewingPhase({ ...running, error: "error" })).toBe("error");
  expect(viewingPhase({ ...running, ended: true })).toBe("ended");
});
