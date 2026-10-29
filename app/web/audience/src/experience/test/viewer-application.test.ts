// @vitest-environment jsdom
import { expect, test } from "vitest";
import type { PreparedConnection } from "../../connection/join-controller";
import type { BoardConfig } from "../../fiducials/config";
import { createViewerApplication } from "../viewer-application";

test("破棄後の遅い会場設定失敗で画面状態を更新しない", async () => {
  let reject!: (error: Error) => void;
  const config = new Promise<BoardConfig>((_, failure) => {
    reject = failure;
  });
  const application = createViewerApplication({
    connection: {} as PreparedConnection,
    refreshing: false,
    refreshError: null,
    onLeave() {},
    onRefresh() {},
    async onReconnect() {},
    loadConfig: () => config,
  });
  application.mount(document.createElement("canvas"));
  application.dispose();
  const state = application.store.getState();
  reject(new Error("late response"));
  await config.catch(() => {});
  await Promise.resolve();
  expect(application.store.getState()).toBe(state);
  expect(state.error).toBeNull();
});
