import type {
  ControlServerItemWire,
  DeliveryManifestWire,
  StateServerItemWire,
} from "@unframe-dev/contracts/presentation";
import { readAnchorBindings } from "./anchor-bindings";
import {
  createRuntimeReducer,
  createRuntimeState,
  type RuntimeStoreSnapshot,
} from "./runtime-core";

export type { RuntimeStoreSnapshot } from "./runtime-core";

export function createRuntimeStore(
  delivery: DeliveryManifestWire,
  now: () => number = () => performance.now(),
) {
  const reduce = createRuntimeReducer(delivery);
  let state = createRuntimeState();
  return {
    getSnapshot(): RuntimeStoreSnapshot {
      return structuredClone(state.snapshot);
    },
    getAnchorBindings() {
      return readAnchorBindings(state.anchorBindings, now());
    },
    getAnchorBindingsSnapshot() {
      return structuredClone(state.anchorBindings);
    },
    reset() {
      state = reduce(state, { kind: "reset" });
    },
    restartState() {
      state = reduce(state, { kind: "restart-state" });
    },
    applyControl(item: ControlServerItemWire) {
      state = reduce(state, { kind: "control", item });
    },
    applyState(item: StateServerItemWire) {
      state = reduce(state, { kind: "state", item, receivedAtMilliseconds: now() });
    },
  };
}
