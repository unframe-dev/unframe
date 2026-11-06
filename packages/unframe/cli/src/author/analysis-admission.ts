import { AuthorError } from "@unframe-dev/author-service";

let active = false;
let queued: { start(): void } | undefined;
const release = (): void => {
  if (queued) {
    const next = queued;
    queued = undefined;
    next.start();
  } else active = false;
};
/** One process and one waiting input bound aggregate analysis memory in the host. */
export const acquireAnalysisSlot = (
  signal: AbortSignal | undefined,
  timeout: number,
): Promise<() => void> => {
  if (!active) {
    active = true;
    return Promise.resolve(release);
  }
  if (queued)
    return Promise.reject(
      new AuthorError(
        503,
        "cli-analysis-busy",
        "Project analysis capacity is busy. Retry the operation.",
      ),
    );
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
    };
    const waiter = {
      start: () => {
        cleanup();
        resolve(release);
      },
    };
    const cancel = (error: AuthorError) => {
      if (queued !== waiter) return;
      queued = undefined;
      cleanup();
      reject(error);
    };
    const abort = () =>
      cancel(new AuthorError(409, "cli-cancelled", "Project analysis was cancelled."));
    const timer = setTimeout(
      () =>
        cancel(
          new AuthorError(
            503,
            "cli-analysis-time-limit",
            "Project analysis exceeded its time budget.",
          ),
        ),
      timeout,
    );
    queued = waiter;
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
};
