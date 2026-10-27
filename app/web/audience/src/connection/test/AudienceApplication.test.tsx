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
  mounts: vi.fn(),
  unmounts: vi.fn(),
  listener: null as (() => void) | null,
  dispose: vi.fn(),
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
    getSnapshot: () => mock.snapshot,
    subscribe: (listener: () => void) => {
      mock.listener = listener;
      return () => {
        mock.listener = null;
      };
    },
    dispose: mock.dispose,
    leave: mock.leave,
    getPrepared: mock.getPrepared,
    refresh: mock.refresh,
  }),
}));
vi.mock("../JoinExperience", () => ({ JoinExperience: () => <p>ルーム入力</p> }));
vi.mock("../../experience/ViewerExperience", async () => {
  const { useEffect } = await import("react");
  return {
    ViewerExperience: ({
      connection,
      onLeave,
      refreshing,
      onRefresh,
    }: {
      connection: { delivery: { sessionId: string } };
      onLeave(): void;
      refreshing: boolean;
      onRefresh(): void;
    }) => {
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
