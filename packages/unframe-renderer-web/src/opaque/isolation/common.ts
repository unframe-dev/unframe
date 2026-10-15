export class OpaqueIsolationError extends Error {
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
    this.name = "OpaqueIsolationError";
  }
}

export type IsolatedOpaqueWorkerInput = {
  readonly workerPath: string;
  readonly browserPath: string;
  readonly runtimePaths: readonly string[];
  readonly input: unknown;
};

export type IsolatedOpaqueWorkerOptions = {
  readonly signal?: AbortSignal;
  readonly cgroupRoot?: string;
  readonly nodePath?: string;
  readonly runtimeEnvironment?: Readonly<Record<string, string>>;
  readonly deadlineMs?: number;
};

export const DEADLINE_MS = 120_000;
export const CLOSE_GRACE_MS = 2_000;
export const unavailable = (message: string): OpaqueIsolationError =>
  new OpaqueIsolationError("opaque-isolation-unavailable", message);
