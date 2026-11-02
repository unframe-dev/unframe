import { assertLinuxIsolationAvailable, runLinuxWorker } from "./linux.js";
import {
  darwinResourceContract,
  assertDarwinIsolationAvailable,
  runDarwinWorker,
} from "./darwin.js";
import { unavailable, type IsolatedWorkerInput, type IsolatedWorkerOptions } from "./common.js";
export {
  WorkerIsolationError,
  type IsolatedWorkerInput,
  type IsolatedWorkerOptions,
} from "./common.js";

export const assertWorkerIsolationAvailable = (options: IsolatedWorkerOptions = {}): void => {
  if (process.platform === "linux") return assertLinuxIsolationAvailable(options);
  if (process.platform === "darwin") return assertDarwinIsolationAvailable(options);
  throw unavailable("opaque capture requires Linux or macOS Apple Silicon");
};
export const runIsolatedWorker = (
  input: IsolatedWorkerInput,
  options: IsolatedWorkerOptions = {},
): Promise<unknown> => {
  if (process.platform === "linux") return runLinuxWorker(input, options);
  if (process.platform === "darwin") return runDarwinWorker(input, options);
  return Promise.reject(unavailable("opaque capture requires Linux or macOS Apple Silicon"));
};

export { darwinResourceContract } from "./darwin.js";

// Increment the policy version whenever filesystem, IPC, network, or supervision policy changes.
export const getWorkerIsolationIdentity = () => {
  if (process.platform === "linux")
    return {
      backend: "bubblewrap-cgroup-v2",
      policyVersion: 2,
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
      policyVersion: 6,
      resources: darwinResourceContract,
    } as const;
  throw unavailable("opaque capture requires Linux or macOS Apple Silicon");
};
