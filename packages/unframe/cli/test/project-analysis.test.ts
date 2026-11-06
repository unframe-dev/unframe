import { expect, it } from "vite-plus/test";
import { createProjectAnalysis } from "../src/author/project-analysis.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
it("waits for superseded cleanup before running only the newest revision", async () => {
  const firstStarted = deferred<void>();
  const cleanup = deferred<void>();
  let active = 0;
  let peak = 0;
  const revisions: string[] = [];
  const analysis = createProjectAnalysis(
    async (revision: string, signal) => {
      revisions.push(revision);
      peak = Math.max(peak, ++active);
      try {
        if (revision === "a") {
          firstStarted.resolve();
          await new Promise<void>((done) =>
            signal.addEventListener("abort", () => done(), { once: true }),
          );
          await cleanup.promise;
          throw new Error("cancelled");
        }
        return revision;
      } finally {
        --active;
      }
    },
    (revision) => revision,
  );
  const first = analysis.request("a");
  await firstStarted.promise;
  const second = analysis.request("b");
  const third = analysis.request("c");
  expect(revisions).toEqual(["a"]);
  cleanup.resolve();
  expect(await Promise.all([first, second, third])).toEqual(["c", "c", "c"]);
  expect(revisions).toEqual(["a", "c"]);
  expect(peak).toBe(1);
  await analysis.close();
});
it("cancels one subscriber without interrupting another subscriber", async () => {
  const result = deferred<string>();
  let cancelled = false;
  const analysis = createProjectAnalysis(
    async (_revision: string, signal) => {
      signal.addEventListener("abort", () => {
        cancelled = true;
      });
      return result.promise;
    },
    (revision) => revision,
  );
  const controller = new AbortController();
  const disconnected = analysis.request("a", controller.signal);
  const remaining = analysis.request("a");
  const rejection = expect(disconnected).rejects.toMatchObject({ code: "cli-cancelled" });
  controller.abort();
  await rejection;
  expect(cancelled).toBe(false);
  result.resolve("a");
  expect(await remaining).toBe("a");
  await analysis.close();
});

it("accepts an immediate request for the same revision after completion", async () => {
  const analysis = createProjectAnalysis(
    async (revision: string) => revision,
    (revision) => revision,
  );
  expect(await analysis.request("a")).toBe("a");
  expect(await analysis.request("a")).toBe("a");
  await analysis.close();
});

it("aborts work when the last subscriber disconnects and waits for cleanup before replacement", async () => {
  const started = deferred<void>();
  const aborted = deferred<void>();
  const cleanup = deferred<void>();
  const revisions: string[] = [];
  const analysis = createProjectAnalysis(
    async (revision: string, signal) => {
      revisions.push(revision);
      if (revision === "a") {
        started.resolve();
        await new Promise<void>((done) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted.resolve();
              done();
            },
            { once: true },
          ),
        );
        await cleanup.promise;
        throw new Error("cancelled");
      }
      return revision;
    },
    (revision) => revision,
  );
  const controller = new AbortController();
  const first = analysis.request("a", controller.signal);
  const rejected = expect(first).rejects.toMatchObject({ code: "cli-cancelled" });
  await started.promise;
  controller.abort();
  await rejected;
  await aborted.promise;
  const replacement = analysis.request("b");
  expect(revisions).toEqual(["a"]);
  cleanup.resolve();
  expect(await replacement).toBe("b");
  expect(revisions).toEqual(["a", "b"]);
  await analysis.close();
});

it("waits for shutdown cleanup and rejects pending and future subscribers", async () => {
  const started = deferred<void>();
  const cleanup = deferred<void>();
  const analysis = createProjectAnalysis(
    async (_revision: string, signal) => {
      started.resolve();
      await new Promise<void>((done) =>
        signal.addEventListener("abort", () => done(), { once: true }),
      );
      await cleanup.promise;
      throw new Error("cancelled");
    },
    (revision) => revision,
  );
  const first = analysis.request("a");
  const rejected = expect(first).rejects.toMatchObject({ code: "cli-cancelled" });
  await started.promise;
  let closed = false;
  const closing = analysis.close().then(() => {
    closed = true;
  });
  await rejected;
  expect(closed).toBe(false);
  await expect(analysis.request("b")).rejects.toMatchObject({ code: "cli-cancelled" });
  cleanup.resolve();
  await closing;
  expect(closed).toBe(true);
});
