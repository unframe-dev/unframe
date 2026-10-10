import type { BuildJob, LocalPreviewEnvelopeWire } from "@unframe/unframe-cli/author-contract";
import type { EditorApi } from "../api";

export type PreviewMode = "dev" | "dist";
export type PreviewDriver = {
  prepare(envelope: LocalPreviewEnvelopeWire): Promise<string>;
  commit(requestId: string): Promise<string>;
  discard(requestId: string): Promise<void>;
  invalidate(): Promise<void>;
};
export type LoadedPreview = {
  mode: PreviewMode;
  requestId: string;
  buildIdentity: string;
  sourceRevision: string | null;
};
const newId = () => crypto.randomUUID().replaceAll("-", "");
const terminal = (job: BuildJob) => !["queued", "running"].includes(job.status);

export function createPreviewSession(input: {
  api: Pick<
    EditorApi,
    "build" | "job" | "cancel" | "preview" | "invalidateDisplay" | "confirmDisplay"
  >;
  driver: PreviewDriver;
  onRevision(revision: string): void;
  onJob(job: BuildJob): void;
  onLoaded(preview: LoadedPreview): void;
  onInvalidated(): void;
  onError(error: unknown): void;
}) {
  let epoch = 0;
  let pending: { serial: number; mode: PreviewMode; revision: string } | undefined;
  let running = false;
  let closed = false;
  let activeBuild: string | undefined;
  let invalidation = Promise.resolve();
  const current = (serial: number) => !closed && serial === epoch;
  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      while (pending && !closed) {
        const request = pending;
        pending = undefined;
        let candidate: string | undefined;
        try {
          await invalidation;
          if (!current(request.serial)) continue;
          let build: BuildJob | undefined;
          if (request.mode === "dev") {
            build = await input.api.build(request.revision, newId());
            activeBuild = build.buildId;
            if (current(request.serial)) {
              input.onRevision(build.revision);
              input.onJob(build);
            } else await input.api.cancel(build.buildId);
            while (!terminal(build) && !closed) {
              await new Promise((resolve) => setTimeout(resolve, 250));
              build = await input.api.job(build.buildId);
              if (current(request.serial)) input.onJob(build);
            }
            activeBuild = undefined;
            if (!current(request.serial)) continue;
            if (build.status !== "succeeded")
              throw new Error(
                `build ${build.status}: ${build.diagnostics.map((item) => item.message).join("; ")}`,
              );
          }
          const envelope = await input.api.preview(
            build
              ? { requestId: newId(), channel: "dev", buildId: build.buildId }
              : { requestId: newId(), channel: "dist" },
          );
          if (!envelope.requestId || !envelope.buildManifest)
            throw new Error("Preview envelope is incomplete.");
          candidate = envelope.requestId;
          if (!current(request.serial)) continue;
          const identity = await input.driver.prepare(envelope);
          const manifest = JSON.parse(envelope.buildManifest) as { buildId?: unknown };
          if (manifest.buildId !== identity)
            throw new Error("Prepared build identity does not match the Preview.");
          if (!current(request.serial)) continue;
          const committed = await input.driver.commit(envelope.requestId);
          if (!current(request.serial)) continue;
          if (committed !== identity)
            throw new Error("Committed build identity does not match the Preview.");
          await input.api.confirmDisplay(envelope.requestId, identity);
          if (!current(request.serial)) continue;
          input.onLoaded({
            mode: request.mode,
            requestId: envelope.requestId,
            buildIdentity: identity,
            sourceRevision: envelope.sourceRevision ?? null,
          });
          candidate = undefined;
        } catch (error) {
          if (current(request.serial)) input.onError(error);
        } finally {
          if (candidate) await input.driver.discard(candidate).catch(() => undefined);
          activeBuild = undefined;
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    request(mode: PreviewMode, revision: string) {
      if (closed) return;
      input.onInvalidated();
      pending = { serial: ++epoch, mode, revision };
      invalidation = invalidation
        .catch(() => undefined)
        .then(async () => {
          await input.api.invalidateDisplay();
          await input.driver.invalidate();
        });
      void invalidation.catch(() => undefined);
      if (activeBuild) void input.api.cancel(activeBuild).catch(input.onError);
      void drain();
    },
    cancel() {
      input.onInvalidated();
      pending = undefined;
      ++epoch;
      if (activeBuild) void input.api.cancel(activeBuild).catch(input.onError);
      invalidation = invalidation
        .catch(() => undefined)
        .then(async () => {
          await input.api.invalidateDisplay();
          await input.driver.invalidate();
        });
      void invalidation.catch(() => undefined);
      return invalidation;
    },
    close() {
      this.cancel();
      closed = true;
    },
  };
}
