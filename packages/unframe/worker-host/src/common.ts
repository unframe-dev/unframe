export class WorkerIsolationError extends Error {
  constructor(
    readonly code:
      | "opaque-isolation-unavailable"
      | "opaque-capture-failed"
      | "opaque-capture-timeout"
      | "opaque-capture-cancelled"
      | "opaque-capture-resource-limit",
    message: string,
  ) {
    super(message);
    this.name = "WorkerIsolationError";
  }
}

export type IsolatedWorkerInput = {
  readonly workerPath: string;
  readonly mounts?: readonly { readonly source: string; readonly destination: string }[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly runtimePaths: readonly string[];
  readonly input: unknown;
};

export type IsolatedWorkerOptions = {
  readonly signal?: AbortSignal;
  readonly cgroupRoot?: string;
  readonly nodePath?: string;
  readonly runtimeEnvironment?: Readonly<Record<string, string>>;
  readonly deadlineMs?: number;
};

export const DEADLINE_MS = 120_000;
export const CLOSE_GRACE_MS = 2_000;
export const unavailable = (message: string): WorkerIsolationError =>
  new WorkerIsolationError("opaque-isolation-unavailable", message);
