import { createStore } from "zustand/vanilla";
import type { PreparedConnection } from "../connection/join-controller";
import { createAudienceAssetFetch } from "../connection/asset-fetch";
import { buildViewerDiagnostic } from "../diagnostics/viewer-diagnostic";
import { downloadSessionDiagnostic, type SessionRecorder } from "../diagnostics/session-recorder";
import { configureMarkerSize, loadBoardConfig, type BoardConfig } from "../fiducials/config";
import type { createTrackingAdapter } from "../tracking/adapter";
import { createAnchorSession, type AnchorSessionSnapshot } from "./anchor-session";
import {
  createViewingSession,
  createViewingStore,
  type RuntimeInput,
  type ViewingSnapshot,
} from "./viewing-session";

export interface ViewerConnectionOptions {
  recorder?: SessionRecorder;
  connection: PreparedConnection;
  onLeave(): void;
  onRefresh(): void;
  onReconnect(): Promise<void>;
  refreshing: boolean;
  recovering?: boolean;
  refreshError: string | null;
  trackingAdapter?: typeof createTrackingAdapter;
  onViewingSnapshot?(snapshot: ViewingSnapshot): void;
  onRuntimeInput?(
    input: RuntimeInput,
    connection: PreparedConnection,
    getConnection: () => PreparedConnection,
    restartInput: () => RuntimeInput | null,
  ): void | (() => void);
  onRecoveryRequest?(
    request: NonNullable<ViewingSnapshot["recovery"]>,
    input: RuntimeInput,
    restartInput: () => RuntimeInput | null,
  ): void;
}
export interface ViewerScreenState {
  config: BoardConfig | null;
  markerSize: number | null;
  anchor: AnchorSessionSnapshot | null;
  error: string | null;
  refreshing: boolean;
  recovering: boolean;
  refreshError: string | null;
  live: boolean;
  diagnosticsEnabled: boolean;
}
const connectionFailure = "配信の接続準備に失敗しました。もう一度お試しください。";

export function createViewerApplication(
  initial: ViewerConnectionOptions & { loadConfig?: typeof loadBoardConfig },
) {
  let options = initial;
  const state = createStore<ViewerScreenState>(() => ({
    config: null,
    markerSize: null,
    anchor: null,
    error: null,
    refreshing: initial.refreshing,
    recovering: initial.recovering ?? false,
    refreshError: initial.refreshError,
    live: !!initial.onRuntimeInput,
    diagnosticsEnabled: !!initial.recorder,
  }));
  const viewingState = createViewingStore();
  let board: BoardConfig | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let host: ReturnType<typeof createAnchorSession> | null = null;
  let viewer: ReturnType<typeof createViewingSession> | null = null;
  let unsubscribe: (() => void) | undefined;
  let binding: {
    input: RuntimeInput;
    installer: ViewerConnectionOptions["onRuntimeInput"];
    cleanup?: () => void;
  } | null = null;
  let recovery: { input: RuntimeInput; id: number } | null = null;
  let lastRendering: string | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let disposed = false;
  const setError = (error: string | null) => {
    if (!disposed) state.setState({ error });
  };

  function clearBinding(reportError: boolean) {
    const previous = binding;
    binding = null;
    try {
      previous?.cleanup?.();
      return true;
    } catch {
      if (reportError) setError(connectionFailure);
      return false;
    }
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (
      disposed ||
      viewingState.getState().phase !== "disconnected" ||
      !options.onRuntimeInput ||
      options.refreshing
    )
      return;
    reconnectTimer = setTimeout(() => {
      void options.onReconnect();
    }, 2000);
  }
  function syncInput() {
    const input = viewer?.getInput() ?? null;
    if (
      (input === binding?.input && options.onRuntimeInput === binding.installer) ||
      (!input && !binding)
    )
      return;
    if (!clearBinding(true)) {
      input?.disconnected();
      return;
    }
    if (!input || disposed) return;
    const target = viewer;
    const installed: NonNullable<typeof binding> = { input, installer: options.onRuntimeInput };
    binding = installed;
    try {
      const cleanup = options.onRuntimeInput?.(
        input,
        structuredClone(options.connection),
        () => {
          if (disposed || binding !== installed || viewer?.getInput() !== input)
            throw new Error("viewing-input-inactive");
          return structuredClone(options.connection);
        },
        () => {
          if (
            disposed ||
            binding !== installed ||
            viewer !== target ||
            target?.getInput() !== input
          )
            return null;
          return target.restartInput();
        },
      );
      if (cleanup) {
        if (!disposed && binding === installed && viewer?.getInput() === input)
          installed.cleanup = cleanup;
        else cleanup();
      }
    } catch {
      setError(connectionFailure);
      input.disconnected();
    }
  }
  function observe() {
    if (!viewer || disposed) return;
    const target = viewer;
    syncInput();
    if (disposed || viewer !== target) return;
    const viewing = target.getSnapshot();
    const request = viewing.recovery;
    const input = target.getInput();
    if (
      request &&
      input &&
      options.onRecoveryRequest &&
      (recovery?.input !== input || recovery.id !== request.id)
    ) {
      recovery = { input, id: request.id };
      try {
        options.onRecoveryRequest(request, input, () => {
          if (
            disposed ||
            viewer !== target ||
            target.getInput() !== input ||
            target.getSnapshot().recovery?.id !== request.id
          )
            return null;
          return target.restartInput();
        });
      } catch {
        setError(connectionFailure);
        input.disconnected();
      }
    }
    if (disposed || viewer !== target || target.getSnapshot() !== viewing) return;
    options.onViewingSnapshot?.(viewing);
    const runtime = viewing.runtime;
    if (runtime?.rendering !== lastRendering) {
      lastRendering = runtime?.rendering;
      if (runtime?.rendering)
        options.recorder?.record("assets.ready", {
          stage: runtime.rendering,
          sessionId: options.connection.session?.id,
          code: runtime.error ?? undefined,
          renderPhase: runtime.renderFailurePhase ?? undefined,
          assetKind: runtime.assetFailure?.kind,
          assetStage: runtime.assetFailure?.stage,
          assetCode: runtime.assetFailure?.code,
          httpStatus: runtime.assetFailure?.httpStatus,
        });
    }
    options.recorder?.observe({
      sessionId: options.connection.session?.id,
      runtimeId: options.connection.bootstrap.runtimeId,
      assignmentEpoch: String(options.connection.bootstrap.assignmentEpoch),
      publicationEpoch: String(options.connection.bootstrap.publicationFence?.publicationEpoch),
      groupId: runtime?.view?.progression.currentGroupId,
      stepId: runtime?.view?.progression.currentStepId,
      stage: viewing.phase,
      code: viewing.error ?? undefined,
      reliableSequence: runtime?.reliableSequence,
      stateSequence: runtime?.stateSequence,
      runtimeTimeMs: runtime?.view?.clock.runtimeTimeMilliseconds,
    });
    scheduleReconnect();
  }
  function release() {
    clearTimeout(reconnectTimer);
    clearBinding(false);
    unsubscribe?.();
    unsubscribe = undefined;
    const previous = viewer;
    viewer = null;
    host = null;
    recovery = null;
    previous?.dispose();
  }
  function connect() {
    if (disposed || !viewer) return;
    if (options.recovering) {
      clearBinding(false);
      viewer.getInput()?.disconnected();
      return;
    }
    const disconnected = viewer.getSnapshot().phase === "disconnected";
    viewer.updateDelivery(options.connection.delivery);
    if (disconnected && !viewer.getInput()) viewer.restartInput();
    syncInput();
  }
  function configure() {
    if (!board || !canvas || disposed) return;
    release();
    const markerSize = state.getState().markerSize;
    const config = markerSize === null ? board : configureMarkerSize(board, markerSize);
    state.setState({ config, anchor: null, error: null });
    const nextHost = createAnchorSession({
      canvas,
      config,
      showGuides: false,
      ...(options.trackingAdapter ? { trackingAdapter: options.trackingAdapter } : {}),
      fetcher: createAudienceAssetFetch(() => options.connection),
      onChange(anchor) {
        if (!disposed && host === nextHost) state.setState({ anchor });
      },
    });
    host = nextHost;
    viewer = createViewingSession(nextHost, viewingState);
    state.setState({ anchor: nextHost.getSnapshot() });
    unsubscribe = viewer.subscribe(observe);
    connect();
    observe();
  }
  async function reload() {
    if (disposed) return;
    const token = ++generation;
    release();
    board = null;
    state.setState({ config: null, anchor: null, error: null });
    try {
      const loaded = await (initial.loadConfig ?? loadBoardConfig)();
      if (disposed || token !== generation) return;
      board = loaded;
      configure();
    } catch {
      if (!disposed && token === generation)
        setError("会場の設定を読み込めません。メニューから設定を再読み込みしてください。");
    }
  }
  return {
    store: {
      getState: state.getState,
      getInitialState: state.getInitialState,
      subscribe: state.subscribe,
    },
    viewingStore: {
      getState: viewingState.getState,
      getInitialState: viewingState.getInitialState,
      subscribe: viewingState.subscribe,
    },
    mount(surface: HTMLCanvasElement) {
      if (disposed) return;
      canvas = surface;
      void reload();
    },
    update(next: ViewerConnectionOptions) {
      if (disposed) return;
      const connectionChanged =
        options.connection !== next.connection || options.recovering !== next.recovering;
      const adapterChanged = options.trackingAdapter !== next.trackingAdapter;
      options = { ...next, ...(initial.loadConfig ? { loadConfig: initial.loadConfig } : {}) };
      state.setState({
        refreshing: next.refreshing,
        recovering: next.recovering ?? false,
        refreshError: next.refreshError,
        live: !!next.onRuntimeInput,
        diagnosticsEnabled: !!next.recorder,
      });
      if (adapterChanged) configure();
      else if (connectionChanged) connect();
      else syncInput();
      scheduleReconnect();
    },
    async start() {
      if (disposed || options.recovering || !viewer) return;
      setError(null);
      if (host?.getSnapshot().stage === "running") viewer.restartInput();
      else await viewer.start(options.connection.delivery);
    },
    stop() {
      viewer?.stop();
    },
    reconnect() {
      if (!disposed) {
        setError(null);
        void options.onReconnect();
      }
    },
    refresh() {
      if (!disposed) options.onRefresh();
    },
    leave() {
      if (!disposed) options.onLeave();
    },
    setMarkerSize(size: number) {
      if (disposed) return;
      state.setState({ markerSize: size });
      configure();
    },
    reload,
    async resumeMedia() {
      try {
        await host?.resumeMediaPlayback();
      } catch {
        setError("動画の再生を開始できませんでした。");
      }
    },
    downloadDiagnostic() {
      if (disposed) return;
      const payload = buildViewerDiagnostic({
        tracking: host?.getSnapshot() ?? null,
        viewing: viewingState.getState(),
        context: host?.getDiagnosticContext() ?? null,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "audience-viewer-checkpoint.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    downloadConnectionDiagnostic() {
      if (!disposed && options.recorder) downloadSessionDiagnostic(options.recorder);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      release();
      canvas = null;
      board = null;
    },
  };
}
export type ViewerApplication = ReturnType<typeof createViewerApplication>;
