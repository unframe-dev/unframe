import type {
  ControlServerItemWire,
  DeliveryManifestWire,
  ParticipantRuntimeView,
  StateServerItemWire,
} from "@unframe-dev/contracts/presentation";
import { readTrackedPoses, type TrackedPoses, type TimedTrackedPoses } from "./tracked-poses";
import { createRuntimeStore } from "./runtime-store";
import { createRuntimeClock } from "./runtime-clock";
import { getAssetFailure, type AssetFailureDetails } from "../diagnostics/asset-failure";

export function createRuntimePlayback(options: {
  delivery: DeliveryManifestWire;
  present(view: ParticipantRuntimeView): Promise<void>;
  clear(): void;
  now?: () => number;
  frame?(
    view: ParticipantRuntimeView,
    runtimeTimeMilliseconds: number,
    bindings: TrackedPoses,
  ): void;
}) {
  const now = options.now ?? (() => performance.now());
  const store = createRuntimeStore(options.delivery, now);
  let disposed = false;
  let generation = 0;
  let stateGeneration = 0;
  let version = 0;
  let appliedVersion = -1;
  let pending: Promise<void> | null = null;
  let error: string | null = null;
  let assetFailure: AssetFailureDetails | null = null;
  let renderFailurePhase: "prepare" | "frame" | null = null;
  const clock = createRuntimeClock(now);
  let appliedView: ParticipantRuntimeView | null = null;
  let appliedPoses: TimedTrackedPoses = {};
  function failRendering(cause: unknown, phase: "prepare" | "frame") {
    error = "presentation-render-failed";
    assetFailure = getAssetFailure(cause);
    renderFailurePhase = phase;
    generation++;
    if (phase === "frame" || !appliedView) {
      appliedView = null;
      appliedPoses = {};
      options.clear();
    }
  }
  function schedule() {
    const snapshot = store.getSnapshot();
    if (disposed || pending || error || snapshot.phase !== "ready" || !snapshot.view) return;
    const view = snapshot.view;
    const bindings = store.getTrackedPosesSnapshot();
    const currentStateGeneration = stateGeneration;
    const currentGeneration = generation;
    const currentVersion = version;
    pending = Promise.resolve()
      .then(async () => {
        if (disposed || generation !== currentGeneration) return;
        await options.present(view);
        if (!disposed && generation === currentGeneration) {
          appliedVersion = currentVersion;
          appliedView = view;
          appliedPoses = stateGeneration === currentStateGeneration ? bindings : {};
        }
      })
      .catch((cause: unknown) => {
        if (disposed || generation !== currentGeneration) return;
        failRendering(cause, "prepare");
      })
      .finally(() => {
        pending = null;
        if (appliedVersion !== version) schedule();
      });
  }
  function changed() {
    version++;
    const snapshot = store.getSnapshot();
    // Group changes publish no view until exit, initialization and Step entry are complete.
    if (snapshot.phase === "ready" && !snapshot.view) return;
    if (snapshot.phase !== "ready" || !snapshot.view) {
      generation++;
      appliedVersion = -1;
      appliedView = null;
      appliedPoses = {};
      clock.reset();
      options.clear();
      return;
    }
    clock.synchronize(snapshot.view.clock);
    schedule();
  }
  return {
    prepareFrame() {
      if (disposed || error || !appliedView || !options.frame) return;
      const time = clock.read();
      if (time === null) return;
      try {
        options.frame(appliedView, time, readTrackedPoses(appliedPoses, now()));
      } catch (cause) {
        failRendering(cause, "frame");
      }
    },
    applyControl(item: ControlServerItemWire) {
      if (disposed) return;
      store.applyControl(item);
      if (item?.connectionSnapshot && store.getSnapshot().phase === "ready") {
        error = null;
        assetFailure = null;
        renderFailurePhase = null;
      }
      changed();
    },
    applyState(item: StateServerItemWire) {
      if (disposed) return;
      store.applyState(item);
      if (item?.connected && store.getSnapshot().phase === "ready") return;
      changed();
    },
    getSnapshot() {
      const snapshot = store.getSnapshot();
      const preparedDisplay =
        appliedView &&
        snapshot.view &&
        appliedView.presentationOrigin.version === snapshot.view.presentationOrigin.version &&
        appliedView.progression.currentGroupId === snapshot.view.progression.currentGroupId &&
        appliedView.progression.groupEntryEpoch === snapshot.view.progression.groupEntryEpoch;
      return {
        ...snapshot,
        rendering: error
          ? "error"
          : snapshot.phase !== "ready"
            ? "idle"
            : preparedDisplay
              ? "ready"
              : pending
                ? "loading"
                : appliedVersion === version
                  ? "ready"
                  : "idle",
        error,
        assetFailure: assetFailure ? { ...assetFailure } : null,
        renderFailurePhase,
      };
    },
    async waitForIdle() {
      while (pending) await pending;
    },
    restartState() {
      if (disposed) return;
      store.restartState();
      stateGeneration++;
      appliedPoses = {};
    },
    reset() {
      if (disposed) return;
      error = null;
      assetFailure = null;
      renderFailurePhase = null;
      store.reset();
      changed();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      assetFailure = null;
      renderFailurePhase = null;
      generation++;
      store.reset();
      appliedView = null;
      appliedPoses = {};
      clock.reset();
      options.clear();
    },
  };
}
