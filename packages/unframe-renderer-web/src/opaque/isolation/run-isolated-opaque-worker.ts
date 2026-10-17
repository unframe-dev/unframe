import { assertLinuxIsolationAvailable, runLinuxOpaqueWorker } from "./linux.js";
import {
  darwinResourceContract,
  assertDarwinIsolationAvailable,
  runDarwinOpaqueWorker,
} from "./darwin.js";
import {
  unavailable,
  type IsolatedOpaqueWorkerInput,
  type IsolatedOpaqueWorkerOptions,
} from "./common.js";
export {
  OpaqueIsolationError,
  type IsolatedOpaqueWorkerInput,
  type IsolatedOpaqueWorkerOptions,
} from "./common.js";

export const assertOpaqueIsolationAvailable = (options: IsolatedOpaqueWorkerOptions = {}): void => {
  if (process.platform === "linux") return assertLinuxIsolationAvailable(options);
  if (process.platform === "darwin") return assertDarwinIsolationAvailable(options);
  throw unavailable("opaque capture requires Linux or macOS Apple Silicon");
};
export const runIsolatedOpaqueWorker = (
  input: IsolatedOpaqueWorkerInput,
  options: IsolatedOpaqueWorkerOptions = {},
): Promise<unknown> => {
  if (process.platform === "linux") return runLinuxOpaqueWorker(input, options);
  if (process.platform === "darwin") return runDarwinOpaqueWorker(input, options);
  return Promise.reject(unavailable("opaque capture requires Linux or macOS Apple Silicon"));
};

export { darwinResourceContract } from "./darwin.js";

// Increment the policy version whenever filesystem, IPC, network, or supervision policy changes.
export const getOpaqueIsolationIdentity = () => {
  if (process.platform === "linux")
    return {
      backend: "bubblewrap-cgroup-v2",
      policyVersion: 1,
      resources: {
        hardSubtreeLimits: true,
        memoryBytes: 1073741824,
        processes: 128,
        deadlineMs: 120000,
      },
    } as const;
  if (process.platform === "darwin" && process.arch === "arm64")
    return {
      backend: "seatbelt-process-group-monitor",
      policyVersion: 3,
      resources: darwinResourceContract,
    } as const;
  throw unavailable("opaque capture requires Linux or macOS Apple Silicon");
};
