import type {
  ControlServerItemWire,
  DeliveryManifestWire,
  StateServerItemWire,
} from "@unframe/contracts/presentation";
import {
  createRuntimeReducer,
  createRuntimeState,
  type RuntimeStoreSnapshot,
} from "./runtime-core";

export type { RuntimeStoreSnapshot } from "./runtime-core";

export function createRuntimeStore(delivery: DeliveryManifestWire) {
  const reduce = createRuntimeReducer(delivery);
  let state = createRuntimeState();
  return {
    getSnapshot(): RuntimeStoreSnapshot {
      return structuredClone(state.snapshot);
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
      state = reduce(state, { kind: "state", item });
    },
  };
}
