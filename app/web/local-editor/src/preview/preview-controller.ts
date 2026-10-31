import type { PreviewPlaybackResponse } from "@unframe/core/cli/author-contract";
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
  let activeBuild: string | undefined;
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
  function request(channel: "dev" | "dist", revision: string) {
    if (closed) return;
    const serial = ++epoch;
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
    if (activeBuild) void input.api.cancel(activeBuild).catch(() => undefined);
    // Invalidate waiters immediately so an obsolete Unity exchange cannot hold the next load.
    const invalidation = input.driver.invalidate();
    void invalidation.catch(() => undefined);
    loadQueue = loadQueue
      .catch(() => undefined)
      .then(async () => {
        let candidate: string | undefined;
        try {
          await invalidation;
          if (!current(serial)) return;
          await input.api.invalidateDisplay(signal);
          if (!current(serial)) return;
          let generationId: string | undefined,
            sourceRevision = revision;
          if (channel === "dev") {
            let job = await input.api.build(revision, id(), signal);
            activeBuild = job.buildId;
            if (!current(serial)) {
              await input.api.cancel(job.buildId);
              return;
            }
            input.onRevision?.(job.revision);
            store.setState({ job });
            while (["queued", "running"].includes(job.status)) {
              await wait(input.pollMilliseconds ?? 250, signal);
              job = await input.api.job(job.buildId, signal);
              if (!current(serial)) return;
              store.setState({ job });
            }
            activeBuild = undefined;
            if (job.status !== "succeeded" || !job.generationId)
              throw new Error(
                `build ${job.status}: ${job.diagnostics.map((item) => item.message).join("; ")}`,
              );
            generationId = job.generationId;
            sourceRevision = job.revision;
          }
          store.setState({ phase: "preparing" });
          const requestId = id();
          const envelope = await input.api.preview(
            generationId
              ? { requestId, channel: "dev", generationId, sourceRevision }
              : { requestId, channel: "dist" },
            signal,
          );
          candidate = envelope.requestId;
          if (!candidate) throw new Error("Preview request ID is missing.");
          if (!current(serial)) return;
          if (candidate !== requestId) throw new Error("Preview response request does not match.");
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
        } catch (error) {
          if (current(serial))
            store.setState({ status: "error", phase: "failed", error: message(error) });
        } finally {
          if (candidate) await input.driver.discard(candidate).catch(() => undefined);
        }
      });
    void loadQueue.catch(() => undefined);
  }
  function cancel() {
    const serial = ++epoch;
    abort.abort();
    playback.invalidate();
    if (activeBuild) void input.api.cancel(activeBuild).catch(() => undefined);
    store.setState({ status: "idle", phase: "idle", loaded: null, playback: null });
    void input.driver.invalidate().catch(() => undefined);
    loadQueue = loadQueue
      .catch(() => undefined)
      .then(() => input.api.invalidateDisplay())
      .catch((error) => {
        if (current(serial))
          store.setState({ status: "error", phase: "failed", error: message(error) });
        throw error;
      });
    void loadQueue.catch(() => undefined);
    return loadQueue;
  }
  return {
    store,
    playback,
    request,
    cancel,
    dispose: async () => {
      if (closed) return;
      void cancel().catch(() => undefined);
      closed = true;
      unsubscribe();
      playback.dispose();
      await input.driver.dispose();
    },
  };
}
