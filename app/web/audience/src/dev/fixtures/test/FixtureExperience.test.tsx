// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FixtureExperience } from "../FixtureExperience";
import type { AnchorSessionSnapshot } from "../../../experience/anchor-session";

const mocks = vi.hoisted(() => {
  const runtimeSnapshot = {
    phase: "ready",
    rendering: "ready",
    reliableSequence: "0",
    error: null as string | null,
    reason: null as string | null,
    view: null,
  };
  const runtime = {
    applyControl: vi.fn(),
    waitForIdle: vi.fn(async () => {}),
    getSnapshot: vi.fn(() => runtimeSnapshot),
    dispose: vi.fn(),
    reset: vi.fn(),
  };
  return {
    runtime,
    runtimeSnapshot,
    onChange: null as ((snapshot: AnchorSessionSnapshot) => void) | null,
    session: {
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      resumeMediaPlayback: vi.fn(async () => {}),
      dispose: vi.fn(),
      getSnapshot: vi.fn(() => ({
        stage: "running",
        tracking: "NORMAL",
        detection: "active",
        anchorUpdateCount: 0,
      })),
      openRuntime: vi.fn(() => runtime),
      getDiagnosticContext: vi.fn(() => ({
        measurementSnapshot: { sessionId: 1, capture: { captured: 22 } },
        records: [
          {
            timeMs: 3,
            event: "frame-source-error",
            detail: { message: "SDK camera readback WebGL error 1282" },
          },
        ],
      })),
    },
    scenario: {
      delivery: {},
      snapshot: { connectionId: "test" },
      actions: [{ label: "次のPNG", item: { logicalInputReceived: {} } }],
    },
  };
});
vi.mock("../../../experience/anchor-session", () => ({
  createAnchorSession: (options: { onChange(snapshot: AnchorSessionSnapshot): void }) => {
    mocks.onChange = options.onChange;
    return mocks.session;
  },
}));
vi.mock("../../../fiducials/config", () => ({
  loadBoardConfig: async () => ({}),
  configureTagBoard: (config: unknown) => config,
  selectedTagProfile: () => ({ sizeCm: 22.5, markerSizeMeters: 0.15 }),
}));
vi.mock("../media-scenario", () => ({
  createMediaFixtureScenario: vi.fn(async () => mocks.scenario),
}));
vi.mock("../scenario", () => ({
  createFixtureScenario: async () => mocks.scenario,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.runtime.getSnapshot.mockReturnValue(mocks.runtimeSnapshot);
});
function openControls() {
  if (!screen.queryByRole("dialog", { name: "視聴メニュー" }))
    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
}
async function startFixture() {
  fireEvent.click(await readyStart());
  openControls();
}
async function readyStart() {
  const button = await screen.findByRole("button", { name: "カメラを開始" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  return button;
}

test("明示的に開始するまで起動せず、Snapshotと操作を順に適用する", async () => {
  render(<FixtureExperience />);
  const start = await readyStart();
  expect(mocks.session.start).not.toHaveBeenCalled();
  fireEvent.click(start);
  openControls();
  await waitFor(() =>
    expect(mocks.runtime.applyControl).toHaveBeenCalledWith({
      connectionSnapshot: mocks.scenario.snapshot,
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "次の操作：次のPNG" }));
  await waitFor(() =>
    expect(mocks.runtime.applyControl).toHaveBeenCalledWith(mocks.scenario.actions[0]!.item),
  );
  expect(screen.getByText("すべての操作を適用しました")).toBeTruthy();
});

test("停止後は更新できず、再開時はSnapshotから始める", async () => {
  render(<FixtureExperience />);
  await startFixture();
  await screen.findByRole("button", { name: "次の操作：次のPNG" });
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  expect(mocks.session.stop).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "次の操作：次のPNG" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "カメラを開始" }));
  await waitFor(() => expect(mocks.session.openRuntime).toHaveBeenCalledTimes(2));
});

test("開始中に停止した場合、遅れて完了してもSnapshotを適用しない", async () => {
  let complete!: () => void;
  mocks.session.start.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  render(<FixtureExperience />);
  await startFixture();
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  await act(async () => {
    complete();
  });
  expect(mocks.session.openRuntime).not.toHaveBeenCalled();
});

test("描画エラーを表示し初期状態へ再試行できる", async () => {
  mocks.runtime.getSnapshot.mockReturnValue({
    phase: "ready",
    rendering: "error",
    reliableSequence: "0",
    error: "presentation-render-failed",
    reason: null,
    view: null,
  });
  render(<FixtureExperience />);
  await startFixture();
  expect(await screen.findByRole("alert")).toBeTruthy();
  mocks.runtime.getSnapshot.mockReturnValue(mocks.runtimeSnapshot);
  fireEvent.click(screen.getByRole("button", { name: "初期状態から再試行" }));
  await waitFor(() => expect(mocks.session.openRuntime).toHaveBeenCalledTimes(2));
});

test("アンマウントでカメラと描画を破棄する", async () => {
  const { unmount } = render(<FixtureExperience />);
  await readyStart();
  unmount();
  expect(mocks.session.dispose).toHaveBeenCalledTimes(1);
});

test("素材処理中は次の操作と初期化を無効にし、停止は受け付ける", async () => {
  let complete!: () => void;
  mocks.runtime.waitForIdle.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  render(<FixtureExperience />);
  await startFixture();
  await screen.findByRole("button", { name: "次の操作：次のPNG" });
  expect(
    (screen.getByRole("button", { name: "次の操作：次のPNG" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "初期状態に戻す" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  await act(async () => {
    complete();
  });
  expect(screen.queryByRole("button", { name: "次の操作：次のPNG" })).toBeNull();
});

test("停止時に操作件数をリセットし、新しいサイズの記録へ古い操作を持ち越さない", async () => {
  render(<FixtureExperience />);
  await startFixture();
  fireEvent.click(await screen.findByRole("button", { name: "次の操作：次のPNG" }));
  await screen.findByText("すべての操作を適用しました");
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  expect(screen.getByText("0 / 1")).toBeTruthy();
});

test("カメラ停止後のreset状態と最後のready状態を別々に保存する", async () => {
  let downloaded: Blob | undefined;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      downloaded = blob;
      return "blob:test";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<FixtureExperience />);
  await startFixture();
  await screen.findByRole("button", { name: "次の操作：次のPNG" });
  mocks.runtime.getSnapshot.mockReturnValueOnce({
    ...mocks.runtimeSnapshot,
    phase: "awaiting-snapshot",
    rendering: "idle",
  });
  fireEvent.click(screen.getByRole("button", { name: "状態をJSON保存" }));
  const payload = JSON.parse(
    await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(downloaded!);
    }),
  );
  expect(payload.schemaVersion).toBe(2);
  expect(payload.runtime.phase).toBe("awaiting-snapshot");
  expect(payload.lastReadyRuntime.phase).toBe("ready");
  expect(payload.diagnostics.measurementSnapshot.capture.captured).toBe(22);
  expect(payload.diagnostics.records[0].detail.message).toBe(
    "SDK camera readback WebGL error 1282",
  );
  click.mockRestore();
});

test("カメラ取得エラー後の再試行ではカメラを再起動する", async () => {
  render(<FixtureExperience />);
  await startFixture();
  await screen.findByRole("button", { name: "次の操作：次のPNG" });
  act(() => {
    mocks.onChange?.({
      ...mocks.session.getSnapshot(),
      stage: "error",
      error: "カメラ映像の取得に失敗しました。検証ログを保存してください。",
    } as AnchorSessionSnapshot);
  });
  fireEvent.click(screen.getByRole("button", { name: "初期状態から再試行" }));
  await waitFor(() => expect(mocks.session.start).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mocks.session.openRuntime).toHaveBeenCalledTimes(2));
});

test("動画・GLBの途中参加を選んでfixtureを読み替える", async () => {
  const { createMediaFixtureScenario } = await import("../media-scenario");
  render(<FixtureExperience />);
  await readyStart();
  openControls();
  fireEvent.change(screen.getByLabelText("テスト内容"), { target: { value: "media-late" } });
  await waitFor(() =>
    expect(createMediaFixtureScenario).toHaveBeenCalledWith(window.location.origin, {
      joiningMidPlayback: true,
    }),
  );
});
