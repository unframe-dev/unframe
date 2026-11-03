import type { BuildJob, PreviewPlaybackResponse } from "@unframe/contracts/author-http";
import type { HostApi } from "../infra/host-api";
import type { PreviewDriver } from "./preview-driver";
import { createPreviewStore, type PreviewStore } from "./preview-store";
import { createPlaybackController } from "./playback-controller";
import { acceptsNotification, requiresRecovery } from "./preview-state";
import { UnityExchangeError } from "../infra/unity-exchange";
const id = () => crypto.randomUUID().replaceAll("-", "");
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
export function createPreviewController(input: {
  api: HostApi;
  driver: PreviewDriver;
  store?: PreviewStore;
  onRevision?(revision: string): void;
  pollMilliseconds?: number;
}) {
  const store = input.store ?? createPreviewStore();
  let epoch = 0,
    closed = false,
    abort = new AbortController();
  let loadQueue = Promise.resolve();
  type Build = {
    key: string;
    accepted: Promise<BuildJob>;
    cancellation?: Promise<void>;
  };
  const builds = new Set<Build>();
  const cleanup = new AbortController();
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let desiredKey: string | undefined;
  const running = (job: BuildJob) => job.status === "queued" || job.status === "running";
  const enqueue = (action: () => Promise<void>) => {
    loadQueue = loadQueue.catch(() => undefined).then(action);
    return loadQueue;
  };
  const cancelBuild = (build: Build): Promise<void> => {
    if (build.cancellation) return build.cancellation;
    const cancellation = (async () => {
      let job: BuildJob;
      try {
        job = await build.accepted;
      } catch {
        return;
      }
      job = await input.api.cancel(job.buildId);
      while (running(job)) {
        await wait(input.pollMilliseconds ?? 250, cleanup.signal);
        job = await input.api.job(job.buildId, cleanup.signal);
      }
    })();
    build.cancellation = cancellation;
    void cancellation.then(
      () => builds.delete(build),
      () => {
        delete build.cancellation;
      },
    );
    return cancellation;
  };
  const current = (serial: number) => !closed && epoch === serial;
  const playback = createPlaybackController({
    api: input.api,
    driver: input.driver,
    onState: (state) =>
      store.setState({
        playback: state,
        status: "ready",
        phase: "ready",
        recovery: "healthy",
        error: null,
      }),
    onDiagnostic: (error, unavailable) =>
      store.setState({
        error: message(error),
        ...(unavailable
          ? {
              status: "reload-required" as const,
              phase: "failed" as const,
              recovery: "reloadRequired" as const,
            }
          : {}),
      }),
    onFault: (error, response) => {
      void recover(error, response);
    },
  });
  async function recover(error: unknown, response: PreviewPlaybackResponse | null) {
    const serial = epoch,
      loaded = store.getState().loaded,
      signal = abort.signal;
    if (closed || !loaded || store.getState().status === "recovering") return;
    playback.invalidate();
    store.setState({ status: "recovering", recovery: "restoring", error: message(error) });
    try {
      if (!response?.state.sequence) throw new Error("復元できる表示記録がありません。");
      const restored = await input.api.playback(
        { requestId: loaded.requestId, command: "recover", sequence: response.state.sequence },
        signal,
      );
      if (!current(serial)) return;
      await input.driver.restore(restored.state, signal);
      if (!current(serial)) return;
      const confirmed = await input.api.playback(
        { requestId: loaded.requestId, command: "applied", sequence: restored.state.sequence! },
        signal,
      );
      if (!current(serial)) return;
      if (
        confirmed.state.requestId !== loaded.requestId ||
        confirmed.state.sequence !== restored.state.sequence
      )
        throw new Error("Restoration acknowledgement does not match.");
      store.setState({
        status: "ready",
        phase: "ready",
        recovery: "healthy",
        playback: confirmed,
        error: null,
      });
      playback.load(loaded.requestId);
    } catch (failure) {
      if (!current(serial)) return;
      try {
        await input.api.playback(
          { requestId: loaded.requestId, command: "invalidateDisplay" },
          signal,
        );
      } catch {
        /* The Host may already have invalidated the request. */
      }
      if (current(serial))
        store.setState({
          status: "reload-required",
          phase: "failed",
          recovery: "reloadRequired",
          playback: null,
          error: message(failure),
        });
    }
  }
  const unsubscribe = input.driver.subscribeFailure((notification) => {
    const snapshot = store.getState();
    if (snapshot.status !== "ready" || !acceptsNotification(snapshot, notification)) return;
    if (notification.message === "video-user-activation-required") {
      playback.command({ command: "pause" });
      store.setState({ error: notification.message });
    } else if (requiresRecovery(notification))
      void recover(
        new UnityExchangeError(notification.message ?? "Unity Preview failed.", notification),
        snapshot.playback,
      );
    else store.setState({ error: notification.message ?? "Unity Preview input was rejected." });
  });
  function request(
    channel: "dev" | "dist",
    revision: string,
    options: { debounce?: boolean } = {},
  ) {
    if (closed) return;
    const key = `${channel}\0${revision}`;
    if (options.debounce && desiredKey === key) return;
    const serial = ++epoch;
    desiredKey = key;
    clearTimeout(scheduled);
    scheduled = undefined;
    abort.abort();
    abort = new AbortController();
    const signal = abort.signal;
    playback.invalidate();
    store.setState({
      channel,
      status: "loading",
      phase: channel === "dev" ? "building" : "preparing",
      recovery: "healthy",
      loaded: null,
      playback: null,
      error: null,
      job: null,
    });
    for (const build of builds)
      if (build.key !== key) void cancelBuild(build).catch(() => undefined);
    // Invalidate waiters immediately so an obsolete Unity exchange cannot hold the next load.
    const invalidation = input.driver.invalidate();
    void invalidation.catch(() => undefined);
    const invalidated = enqueue(async () => {
      await invalidation;
      if (current(serial)) await input.api.invalidateDisplay(signal);
    });
    const start = () => {
      scheduled = undefined;
      let build: Build | undefined;
      const pending = (async () => {
        await Promise.resolve();
        if (!current(serial)) return;
        let buildId: string | undefined;
        if (channel === "dev") {
          build = [...builds].find((item) => item.key === key && !item.cancellation);
          if (!build) {
            // Keep the receipt reachable after a newer request invalidates this load.
            build = { key, accepted: input.api.build(revision, id()) };
            builds.add(build);
          }
          let job: BuildJob;
          try {
            job = await build.accepted;
          } catch (error) {
            builds.delete(build);
            throw error;
          }
          if (!current(serial)) return;
          input.onRevision?.(job.revision);
          store.setState({ job });
          while (running(job)) {
            await wait(input.pollMilliseconds ?? 250, signal);
            job = await input.api.job(job.buildId, signal);
            if (!current(serial)) return;
            store.setState({ job });
          }
          builds.delete(build);
          if (job.status !== "succeeded" || !job.generationId)
            throw new Error(
              `build ${job.status}: ${job.diagnostics.map((item) => item.message).join("; ")}`,
            );
          buildId = job.buildId;
        }
        await invalidated;
        if (!current(serial)) return;
        await enqueue(async () => {
          let candidate: string | undefined;
          try {
            if (!current(serial)) return;
            store.setState({ phase: "preparing" });
            const requestId = id();
            const envelope = await input.api.preview(
              buildId ? { requestId, channel: "dev", buildId } : { requestId, channel: "dist" },
              signal,
            );
            candidate = envelope.requestId;
            if (!candidate) throw new Error("Preview request ID is missing.");
            if (!current(serial)) return;
            if (candidate !== requestId)
              throw new Error("Preview response request does not match.");
            const identity = await input.driver.prepare(envelope, signal);
            const manifest: unknown = JSON.parse(envelope.buildManifest ?? "null");
            if (
              !manifest ||
              typeof manifest !== "object" ||
              !("buildId" in manifest) ||
              manifest.buildId !== identity
            )
              throw new Error("Prepared Preview build identity does not match.");
            if (!current(serial)) return;
            store.setState({ phase: "committing" });
            const committed = await input.driver.commit(candidate, signal);
            if (!current(serial)) return;
            if (committed !== identity)
              throw new Error("Committed Preview build identity does not match.");
            store.setState({ phase: "confirming" });
            await input.api.confirmDisplay(candidate, identity, signal);
            if (!current(serial)) return;
            store.setState({
              loaded: {
                channel,
                requestId: candidate,
                buildIdentity: identity,
                sourceRevision: envelope.sourceRevision ?? null,
              },
            });
            playback.load(candidate);
            candidate = undefined;
          } finally {
            if (candidate) await input.driver.discard(candidate).catch(() => undefined);
          }
        });
      })()
        .catch((error: unknown) => {
          if (current(serial))
            store.setState({ status: "error", phase: "failed", error: message(error) });
        })
        .finally(async () => {
          if (build && ((!current(serial) && desiredKey !== key) || closed))
            await cancelBuild(build).catch(() => undefined);
        });
      void pending.catch(() => undefined);
    };
    if (channel === "dev" && options.debounce) scheduled = setTimeout(start, 200);
    else start();
  }
  function cancel() {
    const serial = ++epoch;
    desiredKey = undefined;
    clearTimeout(scheduled);
    scheduled = undefined;
    abort.abort();
    playback.invalidate();
    const stopped = Promise.all([...builds].map(cancelBuild));
    store.setState({ status: "idle", phase: "idle", loaded: null, playback: null });
    void input.driver.invalidate().catch(() => undefined);
    const invalidated = enqueue(() => input.api.invalidateDisplay());
    const cancelled = Promise.all([stopped, invalidated])
      .then(() => undefined)
      .catch((error) => {
        if (current(serial))
          store.setState({ status: "error", phase: "failed", error: message(error) });
        throw error;
      });
    void cancelled.catch(() => undefined);
    return cancelled;
  }
  return {
    store,
    playback,
    request,
    cancel,
    dispose: async () => {
      if (closed) return;
      const stopped = Promise.all([...builds].map(cancelBuild));
      void cancel().catch(() => undefined);
      closed = true;
      unsubscribe();
      playback.dispose();
      try {
        await input.driver.dispose();
        await stopped;
      } finally {
        cleanup.abort();
      }
    },
  };
}
