// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { JoinExperience } from "../JoinExperience";
import type { JoinController, JoinSnapshot } from "../join-controller";

afterEach(cleanup);

function makeController(initial: JoinSnapshot = { phase: "idle" }) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const controller: JoinController = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    join: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    cancel: vi.fn(),
    leave: vi.fn(),
    getPrepared: () => null,
    dispose: vi.fn(),
  };
  return {
    controller,
    update(next: JoinSnapshot) {
      act(() => {
        snapshot = next;
        listeners.forEach((listener) => listener());
      });
    },
  };
}

test("API設定がない場合はログインや接続を要求せず設定待ちを示す", () => {
  render(<JoinExperience controller={null} />);
  expect(screen.getByText(/ルームへ参加する準備が整っていません/)).toBeTruthy();
  expect(screen.getByText(/会場スタッフにご確認/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "参加する" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test("正しいルームコードだけを送信する", () => {
  const { controller } = makeController();
  render(<JoinExperience controller={controller} />);
  const input = screen.getByLabelText("ルームコード");
  const submit = screen.getByRole("button", { name: "参加する" });
  fireEvent.change(input, { target: { value: "invalid" } });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: "ABCD-2345" } });
  fireEvent.click(submit);
  expect(controller.join).toHaveBeenCalledExactlyOnceWith("ABCD-2345");
});

test("進行中は多重送信を防ぎ取消を受け付ける", () => {
  const { controller, update } = makeController();
  render(<JoinExperience controller={controller} />);
  update({ phase: "delivery", session: { id: "session", state: "Presenting" } });
  expect(screen.getByRole("status").textContent).toContain("表示データを取得中");
  expect((screen.getByLabelText("ルームコード") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(controller.cancel).toHaveBeenCalledOnce();
});

test("認証失敗を日本語で表示し入力コードで再試行できる", () => {
  const { controller, update } = makeController();
  render(<JoinExperience controller={controller} />);
  fireEvent.change(screen.getByLabelText("ルームコード"), { target: { value: "ABCD-2345" } });
  update({ phase: "error", error: "unauthorized" });
  expect(screen.getByRole("alert").textContent).toContain("参加資格");
  fireEvent.click(screen.getByRole("button", { name: "再試行" }));
  expect(controller.join).toHaveBeenCalledWith("ABCD-2345");
});

test("接続準備完了をライブ受信完了として表示せず退出で破棄する", () => {
  const { controller, update } = makeController();
  render(<JoinExperience controller={controller} />);
  update({
    phase: "prepared",
    revision: 1,
    refreshing: false,
    refreshError: null,
    session: { id: "session-secret", state: "Presenting" },
    expiresAt: "2026-10-23T00:01:00Z",
  });
  expect(screen.getByRole("status").textContent).toContain("カメラを開始");
  expect(screen.queryByText("session-secret")).toBeNull();
  expect(screen.queryByRole("button", { name: "参加する" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "取得情報を更新" }));
  expect(controller.refresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "退出" }));
  expect(controller.leave).toHaveBeenCalledOnce();
});

test("不明なエラー内容をそのまま表示しない", () => {
  const { controller } = makeController({
    phase: "error",
    error: "https://example.com/?token=secret",
  });
  render(<JoinExperience controller={controller} />);
  expect(screen.getByRole("alert").textContent).not.toContain("secret");
});

test("参加画面は匿名視聴の案内と進行中のフォーム状態を示す", () => {
  const { controller, update } = makeController();
  render(<JoinExperience controller={controller} />);
  expect(screen.getByText("ログインせずに視聴できます")).toBeTruthy();
  expect(screen.getByRole("form", { name: "ルームに参加" }).getAttribute("aria-busy")).toBe(
    "false",
  );
  update({ phase: "joining" });
  expect(screen.getByRole("form", { name: "ルームに参加" }).getAttribute("aria-busy")).toBe("true");
});
