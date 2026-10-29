// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({
  snapshot: { phase: "idle" } as {
    phase: string;
    revision?: number;
    refreshing?: boolean;
    refreshError?: string | null;
  },
  connection: { delivery: { sessionId: "test" }, bootstrap: {} },
  getPrepared: vi.fn(),
  refresh: vi.fn(),
  reconnect: vi.fn(async () => {}),
  mounts: vi.fn(),
  unmounts: vi.fn(),
  listener: null as (() => void) | null,
  dispose: vi.fn(),
  viewerDispose: vi.fn(),
  realtimeDispose: vi.fn(),
  leave: vi.fn(),
}));
vi.mock("../application-config", () => ({
  readConnectionConfig: () => ({
    status: "configured",
    config: { apiOrigin: "https://api.example.test", capabilityProfileId: "audience" },
  }),
}));
vi.mock("../http-client", () => ({ createAudienceHttpClient: () => ({}) }));
vi.mock("../join-controller", () => ({
  createJoinController: () => ({
    store: {
      getState: () => mock.snapshot,
      getInitialState: () => mock.snapshot,
      subscribe: (listener: () => void) => {
        mock.listener = listener;
        return () => {
          mock.listener = null;
        };
      },
    },
    dispose: mock.dispose,
    leave: mock.leave,
    getPrepared: mock.getPrepared,
    refresh: mock.refresh,
    reconnect: mock.reconnect,
  }),
}));
vi.mock("../realtime-client", () => ({
  createAudienceRealtime: () => ({
    install: vi.fn(),
    recover: vi.fn(),
    dispose: mock.realtimeDispose,
  }),
}));
vi.mock("../JoinExperience", () => ({ JoinExperience: () => <p>ルーム入力</p> }));
vi.mock("../../experience/viewer-application", async () => {
  const { createStore } = await import("zustand/vanilla");
  return {
    createViewerApplication: (
      options: import("../../experience/viewer-application").ViewerConnectionOptions,
    ) => {
      const store = createStore(() => options);
      return {
        testStore: store,
        update: (next: typeof options) => store.setState(next, true),
        dispose: mock.viewerDispose,
      };
    },
  };
});
vi.mock("../../experience/ViewerExperience", async () => {
  const { useEffect } = await import("react");
  const { useStore } = await import("zustand");
  return {
    ViewerExperience: ({
      application,
    }: {
      application: {
        testStore: import("zustand/vanilla").StoreApi<
          import("../../experience/viewer-application").ViewerConnectionOptions
        >;
      };
    }) => {
      const { connection, onLeave, refreshing, onRefresh } = useStore(application.testStore);
      useEffect(() => {
        mock.mounts();
        return mock.unmounts;
      }, []);
      return (
        <>
          <p>{`カメラ準備・配信待機:${connection.delivery.sessionId}`}</p>
          <span>{refreshing ? "更新中" : "更新待機"}</span>
          <button onClick={onRefresh}>接続情報を更新</button>
          <button onClick={onLeave}>退出</button>
        </>
      );
    },
  };
});
import { AudienceApplication } from "../AudienceApplication";
afterEach(() => {
  cleanup();
  mock.snapshot = { phase: "idle" };
  vi.clearAllMocks();
  mock.getPrepared.mockReturnValue(mock.connection);
});
test("HTTP準備後のDeliveryを視聴画面へ渡し、資格失効時に参加画面へ戻す", async () => {
  mock.getPrepared.mockReturnValue(mock.connection);
  render(<AudienceApplication />);
  expect(screen.getByText("ルーム入力")).toBeTruthy();
  act(() => {
    mock.snapshot = { phase: "prepared", revision: 1, refreshing: false, refreshError: null };
    mock.listener?.();
  });
  expect(await screen.findByText("カメラ準備・配信待機:test")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "退出" }));
  expect(mock.leave).toHaveBeenCalledOnce();
  act(() => {
    mock.snapshot = { phase: "error" };
    mock.listener?.();
  });
  expect(screen.getByText("ルーム入力")).toBeTruthy();
});

test("期限前更新中と成功後も同じ視聴画面を維持する", async () => {
  mock.getPrepared.mockReturnValue(mock.connection);
  render(<AudienceApplication />);
  act(() => {
    mock.snapshot = { phase: "prepared", revision: 1, refreshing: false };
    mock.listener?.();
  });
  await screen.findByText("カメラ準備・配信待機:test");
  const mounts = mock.mounts.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "接続情報を更新" }));
  expect(mock.refresh).toHaveBeenCalledOnce();
  act(() => {
    mock.snapshot = { phase: "prepared", revision: 1, refreshing: true };
    mock.listener?.();
  });
  expect(screen.getByText("更新中")).toBeTruthy();
  expect(mock.mounts).toHaveBeenCalledTimes(mounts);
  expect(mock.unmounts).not.toHaveBeenCalled();
  act(() => {
    mock.snapshot = { phase: "prepared", revision: 2, refreshing: false };
    mock.listener?.();
  });
  expect(screen.getByText("更新待機")).toBeTruthy();
  expect(mock.mounts).toHaveBeenCalledTimes(mounts);
  expect(mock.unmounts).not.toHaveBeenCalled();
});

test("背景から戻る際に利用期限を再確認して失効した視聴画面を閉じる", async () => {
  mock.getPrepared.mockReturnValue(mock.connection);
  render(<AudienceApplication />);
  act(() => {
    mock.snapshot = { phase: "prepared", revision: 1, refreshing: false };
    mock.listener?.();
  });
  await screen.findByText("カメラ準備・配信待機:test");
  mock.getPrepared.mockImplementationOnce(() => {
    mock.snapshot = { phase: "error" };
    mock.listener?.();
    return null;
  });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(screen.getByText("ルーム入力")).toBeTruthy();
  expect(mock.unmounts).toHaveBeenCalledOnce();
});

test("入室前と接続失敗でViewerがない時にも接続テストログを保存できる", () => {
  render(<AudienceApplication />);
  expect(screen.getByRole("button", { name: "接続テストログを保存" })).toBeTruthy();
  act(() => {
    mock.snapshot = { phase: "error" };
    mock.listener?.();
  });
  expect(screen.getByRole("button", { name: "接続テストログを保存" })).toBeTruthy();
});

test("Runtime復旧待ちでもカメラ画面を維持し新assignmentで再利用する", async () => {
  mock.getPrepared.mockReturnValue(mock.connection);
  render(<AudienceApplication />);
  act(() => {
    mock.snapshot = { phase: "prepared", revision: 1, refreshing: false };
    mock.listener?.();
  });
  await screen.findByText("カメラ準備・配信待機:test");
  const mounts = mock.mounts.mock.calls.length;
  mock.getPrepared.mockReturnValue(null);
  act(() => {
    mock.snapshot = { phase: "recovering" };
    mock.listener?.();
  });
  expect(screen.getByText("カメラ準備・配信待機:test")).toBeTruthy();
  expect(screen.getByText("更新中")).toBeTruthy();
  expect(mock.unmounts).not.toHaveBeenCalled();
  mock.getPrepared.mockReturnValue(mock.connection);
  act(() => {
    mock.snapshot = { phase: "prepared", revision: 2, refreshing: false };
    mock.listener?.();
  });
  expect(mock.mounts).toHaveBeenCalledTimes(mounts);
  expect(screen.getByText("更新待機")).toBeTruthy();
});

test("視聴モジュールの準備中に資格を失効しても画面を復活させない", async () => {
  mock.getPrepared.mockReturnValue(mock.connection);
  render(<AudienceApplication />);
  await act(async () => {
    mock.snapshot = { phase: "prepared", revision: 1, refreshing: false };
    mock.listener?.();
    mock.snapshot = { phase: "error" };
    mock.listener?.();
  });
  expect(screen.getByText("ルーム入力")).toBeTruthy();
  expect(mock.mounts).not.toHaveBeenCalled();
});

test("SDK資源の破棄が失敗しても資格とRealtimeの所有者を停止する", async () => {
  mock.getPrepared.mockReturnValue(mock.connection);
  const ui = render(<AudienceApplication />);
  act(() => {
    mock.snapshot = { phase: "prepared", revision: 1, refreshing: false };
    mock.listener?.();
  });
  await screen.findByText("カメラ準備・配信待機:test");
  mock.viewerDispose.mockImplementationOnce(() => {
    throw new Error("SDK dispose failure");
  });
  expect(() => ui.unmount()).not.toThrow();
  expect(mock.dispose).toHaveBeenCalledOnce();
  expect(mock.realtimeDispose).toHaveBeenCalledOnce();
});
