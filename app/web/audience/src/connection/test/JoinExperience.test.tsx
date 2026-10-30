// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { JoinExperience } from "../JoinExperience";
import type { JoinController, JoinSnapshot } from "../join-controller";

afterEach(cleanup);

function makeController(initial: JoinSnapshot = { phase: "idle" }) {
  const store = createStore<JoinSnapshot>(() => initial);
  const controller: JoinController = {
    store,
    getSnapshot: store.getState,
    subscribe: store.subscribe,
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
        store.setState(next, true);
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

test("8文字のルームコードを有効にしてAPI形式で送信する", () => {
  const { controller } = makeController();
  render(<JoinExperience controller={controller} />);
  const input = screen.getByLabelText("ルームコード");
  const submit = screen.getByRole("button", { name: "参加する" });
  fireEvent.change(input, { target: { value: "invalid" } });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect((input as HTMLInputElement).placeholder).toBe("XXXXXXXX");
  fireEvent.change(input, { target: { value: "abcd2345" } });
  expect((input as HTMLInputElement).value).toBe("ABCD2345");
  expect((input as HTMLInputElement).checkValidity()).toBe(true);
  expect((submit as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(submit);
  expect(controller.join).toHaveBeenCalledExactlyOnceWith("ABCD-2345");
});

test("共有されたルームコードを再入力せず確認して参加できる", () => {
  const { controller } = makeController();
  render(<JoinExperience controller={controller} initialJoinCode="ABCD-EFGH" />);
  expect((screen.getByLabelText("ルームコード") as HTMLInputElement).value).toBe("ABCDEFGH");
  expect(controller.join).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "参加する" }));
  expect(controller.join).toHaveBeenCalledExactlyOnceWith("ABCD-EFGH");
});

test("ハイフン付きコードの貼り付け入力は8文字へ正規化する", () => {
  const { controller } = makeController();
  render(<JoinExperience controller={controller} />);
  const input = screen.getByLabelText("ルームコード") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "abcd-2345" } });
  expect(input.value).toBe("ABCD2345");
  expect(input.checkValidity()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "参加する" }));
  expect(controller.join).toHaveBeenCalledExactlyOnceWith("ABCD-2345");
});

test.each(["ABCD234", "ABCD23456", "ABCD0123", "ABCDI234", "ABCDO234", "ABCD!234"])(
  "桁数または使用文字が不正なコード %s は送信しない",
  (code) => {
    const { controller } = makeController();
    render(<JoinExperience controller={controller} />);
    fireEvent.change(screen.getByLabelText("ルームコード"), { target: { value: code } });
    expect((screen.getByRole("button", { name: "参加する" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.submit(screen.getByRole("form", { name: "ルームに参加" }));
    expect(controller.join).not.toHaveBeenCalled();
  },
);

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
  fireEvent.change(screen.getByLabelText("ルームコード"), { target: { value: "ABCD2345" } });
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

test("終了した配信ではコード送信を閉じ、新しいルームへの参加を案内する", () => {
  const { controller } = makeController({
    phase: "ended",
    session: { id: "session", state: "Ended" },
  });
  render(<JoinExperience controller={controller} />);
  expect(screen.getByRole("heading", { name: "配信は終了しました" })).toBeTruthy();
  expect(screen.queryByRole("form")).toBeNull();
  expect(screen.getByRole("button", { name: "別のルームに参加" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "別のルームに参加" }));
  expect(controller.leave).toHaveBeenCalledOnce();
});
