import { createStore, type StoreApi } from "zustand/vanilla";
import {
  encodeWireMessage,
  type ControlServerItemWire,
  type DeliveryManifestWire,
  type StateServerItemWire,
} from "@unframe/contracts/presentation";
import type { createAnchorSession } from "./anchor-session";
import type { createRuntimePlayback } from "../runtime/playback";

type Runtime = ReturnType<typeof createRuntimePlayback>;
type Host = Pick<
  ReturnType<typeof createAnchorSession>,
  "start" | "stop" | "dispose" | "openRuntime" | "getSnapshot"
>;
export interface RuntimeInput {
  applyControl(item: ControlServerItemWire): void;
  applyState(item: StateServerItemWire): void;
  disconnected(): void;
  restartState(): void;
  getReadiness(): { reliableSequence: string; presentationOriginVersion: string } | null;
}
export interface ViewingSnapshot {
  phase:
    | "idle"
    | "starting"
    | "awaiting-snapshot"
    | "loading"
    | "viewing"
    | "resync-required"
    | "disconnected"
    | "ended"
    | "error";
  runtime: ReturnType<Runtime["getSnapshot"]> | null;
  recovery: { id: number; kind: "snapshot" | "keyframe"; afterSequence: string } | null;
  error: string | null;
}
function staticDelivery(delivery: DeliveryManifestWire) {
  return encodeWireMessage("unframe.delivery.DeliveryManifest", { ...delivery, assetAccess: [] });
}
function sameDelivery(a: DeliveryManifestWire, b: DeliveryManifestWire) {
  const first = staticDelivery(a),
    second = staticDelivery(b);
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}

export function createViewingStore() {
  return createStore<ViewingSnapshot>(() => ({
    phase: "idle",
    runtime: null,
    recovery: null,
    error: null,
  }));
}

export function createViewingSession(host: Host, state = createViewingStore()) {
  const store: Pick<
    StoreApi<ViewingSnapshot>,
    "getState" | "getInitialState" | "subscribe"
  > = state;
  let runtime: Runtime | null = null;
  let delivery: DeliveryManifestWire | null = null;
  let assignmentKey: string | null = null;
  let minimumReliableSequence = 0n;
  let input: RuntimeInput | null = null;
  let disposed = false;
  let generation = 0;
  let recoveryId = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let settling: Promise<void> | null = null;
  function publish(next: ViewingSnapshot) {
    state.setState(next, true);
  }
  function setDelivery(next: DeliveryManifestWire) {
    const key = JSON.stringify([
      next.sessionId,
      next.publication?.presentationId,
      next.publication?.publicationEpoch,
      next.publication?.publicationManifestHash,
      next.projectionInstance?.assignmentEpoch,
      next.projectionInstance?.projectionProfileId,
    ]);
    if (key !== assignmentKey) minimumReliableSequence = 0n;
    assignmentKey = key;
    delivery = structuredClone(next);
  }
  function detach(reset: boolean) {
    const previous = runtime;
    generation++;
    clearInterval(timer);
    timer = undefined;
    input = null;
    runtime = null;
    settling = null;
    if (reset) previous?.reset();
  }
  function fail(error: string, stopHost = false) {
    try {
      detach(true);
    } catch {
      /* The failed runtime is already detached. */
    }
    if (stopHost) {
      try {
        host.stop();
      } catch {
        /* Keep platform exceptions out of public state. */
      }
    }
    publish({ phase: "error", runtime: null, recovery: null, error });
  }
  function inspect() {
    if (!runtime || disposed) return;
    try {
      if (host.getSnapshot().stage !== "running") {
        fail("viewing-host-unavailable");
        return;
      }
      const state = runtime.getSnapshot();
      const sequence = BigInt(state.reliableSequence);
      if (sequence > minimumReliableSequence) minimumReliableSequence = sequence;
      const kind: "snapshot" | "keyframe" | null =
        state.phase === "resync-required"
          ? "snapshot"
          : state.phase === "ready" && state.stateSync === "awaiting-keyframe"
            ? "keyframe"
            : null;
      const recovery = kind
        ? store.getState().recovery?.kind === kind
          ? store.getState().recovery
          : { id: ++recoveryId, kind, afterSequence: state.reliableSequence }
        : null;
      publish({
        phase:
          state.phase === "ended"
            ? "ended"
            : state.phase === "resync-required"
              ? "resync-required"
              : state.error
                ? "error"
                : state.phase === "awaiting-snapshot"
                  ? "awaiting-snapshot"
                  : state.rendering === "ready" && state.view
                    ? "viewing"
                    : "loading",
        runtime: state,
        recovery,
        error: state.error,
      });
    } catch {
      fail("presentation-render-failed");
    }
  }
  function bind() {
    if (!delivery || disposed) return;
    try {
      detach(true);
      if (host.getSnapshot().stage !== "running") throw new Error();
      const token = generation;
      const target = host.openRuntime(delivery);
      runtime = target;
      const current = () => !disposed && token === generation && runtime === target;
      const apply = (callback: () => void) => {
        if (!current()) return;
        try {
          callback();
          inspect();
          if (!current()) return;
          const work = target.waitForIdle();
          settling = work;
          void work
            .then(() => {
              if (current()) inspect();
            })
            .catch(() => {
              if (current()) fail("presentation-render-failed");
            })
            .finally(() => {
              if (settling === work) settling = null;
            });
        } catch {
          if (current()) fail("runtime-input-failed");
        }
      };
      input = {
        restartState() {
          if (!current()) return;
          target.restartState();
          inspect();
        },
        getReadiness() {
          if (!current()) return null;
          const state = target.getSnapshot();
          if (state.phase !== "ready" || state.rendering !== "ready" || !state.view) return null;
          return {
            reliableSequence: state.reliableSequence,
            presentationOriginVersion: String(state.view.presentationOrigin.version),
          };
        },
        applyControl(item) {
          apply(() => {
            if (
              item.connectionSnapshot &&
              BigInt(item.connectionSnapshot.reliableSequence ?? "0") < minimumReliableSequence
            )
              throw new Error("runtime-sequence-regressed");
            target.applyControl(item);
          });
        },
        applyState(item) {
          apply(() => target.applyState(item));
        },
        disconnected() {
          if (!current()) return;
          try {
            detach(true);
          } catch {
            /* The old input must stay invalid after a failure. */
          }
          publish({ phase: "disconnected", runtime: null, recovery: null, error: null });
        },
      };
      timer = setInterval(inspect, 150);
      inspect();
    } catch {
      fail("viewing-start-failed");
    }
  }
  return {
    store,
    getSnapshot: store.getState,
    subscribe: store.subscribe,
    getInput: () => input,
    getRuntimeSnapshot: () => runtime?.getSnapshot() ?? store.getState().runtime,
    async start(next: DeliveryManifestWire, startCamera = true) {
      if (disposed || store.getState().phase === "starting") return;
      const token = generation + 1;
      try {
        detach(true);
        setDelivery(next);
        publish({ phase: "starting", runtime: null, recovery: null, error: null });
        if (startCamera) await host.start();
        if (disposed || token !== generation) return;
        if (host.getSnapshot().stage !== "running") throw new Error();
        bind();
      } catch {
        if (!disposed && token === generation) fail("viewing-start-failed", true);
      }
    },
    updateDelivery(next: DeliveryManifestWire) {
      if (disposed) return;
      try {
        if (delivery && sameDelivery(delivery, next)) {
          // Runtime catalog and fences stay fixed; only future asset requests use refreshed access.
          delivery.assetAccess = structuredClone(next.assetAccess ?? []);
          return;
        }
        setDelivery(next);
        if (store.getState().phase !== "idle" && store.getState().phase !== "starting") bind();
      } catch {
        fail("viewing-start-failed");
      }
    },
    restartInput() {
      if (!disposed && store.getState().phase !== "starting") bind();
      return input;
    },
    async waitForIdle() {
      const target = runtime;
      try {
        await (settling ?? target?.waitForIdle());
        if (!disposed && target === runtime) inspect();
      } catch {
        if (!disposed && target === runtime) fail("presentation-render-failed");
      }
    },
    stop() {
      if (disposed) return;
      try {
        detach(false);
        host.stop();
      } catch {
        fail("viewing-stop-failed");
        return;
      }
      delivery = null;
      publish({ phase: "idle", runtime: null, recovery: null, error: null });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detach(false);
      delivery = null;
      publish({ phase: "idle", runtime: null, recovery: null, error: null });
      host.dispose();
    },
  };
}
