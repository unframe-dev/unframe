// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AudienceStage } from "./AudienceStage";
afterEach(cleanup);
test("SDK待機を位置認識と区別し、状態を説明する", () => {
  render(<AudienceStage phase="sdk" normal={false} warmupSeconds={5} onStart={vi.fn()} canStart />);
  expect(screen.getByRole("heading", { name: "空間を準備しています" })).toBeTruthy();
  expect(screen.getByText(/SDK NORMAL 待ち/)).toBeTruthy();
});
test("視聴中は大きな案内と診断を隠しメニューから開く", () => {
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
  expect(screen.queryByRole("dialog")).toBeNull();
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
