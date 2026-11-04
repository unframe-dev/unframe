import { previewPositionSchema, previewRotationSchema } from "@unframe-dev/contracts/author-http";
import type {
  BuildJob,
  PreviewPlaybackResponse,
  PreviewSpatialState,
} from "@unframe-dev/contracts/author-http";
import { HostApiError, type HostApi } from "../infra/host-api";
import type { PreviewDriver, PreviewView } from "./preview-driver";
import { createPreviewStore, type LoadedPreview, type PreviewStore } from "./preview-store";
import { createPlaybackController } from "./playback-controller";
import { acceptsNotification, requiresRecovery } from "./preview-state";
import { UnityExchangeError } from "../infra/unity-exchange";
const temporaryLocks = new Set(["cli-source-lock-unavailable", "cli-build-lock-unavailable"]);
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
  let recoveryAbort = new AbortController();
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
    onState: (state) => {
      const view = state.spatial ? store.getState().view : "perspective";
      if (view !== store.getState().view) applyView(view);
      const snapshot = store.getState();
      const updating =
        snapshot.phase === "building" ||
        snapshot.phase === "pending" ||
        snapshot.phase === "failed";
      store.setState({
        view,
        playback: state,
        status: "ready",
        phase: updating ? snapshot.phase : "ready",
        recovery: "healthy",
        error: updating ? snapshot.error : null,
      });
    },
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
      signal = AbortSignal.any([abort.signal, recoveryAbort.signal]);
    if (closed || !loaded || store.getState().status === "recovering") return;
    const active = () =>
      current(serial) && !signal.aborted && store.getState().loaded?.requestId === loaded.requestId;
    playback.invalidate();
    store.setState({ status: "recovering", recovery: "restoring", error: message(error) });
    try {
      if (!response?.state.sequence) throw new Error("復元できる表示記録がありません。");
      const restored = await input.api.playback(
        { requestId: loaded.requestId, command: "recover", sequence: response.state.sequence },
        signal,
      );
      if (!active()) return;
      await input.driver.restore(restored.state, signal, restored.spatial);
      if (!active()) return;
      const confirmed = await input.api.playback(
        { requestId: loaded.requestId, command: "applied", sequence: restored.state.sequence! },
        signal,
      );
      if (!active()) return;
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
      if (!active()) return;
      try {
        await input.api.playback(
          { requestId: loaded.requestId, command: "invalidateDisplay" },
          signal,
        );
      } catch {
        /* The Host may already have invalidated the request. */
      }
      if (active())
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
    if (
      notification.message === "video-user-activation-required" &&
      notification.phase !== "spatial"
    ) {
      playback.command({ command: "pause" });
      store.setState({ error: notification.message });
    } else if (requiresRecovery(notification))
      void recover(
        new UnityExchangeError(notification.message ?? "Unity Preview failed.", notification),
        snapshot.playback,
      );
    else store.setState({ error: notification.message ?? "Unity Preview input was rejected." });
  });
  function movePresenter(
    position: PreviewSpatialState["presenterPosition"],
    rotation?: [number, number, number, number],
  ) {
    const snapshot = store.getState();
    if (
      closed ||
      snapshot.status !== "ready" ||
      snapshot.playback?.mode !== "normal" ||
      !snapshot.playback.spatial
    )
      return;
    const parsed = previewPositionSchema.safeParse(position);
    if (!parsed.success || (rotation && !previewRotationSchema.safeParse(rotation).success)) return;
    playback.command({
      command: "movePresenter",
      position: parsed.data,
      ...(rotation ? { rotation } : {}),
    });
  }
  const unsubscribePresenter = input.driver.subscribePresenter((movement) => {
    const snapshot = store.getState();
    if (snapshot.view !== "overhead" || snapshot.loaded?.requestId !== movement.requestId) return;
    movePresenter(movement.position);
  });
  const unsubscribeInteraction = input.driver.subscribeInteraction((interaction) => {
    const snapshot = store.getState();
    if (
      closed ||
      snapshot.status !== "ready" ||
      snapshot.loaded?.requestId !== interaction.requestId ||
      snapshot.playback?.mode !== "normal"
    )
      return;
    playback.command({
      command: "surfaceInteraction",
      surfaceId: interaction.surfaceId,
      interactionId: interaction.interactionId,
    });
  });
  function applyView(view: PreviewView) {
    const serial = epoch;
    store.setState({ view });
    void input.driver.view(view).catch((error: unknown) => {
      if (current(serial) && store.getState().view === view)
        store.setState({ error: message(error) });
    });
  }
  function setView(view: PreviewView) {
    const snapshot = store.getState();
    if (
      closed ||
      snapshot.status !== "ready" ||
      snapshot.playback?.mode !== "normal" ||
      !snapshot.playback.spatial
    )
      return;
    applyView(view);
  }
  function resetCamera() {
    const snapshot = store.getState();
    if (
      closed ||
      snapshot.status !== "ready" ||
      snapshot.playback?.mode !== "normal" ||
      !snapshot.playback.spatial
    )
      return;
    const serial = epoch;
    store.setState({ view: "perspective" });
    void input.driver.resetCamera().catch((error: unknown) => {
      if (current(serial) && store.getState().view === "perspective")
        store.setState({ error: message(error) });
    });
  }
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
    const retained =
      channel === "dev" && store.getState().status === "ready" && store.getState().loaded !== null;
    if (!retained) playback.invalidate();
    store.setState({
      channel,
      status: retained ? "ready" : "loading",
      phase: channel === "dev" ? (options.debounce ? "pending" : "building") : "preparing",
      recovery: "healthy",
      ...(!retained ? { loaded: null, playback: null } : {}),
      error: null,
      job: null,
    });
    for (const build of builds)
      if (build.key !== key) void cancelBuild(build).catch(() => undefined);
    const invalidate = () => {
      recoveryAbort.abort();
      recoveryAbort = new AbortController();
      playback.invalidate();
      store.setState({ status: "loading", loaded: null, playback: null });
      // Invalidate waiters immediately so an obsolete Unity exchange cannot hold the next load.
      const invalidation = input.driver.invalidate();
      void invalidation.catch(() => undefined);
      return enqueue(async () => {
        await invalidation;
        if (current(serial)) await input.api.invalidateDisplay(signal);
      });
    };
    const invalidated = retained ? undefined : invalidate();
    const start = () => {
      scheduled = undefined;
      let build: Build | undefined;
      const pending = (async () => {
        await Promise.resolve();
        if (!current(serial)) return;
        let buildId: string | undefined;
        if (channel === "dev") {
          let buildRevision = revision;
          while (current(serial)) {
            try {
              store.setState({ phase: "building" });
              build = [...builds].find((item) => item.key === key && !item.cancellation);
              if (!build) {
                // Keep the receipt reachable after a newer request invalidates this load.
                build = { key, accepted: input.api.build(buildRevision, id()) };
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
              buildRevision = job.revision;
              input.onRevision?.(job.revision);
              store.setState({ job });
              while (running(job)) {
                await wait(input.pollMilliseconds ?? 250, signal);
                job = await input.api.job(job.buildId, signal);
                if (!current(serial)) return;
                store.setState({ job });
              }
              builds.delete(build);
              if (
                job.status === "failed" &&
                job.diagnostics.length > 0 &&
                job.diagnostics.every((item) => temporaryLocks.has(item.code))
              )
                throw new HostApiError(409, job.diagnostics[0]!.code, "Project source is busy.");
              if (job.status !== "succeeded" || !job.generationId)
                throw new Error(
                  `build ${job.status}: ${job.diagnostics.map((item) => item.message).join("; ")}`,
                );
              buildId = job.buildId;
              break;
            } catch (error) {
              if (!(error instanceof HostApiError) || !temporaryLocks.has(error.code)) throw error;
              if (build) builds.delete(build);
              build = undefined;
              await wait(1000, signal);
            }
          }
          if (!current(serial)) return;
        }
        await (invalidated ?? invalidate());
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
            await input.driver.view(store.getState().view);
            if (!current(serial)) return;
            const displayed: LoadedPreview = {
              channel,
              requestId: candidate,
              buildIdentity: identity,
              sourceRevision: envelope.sourceRevision ?? null,
            };
            store.setState({ phase: "confirming", displayed });
            await input.api.confirmDisplay(candidate, identity, signal);
            if (!current(serial)) return;
            store.setState({ loaded: displayed });
            playback.load(candidate);
            candidate = undefined;
          } finally {
            if (candidate) await input.driver.discard(candidate).catch(() => undefined);
          }
        });
      })()
        .catch((error: unknown) => {
          if (current(serial))
            store.setState({
              status: store.getState().loaded ? "ready" : "error",
              phase: "failed",
              error: message(error),
            });
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
    setView,
    resetCamera,
    movePresenter,
    dispose: async () => {
      if (closed) return;
      const stopped = Promise.all([...builds].map(cancelBuild));
      void cancel().catch(() => undefined);
      closed = true;
      unsubscribe();
      unsubscribePresenter();
      unsubscribeInteraction();
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
