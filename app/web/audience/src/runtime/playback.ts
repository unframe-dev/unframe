import type {
  ControlServerItemWire,
  DeliveryManifestWire,
  ParticipantRuntimeView,
  StateServerItemWire,
} from "@unframe/contracts/presentation";
import { createRuntimeStore } from "./runtime-store";
import { createRuntimeClock } from "./runtime-clock";

export function createRuntimePlayback(options: {
  delivery: DeliveryManifestWire;
  present(view: ParticipantRuntimeView): Promise<void>;
  clear(): void;
  now?: () => number;
  frame?(view: ParticipantRuntimeView, runtimeTimeMilliseconds: number): void;
}) {
  const store = createRuntimeStore(options.delivery);
  let disposed = false;
  let generation = 0;
  let version = 0;
  let appliedVersion = -1;
  let pending: Promise<void> | null = null;
  let error: string | null = null;
  const clock = createRuntimeClock(options.now);
  let appliedView: ParticipantRuntimeView | null = null;
  function failRendering() {
    error = "presentation-render-failed";
    appliedView = null;
    generation++;
    options.clear();
  }
  function schedule() {
    const snapshot = store.getSnapshot();
    if (disposed || pending || error || snapshot.phase !== "ready" || !snapshot.view) return;
    const view = snapshot.view;
    const currentGeneration = generation;
    const currentVersion = version;
    pending = Promise.resolve()
      .then(async () => {
        if (disposed || generation !== currentGeneration) return;
        await options.present(view);
        if (!disposed && generation === currentGeneration) {
          appliedVersion = currentVersion;
          appliedView = view;
        }
      })
      .catch(() => {
        if (disposed || generation !== currentGeneration) return;
        failRendering();
      })
      .finally(() => {
        pending = null;
        if (appliedVersion !== version) schedule();
      });
  }
  function changed() {
    version++;
    const snapshot = store.getSnapshot();
    if (snapshot.phase !== "ready" || !snapshot.view) {
      generation++;
      appliedVersion = -1;
      appliedView = null;
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
        options.frame(appliedView, time);
      } catch {
        failRendering();
      }
    },
    applyControl(item: ControlServerItemWire) {
      if (disposed) return;
      store.applyControl(item);
      if (item?.connectionSnapshot && store.getSnapshot().phase === "ready") error = null;
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
      return {
        ...snapshot,
        rendering: error
          ? "error"
          : snapshot.phase !== "ready"
            ? "idle"
            : pending
              ? "loading"
              : appliedVersion === version
                ? "ready"
                : "idle",
        error,
      };
    },
    async waitForIdle() {
      while (pending) await pending;
    },
    restartState() {
      if (disposed) return;
      store.restartState();
    },
    reset() {
      if (disposed) return;
      error = null;
      store.reset();
      changed();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      store.reset();
      appliedView = null;
      clock.reset();
      options.clear();
    },
  };
}
