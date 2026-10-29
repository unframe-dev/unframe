// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AudienceStage } from "../AudienceStage";
afterEach(cleanup);
test("SDK待機を位置認識と区別し、状態を説明する", () => {
  render(<AudienceStage phase="sdk" normal={false} warmupSeconds={5} onStart={vi.fn()} canStart />);
  expect(screen.getByRole("heading", { name: "空間を準備しています" })).toBeTruthy();
  expect(screen.getByText("カメラと追跡を開始しています。")).toBeTruthy();
  expect(screen.queryByText(/SDK NORMAL/)).toBeNull();
});
test("視聴中は大きな案内と診断を隠しメニューから開く", async () => {
  render(
    <AudienceStage
      phase="viewing"
      onStart={vi.fn()}
      canStart
      menu={<button>状態をJSON保存</button>}
    />,
  );
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button", { name: "状態をJSON保存" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
  expect(screen.getByRole("dialog", { name: "視聴メニュー" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "状態をJSON保存" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("配信待機の理由を追跡の表示条件と独立して表示する", () => {
  render(
    <AudienceStage
      phase="waiting"
      canStart={false}
      onStart={() => {}}
      waitingLabel="表示を準備しています"
      waitingMessage="素材を読み込んでいます。"
    />,
  );
  expect(screen.getByText("表示を準備しています")).toBeTruthy();
  expect(screen.getByText("素材を読み込んでいます。")).toBeTruthy();
});

test("カメラの開始前に必要な許可を明示する", () => {
  const start = vi.fn();
  render(<AudienceStage phase="permission" onStart={start} canStart />);
  expect(screen.getByRole("heading", { name: "カメラを使って視聴" })).toBeTruthy();
  expect(screen.getByText(/カメラの使用を許可/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "カメラを開始" }));
  expect(start).toHaveBeenCalledOnce();
});

test("視聴メニューは Escape で閉じ、開いた操作へフォーカスを戻す", () => {
  render(<AudienceStage phase="viewing" onStart={vi.fn()} canStart menu={<button>退出</button>} />);
  const trigger = screen.getByRole("button", { name: "メニューを開く" });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("dialog", { name: "視聴メニュー" }), { key: "Escape" });
  expect(trigger).toBe(document.activeElement);
});

test("終了画面から戻る操作をアプリケーションの退出処理へ渡す", () => {
  const leave = vi.fn();
  render(<AudienceStage phase="ended" onStart={vi.fn()} onLeave={leave} canStart={false} />);
  fireEvent.click(screen.getByRole("button", { name: "ルーム入力へ戻る" }));
  expect(leave).toHaveBeenCalledOnce();
});

test("視聴画面のホーム操作も退出処理へ渡す", () => {
  const leave = vi.fn();
  render(<AudienceStage phase="ended" onStart={vi.fn()} onLeave={leave} canStart={false} />);
  fireEvent.click(screen.getByRole("button", { name: "unframe Audience ホーム" }));
  expect(leave).toHaveBeenCalledOnce();
});
