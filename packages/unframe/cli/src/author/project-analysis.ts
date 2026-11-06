import { AuthorError } from "@unframe-dev/author-service";

const cancelled = () => new AuthorError(409, "cli-cancelled", "Project analysis was cancelled.");

/** Owns one running revision and one replaceable pending revision. */
export const createProjectAnalysis = <Input, Output>(
  run: (input: Input, signal: AbortSignal) => Promise<Output>,
  revisionFor: (input: Input) => string,
) => {
  type Waiter = { resolve(value: Output): void; reject(error: unknown): void };
  const waiters = new Set<Waiter>();
  let closed = false;
  let pending: { input: Input; revision: string } | undefined;
  let running:
    | { revision: string; controller: AbortController; promise: Promise<void> }
    | undefined;
  const start = () => {
    if (running || !pending || closed || waiters.size === 0) return;
    const next = pending;
    pending = undefined;
    const controller = new AbortController();
    const current = { revision: next.revision, controller, promise: Promise.resolve() };
    running = current;
    current.promise = Promise.resolve()
      .then(() => run(next.input, controller.signal))
      .then(
        (value) => {
          if (controller.signal.aborted || pending) return;
          running = undefined;
          for (const waiter of waiters) waiter.resolve(value);
          waiters.clear();
        },
        (error: unknown) => {
          if (pending) return;
          running = undefined;
          for (const waiter of waiters) waiter.reject(error);
          waiters.clear();
        },
      )
      .finally(() => {
        if (running === current) running = undefined;
        start();
      });
  };
  return {
    request(input: Input, signal?: AbortSignal): Promise<Output> {
      if (closed || signal?.aborted) return Promise.reject(cancelled());
      const revision = revisionFor(input);
      return new Promise<Output>((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener("abort", abort);
        const waiter: Waiter = {
          resolve: (value) => {
            cleanup();
            resolve(value);
          },
          reject: (error) => {
            cleanup();
            reject(error);
          },
        };
        const abort = () => {
          waiters.delete(waiter);
          waiter.reject(cancelled());
          if (waiters.size === 0) {
            pending = undefined;
            running?.controller.abort();
          }
        };
        waiters.add(waiter);
        signal?.addEventListener("abort", abort, { once: true });
        if (!running || running.controller.signal.aborted || running.revision !== revision) {
          pending = { input, revision };
          running?.controller.abort();
        }
        start();
      });
    },
    async close() {
      closed = true;
      pending = undefined;
      for (const waiter of waiters) waiter.reject(cancelled());
      waiters.clear();
      running?.controller.abort();
      await running?.promise;
    },
  };
};
