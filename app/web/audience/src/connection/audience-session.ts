import { createStore } from "zustand/vanilla";
import { createSessionRecorder, downloadSessionDiagnostic } from "../diagnostics/session-recorder";
import type { ViewerApplication, ViewerConnectionOptions } from "../experience/viewer-application";
import type { ViewingSnapshot } from "../experience/viewing-session";
import type { createTrackingAdapter } from "../tracking/adapter";
import { readConnectionConfig } from "./application-config";
import { createAnonymousAudienceClient } from "./anonymous-client";
import { createJoinController } from "./join-controller";
import { createAudienceRealtime } from "./realtime-client";

export function createAudienceSession(options: {
  environment: Record<string, unknown>;
  trackingAdapter?: typeof createTrackingAdapter;
  onViewingSnapshot?(snapshot: ViewingSnapshot): void;
}) {
  const recorder = createSessionRecorder();
  const config = readConnectionConfig(options.environment);
  const controller =
    config.status === "configured"
      ? createJoinController({
          recorder,
          client: createAnonymousAudienceClient(config.config),
          capabilityProfileId: config.config.capabilityProfileId,
        })
      : null;
  const realtime = createAudienceRealtime({ recorder });
  const state = createStore<{
    screen: "join" | "loading" | "viewer";
    invalid: boolean;
    loadError: boolean;
  }>(() => ({ screen: "join", invalid: config.status === "invalid", loadError: false }));
  let viewer: ViewerApplication | null = null;
  let connection: ViewerConnectionOptions["connection"] | null = null;
  let revision: number | null = null;
  let generation = 0;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  function releaseViewer() {
    generation++;
    const previous = viewer;
    viewer = null;
    connection = null;
    revision = null;
    try {
      previous?.dispose();
    } catch {
      recorder.record("connection.stage", { stage: "failure" });
    }
  }
  async function observe() {
    if (disposed || !controller) return;
    const snapshot = controller.store.getState();
    if (snapshot.phase !== "prepared" && snapshot.phase !== "recovering") {
      releaseViewer();
      state.setState({ screen: "join" });
      if (snapshot.phase === "ended" || snapshot.phase === "error")
        options.onViewingSnapshot?.({
          phase: snapshot.phase,
          runtime: null,
          recovery: null,
          error: snapshot.phase === "error" ? snapshot.error : null,
        });
      return;
    }
    if (snapshot.phase === "prepared" && revision !== snapshot.revision) {
      connection = controller.getPrepared();
      revision = snapshot.revision;
    }
    if (!connection) return;
    const props: ViewerConnectionOptions = {
      recorder,
      connection,
      onRuntimeInput: realtime.install,
      onRecoveryRequest: realtime.recover,
      onReconnect: controller.reconnect,
      onLeave: controller.leave,
      onRefresh: () => {
        void controller.refresh();
      },
      ...(options.trackingAdapter ? { trackingAdapter: options.trackingAdapter } : {}),
      ...(options.onViewingSnapshot ? { onViewingSnapshot: options.onViewingSnapshot } : {}),
      recovering: snapshot.phase === "recovering",
      refreshing: snapshot.phase === "prepared" ? snapshot.refreshing : true,
      refreshError: snapshot.phase === "prepared" ? snapshot.refreshError : null,
    };
    if (viewer) {
      viewer.update(props);
      return;
    }
    const token = ++generation;
    state.setState({ screen: "loading", loadError: false });
    try {
      const { createViewerApplication } = await import("../experience/viewer-application");
      if (disposed || token !== generation) return;
      viewer = createViewerApplication(props);
      state.setState({ screen: "viewer" });
    } catch {
      if (disposed || token !== generation) return;
      controller.cancel();
      state.setState({ screen: "join", loadError: true });
    }
  }
  const checkExpiry = () => {
    if (!document.hidden) controller?.getPrepared();
  };
  return {
    store: {
      getState: state.getState,
      getInitialState: state.getInitialState,
      subscribe: state.subscribe,
    },
    controller,
    getViewer: () => viewer,
    start() {
      if (disposed || unsubscribe) return;
      unsubscribe = controller?.store.subscribe(() => {
        void observe();
      });
      document.addEventListener("visibilitychange", checkExpiry);
      void observe();
    },
    downloadDiagnostic() {
      downloadSessionDiagnostic(recorder);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      document.removeEventListener("visibilitychange", checkExpiry);
      releaseViewer();
      try {
        controller?.dispose();
      } finally {
        realtime.dispose();
      }
    },
  };
}
