// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { PreparedConnection } from "../connection/join-controller";
import type { AnchorSessionSnapshot } from "./anchor-session";
import type { createRuntimePlayback } from "../runtime/playback";
import type { RuntimeInput } from "./viewing-session";
import board from "../../public/poc-config.json";
import fixture from "../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import { ViewerExperience, type ViewerExperienceProps } from "./ViewerExperience";

type RuntimeSnapshot = ReturnType<ReturnType<typeof createRuntimePlayback>["getSnapshot"]>;
const mock = vi.hoisted(() => ({
  onChange: null as ((state: AnchorSessionSnapshot) => void) | null,
  anchor: null as AnchorSessionSnapshot | null,
  runtime: null as RuntimeSnapshot | null,
  start: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
  openRuntime: vi.fn(),
  applyControl: vi.fn(),
  applyState: vi.fn(),
  reset: vi.fn(),
  diagnostic: vi.fn(() => null),
  configuredBoard: null as unknown,
}));
vi.mock("../fiducials/config", async (original) => ({
  ...(await original<typeof import("../fiducials/config")>()),
  loadBoardConfig: async () => ({ ...board, boardId: "venue-production", revision: 7 }),
}));
vi.mock("./anchor-session", () => ({
  createAnchorSession: (options: {
    config: unknown;
    onChange(state: AnchorSessionSnapshot): void;
  }) => {
    mock.configuredBoard = options.config;
    mock.onChange = options.onChange;
    return {
      getSnapshot: () => mock.anchor!,
      start: mock.start,
      stop: mock.stop,
      dispose: mock.dispose,
      openRuntime: mock.openRuntime,
      getDiagnosticContext: mock.diagnostic,
      resumeMediaPlayback: vi.fn(),
    };
  },
}));

function setup() {
  mock.applyControl.mockReset();
  mock.applyState.mockReset();
  mock.reset.mockImplementation(() => {
    mock.runtime = {
      ...mock.runtime!,
      phase: "awaiting-snapshot",
      view: null,
      rendering: "idle",
      reason: null,
    };
  });
  mock.stop.mockImplementation(() => {
    mock.anchor = { ...mock.anchor!, stage: "stopped" };
    mock.onChange?.(mock.anchor);
  });
  mock.anchor = {
    stage: "ready",
    error: null,
    tracking: "LIMITED",
    detection: "waiting",
    nowMs: 0,
    normalSinceMs: null,
    completionHz: null,
    anchorUpdateCount: 0,
    lastTagAtMs: null,
    localizationReason: "not-detected",
    captureAvailable: false,
    mediaPlaybackBlocked: false,
  };
  mock.runtime = {
    phase: "awaiting-snapshot",
    view: null,
    reliableSequence: "0",
    stateSequence: "0",
    stateSync: "awaiting-keyframe",
    reason: null,
    rendering: "idle",
    error: null,
  };
  mock.start.mockImplementation(async () => {
    mock.anchor = {
      ...mock.anchor!,
      stage: "running",
      tracking: "NORMAL",
      detection: "active",
      lastTagAtMs: 1,
    };
    mock.onChange?.(mock.anchor);
  });
  mock.openRuntime.mockImplementation(() => ({
    getSnapshot: () => mock.runtime!,
    applyControl: mock.applyControl,
    applyState: mock.applyState,
    reset: mock.reset,
    waitForIdle: async () => {},
  }));
  const connection = {
    session: { id: "session" },
    delivery: structuredClone(fixture.value),
    bootstrap: { credential: "private-old", assignmentEpoch: 1 },
  } as unknown as PreparedConnection;
  const onLeave = vi.fn(),
    onRefresh = vi.fn();
  return { connection, onLeave, onRefresh, refreshing: false, refreshError: null };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});
async function start() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "カメラを開始" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "カメラを開始" }));
  });
  await waitFor(() => expect(mock.openRuntime).toHaveBeenCalled());
}
test("明示開始でDeliveryをXR→Runtimeへ渡し、製品設定をsize queryで上書きしない", async () => {
  const props = setup();
  window.history.replaceState({}, "", "/?size=70");
  render(<ViewerExperience {...props} />);
  expect(mock.start).not.toHaveBeenCalled();
  await start();
  expect(mock.configuredBoard).toMatchObject({
    boardId: "venue-production",
    revision: 7,
    markers: board.markers,
  });
  expect(mock.openRuntime).toHaveBeenCalledWith(props.connection.delivery);
  expect(screen.getByText("ライブ受信の接続待ちです。")).toBeTruthy();
  expect(document.querySelector("[data-phase]")?.getAttribute("data-phase")).toBe("waiting");
});
test("Snapshot供給後に視聴へ進み、同じinputの資格更新では再接続せずgetterが最新を返す", async () => {
  const props = setup();
  let input!: RuntimeInput, getConnection!: () => PreparedConnection;
  const disconnect = vi.fn();
  const onRuntimeInput = vi.fn(
    (value: RuntimeInput, _connection: PreparedConnection, latest: () => PreparedConnection) => {
      input = value;
      getConnection = latest;
      return disconnect;
    },
  );
  const ui = render(<ViewerExperience {...props} onRuntimeInput={onRuntimeInput} />);
  await start();
  expect(onRuntimeInput).toHaveBeenCalledTimes(1);
  mock.applyControl.mockImplementation(() => {
    mock.runtime = {
      ...mock.runtime!,
      phase: "ready",
      rendering: "ready",
      view: { clock: { runtimeTimeMilliseconds: 0 } } as RuntimeSnapshot["view"],
    };
  });
  act(() => input.applyControl({ connected: { connectionId: "test" } }));
  expect(document.querySelector("[data-phase]")?.getAttribute("data-phase")).toBe("viewing");
  const next = structuredClone(props.connection);
  next.bootstrap.credential = "private-new";
  ui.rerender(<ViewerExperience {...props} connection={next} onRuntimeInput={onRuntimeInput} />);
  expect(onRuntimeInput).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
  expect(getConnection().bootstrap.credential).toBe("private-new");
  expect(document.body.textContent).not.toContain("private-new");
  ui.unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(mock.dispose).toHaveBeenCalledTimes(1);
});
test("assignment更新と切断後の再接続はinputを交換し古いinputを無効にする", async () => {
  const props = setup();
  const inputs: RuntimeInput[] = [],
    cleanups = [vi.fn(), vi.fn(), vi.fn()];
  const onRuntimeInput = vi.fn((input: RuntimeInput) => {
    inputs.push(input);
    return cleanups[inputs.length - 1]!;
  });
  const ui = render(<ViewerExperience {...props} onRuntimeInput={onRuntimeInput} />);
  await start();
  const next = structuredClone(props.connection);
  next.delivery.projectionInstance!.assignmentEpoch = "2";
  next.bootstrap.assignmentEpoch = 2;
  ui.rerender(<ViewerExperience {...props} connection={next} onRuntimeInput={onRuntimeInput} />);
  await waitFor(() => expect(inputs).toHaveLength(2));
  expect(cleanups[0]).toHaveBeenCalledTimes(1);
  act(() => inputs[0]!.applyControl({ connected: { connectionId: "old" } }));
  expect(mock.applyControl).not.toHaveBeenCalled();
  act(() => inputs[1]!.disconnected());
  expect(screen.getByText("接続が切れました")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
  fireEvent.click(screen.getByRole("button", { name: "再接続" }));
  await waitFor(() => expect(inputs).toHaveLength(3));
  expect(mock.start).toHaveBeenCalledTimes(1);
  expect(cleanups[1]).toHaveBeenCalledTimes(1);
});
test("再同期要求はidごとに一回通知し、接続callback例外を秘密値なしで表示する", async () => {
  const props = setup();
  let input!: RuntimeInput;
  const onRecoveryRequest = vi.fn();
  render(
    <ViewerExperience
      {...props}
      onRuntimeInput={(value) => {
        input = value;
      }}
      onRecoveryRequest={onRecoveryRequest}
    />,
  );
  await start();
  mock.applyState.mockImplementation(() => {
    mock.runtime = {
      ...mock.runtime!,
      phase: "resync-required",
      reason: "runtime-input-requires-resync",
    };
  });
  await act(async () => {
    input.applyState({ connected: { connectionId: "state" } });
  });
  expect(onRecoveryRequest).toHaveBeenCalledTimes(1);
  expect(screen.getByText("プレゼンテーションを再同期しています")).toBeTruthy();
  await act(async () => {
    input.applyState({ connected: { connectionId: "state" } });
  });
  expect(onRecoveryRequest).toHaveBeenCalledTimes(1);
});
test("接続callbackの例外ではinputを切断しcleanupの二重実行や機密値表示をしない", async () => {
  const props = setup();
  render(
    <ViewerExperience
      {...props}
      onRuntimeInput={() => {
        throw new Error("private-credential");
      }}
    />,
  );
  await start();
  expect(screen.getByRole("alert").textContent).toBe(
    "配信の接続準備に失敗しました。もう一度お試しください。",
  );
  expect(document.body.textContent).not.toContain("private-credential");
  expect(mock.reset).toHaveBeenCalled();
});

test("素材準備中と終了を区別し、更新操作と退出をメニューへ集約する", async () => {
  const props = setup();
  let input!: RuntimeInput;
  render(
    <ViewerExperience
      {...props}
      onRuntimeInput={(value) => {
        input = value;
      }}
    />,
  );
  await start();
  mock.applyControl.mockImplementation(() => {
    mock.runtime = { ...mock.runtime!, phase: "ready", rendering: "loading" };
  });
  act(() => input.applyControl({ connected: { connectionId: "test" } }));
  expect(screen.getByText("プレゼンテーションを準備しています")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "接続情報を更新" }));
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "ルームから退出" }));
  expect(props.onLeave).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
  mock.applyControl.mockImplementation(() => {
    mock.runtime = { ...mock.runtime!, phase: "ended", rendering: "idle" };
  });
  act(() => input.applyControl({ connected: { connectionId: "end" } }));
  expect(screen.getByText("ご視聴ありがとうございました")).toBeTruthy();
});
test("cleanupが例外を投げても二重実行せず新しい接続を安全に止める", async () => {
  const props = setup();
  const release = vi.fn(() => {
    throw new Error("private-cleanup");
  });
  const onRuntimeInput = vi.fn(() => release);
  const ui = render(<ViewerExperience {...props} onRuntimeInput={onRuntimeInput} />);
  await start();
  const next = structuredClone(props.connection);
  next.delivery.projectionInstance!.assignmentEpoch = "2";
  ui.rerender(<ViewerExperience {...props} connection={next} onRuntimeInput={onRuntimeInput} />);
  expect(screen.getByRole("alert").textContent).toBe(
    "配信の接続準備に失敗しました。もう一度お試しください。",
  );
  expect(document.body.textContent).not.toContain("private-cleanup");
  expect(onRuntimeInput).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
  ui.unmount();
  expect(release).toHaveBeenCalledTimes(1);
});
test("再同期callbackの例外を安全な表示にしinputを破棄する", async () => {
  const props = setup();
  let input!: RuntimeInput;
  const release = vi.fn();
  render(
    <ViewerExperience
      {...props}
      onRuntimeInput={(value) => {
        input = value;
        return release;
      }}
      onRecoveryRequest={() => {
        throw new Error("private-recovery");
      }}
    />,
  );
  await start();
  mock.applyState.mockImplementation(() => {
    mock.runtime = { ...mock.runtime!, phase: "resync-required" };
  });
  act(() => input.applyState({ connected: { connectionId: "recovery" } }));
  expect(screen.getByRole("alert").textContent).toBe(
    "配信の接続準備に失敗しました。もう一度お試しください。",
  );
  expect(document.body.textContent).not.toContain("private-recovery");
  expect(mock.reset).toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(1);
});

test("通信installerが差し替われば旧接続だけを解放し同じinputへ新しいinstallerを接続する", async () => {
  const props = setup();
  const release = vi.fn();
  const original = vi.fn<NonNullable<ViewerExperienceProps["onRuntimeInput"]>>(() => release),
    replacement = vi.fn<NonNullable<ViewerExperienceProps["onRuntimeInput"]>>();
  const ui = render(<ViewerExperience {...props} onRuntimeInput={original} />);
  await start();
  const firstInput = original.mock.calls[0]![0];
  ui.rerender(<ViewerExperience {...props} onRuntimeInput={replacement} />);
  expect(release).toHaveBeenCalledTimes(1);
  expect(replacement).toHaveBeenCalledTimes(1);
  expect(replacement.mock.calls[0]![0]).toBe(firstInput);
  ui.rerender(<ViewerExperience {...props} onRuntimeInput={replacement} />);
  expect(replacement).toHaveBeenCalledTimes(1);
  expect(mock.openRuntime).toHaveBeenCalledTimes(1);
});

test("旧installer・切断・停止・assignment変更・退出後のgetterは資格を返さない", async () => {
  const props = setup();
  const getters: (() => PreparedConnection)[] = [];
  const inputs: RuntimeInput[] = [];
  const install = vi.fn<NonNullable<ViewerExperienceProps["onRuntimeInput"]>>(
    (input, _connection, getConnection) => {
      inputs.push(input);
      getters.push(getConnection);
    },
  );
  const ui = render(<ViewerExperience {...props} onRuntimeInput={install} />);
  await start();
  expect(getters[0]!().bootstrap.credential).toBe("private-old");
  const replacement = vi.fn<NonNullable<ViewerExperienceProps["onRuntimeInput"]>>(
    (input, connection, getter) => install(input, connection, getter),
  );
  ui.rerender(<ViewerExperience {...props} onRuntimeInput={replacement} />);
  expect(() => getters[0]!()).toThrow("viewing-input-inactive");
  act(() => inputs.at(-1)!.disconnected());
  expect(() => getters[1]!()).toThrow("viewing-input-inactive");
  fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
  fireEvent.click(screen.getByRole("button", { name: "再接続" }));
  await waitFor(() => expect(getters).toHaveLength(3));
  const next = structuredClone(props.connection);
  next.delivery.projectionInstance!.assignmentEpoch = "2";
  ui.rerender(<ViewerExperience {...props} connection={next} onRuntimeInput={replacement} />);
  expect(() => getters[2]!()).toThrow("viewing-input-inactive");
  expect(getters.at(-1)!().delivery.projectionInstance!.assignmentEpoch).toBe("2");
  const afterAssignment = getters.at(-1)!;
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  expect(() => afterAssignment()).toThrow("viewing-input-inactive");
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
  await start();
  const finalGetter = getters.at(-1)!;
  ui.unmount();
  expect(() => finalGetter()).toThrow("viewing-input-inactive");
});

test("Snapshot再同期は明示restartで新inputへ復旧し古い回復callbackとinputを拒否する", async () => {
  const props = setup();
  const inputs: RuntimeInput[] = [];
  let restart!: () => RuntimeInput | null;
  const onRecoveryRequest = vi.fn<NonNullable<ViewerExperienceProps["onRecoveryRequest"]>>(
    (_request, _input, callback) => {
      restart = callback;
    },
  );
  const onRuntimeInput = vi.fn<NonNullable<ViewerExperienceProps["onRuntimeInput"]>>((input) => {
    inputs.push(input);
  });
  render(
    <ViewerExperience
      {...props}
      onRuntimeInput={onRuntimeInput}
      onRecoveryRequest={onRecoveryRequest}
    />,
  );
  await start();
  mock.applyState.mockImplementation(() => {
    mock.runtime = { ...mock.runtime!, phase: "resync-required" };
  });
  await act(async () => inputs[0]!.applyState({ connected: { connectionId: "recovery" } }));
  expect(onRecoveryRequest).toHaveBeenCalledTimes(1);
  let fresh: RuntimeInput | null = null;
  const oldRestart = restart;
  await act(async () => {
    fresh = oldRestart();
  });
  expect(fresh).not.toBeNull();
  await waitFor(() => expect(inputs).toHaveLength(2));
  expect(inputs[1]).toBe(fresh);
  expect(oldRestart()).toBeNull();
  mock.applyControl.mockImplementation(() => {
    mock.runtime = {
      ...mock.runtime!,
      phase: "ready",
      rendering: "ready",
      view: { clock: { runtimeTimeMilliseconds: 0 } } as RuntimeSnapshot["view"],
    };
  });
  const control = { connected: { connectionId: "snapshot" } };
  act(() => inputs[0]!.applyControl(control));
  expect(mock.applyControl).not.toHaveBeenCalled();
  await act(async () => inputs[1]!.applyControl(control));
  expect(document.querySelector("[data-phase]")?.getAttribute("data-phase")).toBe("viewing");
});
