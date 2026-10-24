// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({
  snapshot: { phase: "idle" } as { phase: string },
  listener: null as (() => void) | null,
  dispose: vi.fn(),
  leave: vi.fn(),
}));
vi.mock("./application-config", () => ({
  readConnectionConfig: () => ({
    status: "configured",
    config: { apiOrigin: "https://api.example.test", capabilityProfileId: "audience" },
  }),
}));
vi.mock("./http-client", () => ({ createAudienceHttpClient: () => ({}) }));
vi.mock("./join-controller", () => ({
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
  }),
}));
vi.mock("./JoinExperience", () => ({ JoinExperience: () => <p>ルーム入力</p> }));
vi.mock("../AnchorExperience", () => ({
  AnchorExperience: ({ viewerMode, onLeave }: { viewerMode: boolean; onLeave(): void }) => (
    <>
      <p>{viewerMode ? "カメラ準備・配信待機" : "位置合わせテスト"}</p>
      <button onClick={onLeave}>退出</button>
    </>
  ),
}));
import { AudienceApplication } from "./AudienceApplication";
afterEach(() => {
  cleanup();
  mock.snapshot = { phase: "idle" };
  vi.clearAllMocks();
});
test("HTTP準備後にカメラ準備へ進み、資格失効時に参加画面へ戻す", () => {
  render(<AudienceApplication />);
  expect(screen.getByText("ルーム入力")).toBeTruthy();
  act(() => {
    mock.snapshot = { phase: "prepared" };
    mock.listener?.();
  });
  expect(screen.getByText("カメラ準備・配信待機")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "退出" }));
  expect(mock.leave).toHaveBeenCalledOnce();
  act(() => {
    mock.snapshot = { phase: "error" };
    mock.listener?.();
  });
  expect(screen.getByText("ルーム入力")).toBeTruthy();
});
