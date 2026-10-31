import type { BuildJob } from "@unframe/core/cli/author-contract";
import type { HostApi } from "../infra/host-api";
import { createPublicationStore, type DisplayReceipt } from "./publication-store";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function createPublicationController(input: {
  api: HostApi;
  onDistBuilt(job: BuildJob): void;
  pollMilliseconds?: number;
}) {
  const store = createPublicationStore();
  let closed = false,
    epoch = 0,
    reading = false,
    started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let buildTimer: ReturnType<typeof setTimeout> | undefined;
  const lifetime = new AbortController();
  let action = new AbortController();
  let buildAbort = new AbortController();
  let buildEpoch = 0;
  async function readAuth() {
    if (closed || reading) return;
    reading = true;
    const serial = epoch;
    try {
      const auth = await input.api.publicationAuth(lifetime.signal);
      if (!closed && serial === epoch) store.setState({ auth });
    } catch (error) {
      if (!closed && serial === epoch) store.setState({ error: message(error) });
    } finally {
      reading = false;
      if (!closed) timer = setTimeout(() => void readAuth(), input.pollMilliseconds ?? 1000);
    }
  }
  async function authAction(cancel: boolean) {
    if (closed || store.getState().pending) return;
    const serial = ++epoch;
    action.abort();
    action = new AbortController();
    store.setState({ pending: true, error: null });
    try {
      const auth = cancel
        ? (await input.api.cancelPublicationAuth(action.signal),
          await input.api.publicationAuth(action.signal))
        : await input.api.beginPublicationAuth(action.signal);
      if (!closed && serial === epoch) store.setState({ auth });
    } catch (error) {
      if (!closed && serial === epoch) store.setState({ error: message(error) });
    } finally {
      if (!closed && serial === epoch) store.setState({ pending: false });
    }
  }
  async function observeBuild(job: BuildJob, serial: number) {
    if (closed || serial !== buildEpoch) return;
    store.setState({ job });
    if (["queued", "running"].includes(job.status)) {
      buildTimer = setTimeout(() => {
        void input.api
          .job(job.buildId, buildAbort.signal)
          .then((next) => observeBuild(next, serial))
          .catch((error) => {
            if (!closed && serial === buildEpoch) store.setState({ error: message(error) });
          });
      }, 250);
    } else if (job.status === "succeeded") input.onDistBuilt(job);
    else
      store.setState({
        error: `build ${job.status}: ${job.diagnostics.map((item) => item.message).join("; ")}`,
      });
  }
  return {
    store,
    start() {
      if (started || closed) return Promise.resolve();
      started = true;
      return readAuth();
    },
    setReceipt(receipt: DisplayReceipt | null) {
      if (!closed) store.setState({ receipt });
    },
    authenticate: () => authAction(false),
    cancelAuth: () => authAction(true),
    async build(revision: string) {
      if (closed) return;
      const old = store.getState().job;
      if (old && ["queued", "running"].includes(old.status))
        void input.api.cancel(old.buildId).catch(() => undefined);
      const serial = ++buildEpoch;
      buildAbort.abort();
      buildAbort = new AbortController();
      clearTimeout(buildTimer);
      store.setState({ error: null });
      try {
        const job = await input.api.distBuild(
          revision,
          crypto.randomUUID().replaceAll("-", ""),
          buildAbort.signal,
        );
        if (closed || serial !== buildEpoch) {
          await input.api.cancel(job.buildId);
          return;
        }
        await observeBuild(job, serial);
      } catch (error) {
        if (!closed && serial === buildEpoch) store.setState({ error: message(error) });
      }
    },
    async cancelBuild() {
      const job = store.getState().job;
      if (!job || closed) return;
      const serial = ++buildEpoch;
      buildAbort.abort();
      buildAbort = new AbortController();
      clearTimeout(buildTimer);
      try {
        const cancelled = await input.api.cancel(job.buildId, buildAbort.signal);
        if (!closed && serial === buildEpoch) store.setState({ job: cancelled });
      } catch (error) {
        if (!closed && serial === buildEpoch) store.setState({ error: message(error) });
      }
    },
    async publish() {
      const { receipt, auth, pending, result } = store.getState();
      if (
        closed ||
        !receipt ||
        auth?.status !== "authenticated" ||
        pending ||
        result?.requestId === receipt.requestId
      )
        return;
      const serial = ++epoch;
      store.setState({ pending: true, error: null });
      try {
        const published = await input.api.publish(receipt.requestId, action.signal);
        if (published.buildId !== receipt.buildIdentity)
          throw new Error("Publication build identity does not match the displayed Dist.");
        if (!closed && serial === epoch)
          store.setState({ result: { ...published, requestId: receipt.requestId } });
      } catch (error) {
        if (!closed && serial === epoch) store.setState({ error: message(error) });
      } finally {
        if (!closed && serial === epoch) store.setState({ pending: false });
      }
    },
    dispose() {
      if (closed) return;
      closed = true;
      ++epoch;
      ++buildEpoch;
      lifetime.abort();
      action.abort();
      buildAbort.abort();
      clearTimeout(timer);
      clearTimeout(buildTimer);
      const job = store.getState().job;
      if (job && ["queued", "running"].includes(job.status))
        void input.api.cancel(job.buildId).catch(() => undefined);
    },
  };
}
