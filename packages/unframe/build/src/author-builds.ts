import { randomBytes } from "node:crypto";
import type {
  AuthorDiagnostic,
  BuildJob,
  ProjectSnapshot,
} from "@unframe-dev/contracts/author-http";
import { AuthorArtifactCache } from "./artifact-cache.js";
const randomId = () => randomBytes(16).toString("hex");
export type AuthorBuildOptions = {
  artifactRetention?: { maxGenerations?: number; maxBytes?: number };
  maxCompletedJobs?: number;
};
export type AuthorBuildRequestOptions = { signal?: AbortSignal; onAccepted?: () => void };
export type AuthorBuildExecutionResult =
  | { status: "succeeded"; generationId: string; diagnostics: AuthorDiagnostic[] }
  | { status: "cancelled" | "stale" | "failed"; diagnostics: AuthorDiagnostic[] };
export type AuthorBuildPorts = {
  fail(status: number, code: string, message: string): never;
  prepareBuild(
    revision: string,
    channel: "dev" | "dist",
    signal: AbortSignal,
  ): Promise<{ revision: string; snapshot: ProjectSnapshot }>;
  validateRevision(revision: string, signal: AbortSignal): Promise<void>;
  canReuseBuild(
    input: { revision: string; channel: "dev" | "dist"; generationId: string; identity: string },
    signal: AbortSignal,
  ): Promise<boolean>;
  run(input: {
    revision: string;
    channel: "dev" | "dist";
    signal: AbortSignal;
  }): Promise<AuthorBuildExecutionResult>;
  readPublishedArtifacts(
    generation: string,
    instances: readonly string[],
    channel: "dev" | "dist",
    maxBytes?: number,
  ): Promise<{
    identity: string;
    catalog: BuildJob["artifacts"];
    assets: Map<string, { bytes: Uint8Array; mediaType: string }>;
  }>;
};
const diagnostic = (code: string, message: string): AuthorDiagnostic => ({ code, message });
export const createAuthorBuildService = (
  ports: AuthorBuildPorts,
  options: AuthorBuildOptions = {},
) => {
  const maxCompletedJobs = options.maxCompletedJobs ?? 64;
  if (!Number.isSafeInteger(maxCompletedJobs) || maxCompletedJobs < 1)
    throw new TypeError("Invalid completed job limit");
  const run = ports.run;
  const readPublished = ports.readPublishedArtifacts;
  type Channel = "dev" | "dist";
  type Work = {
    revision: string;
    channel: Channel;
    controller: AbortController;
    ready: Promise<BuildJob>;
    done: Promise<void>;
    job?: BuildJob;
    callers: number;
    delivered: boolean;
  };
  type Success = {
    revision: string;
    generationId: string;
    identity: string;
    instances: string[];
    diagnostics: AuthorDiagnostic[];
  };
  const jobs = new Map<string, BuildJob>();
  const requests = new Map<string, { revision: string; channel: Channel; work: Work }>();
  const completed: string[] = [];
  const successes = new Map<Channel, Success>();
  const artifacts = new AuthorArtifactCache(
    options.artifactRetention?.maxGenerations,
    options.artifactRetention?.maxBytes,
  );
  let closed = false;
  let arrival = 0;
  let accepted = 0;
  let running: Work | undefined;
  let latest: Work | undefined;
  const pending = new Set<Work>();
  const allWorks = new Set<Work>();
  const requireOpen = () => {
    if (closed) ports.fail(409, "author-service-closed", "Author host is closed.");
  };
  const requireCurrent = (work: Work) => {
    requireOpen();
    if (work.controller.signal.aborted || latest !== work)
      ports.fail(409, "cli-cancelled", "A newer build superseded this request.");
  };
  const retainCompleted = (job: BuildJob) => {
    completed.push(job.buildId);
    while (completed.length > maxCompletedJobs) {
      const stale = completed.shift()!;
      jobs.delete(stale);
      for (const [id, request] of requests) {
        if (request.work.job?.buildId === stale) requests.delete(id);
      }
    }
    const finished = [...requests].filter(([, request]) => !allWorks.has(request.work));
    for (const [id] of finished.slice(0, Math.max(0, finished.length - maxCompletedJobs)))
      requests.delete(id);
  };
  const getJob = (id: string) => {
    const value = jobs.get(id);
    if (!value) ports.fail(404, "author-build-not-found", "Build job was not found.");
    return value;
  };
  const register = (work: Work, revision: string) => {
    requireCurrent(work);
    const job: BuildJob = {
      buildId: randomId(),
      channel: work.channel,
      revision,
      generationId: null,
      status: "queued",
      diagnostics: [],
      artifacts: [],
    };
    jobs.set(job.buildId, job);
    work.job = job;
    return job;
  };
  const observe = (work: Work, signal?: AbortSignal): Promise<BuildJob> => {
    ++work.callers;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        --work.callers;
        if (error) reject(error);
        else {
          work.delivered = true;
          resolve(structuredClone(work.job!));
        }
      };
      const abort = () => {
        if (!settled && work.callers === 1 && !work.delivered) work.controller.abort();
        try {
          ports.fail(409, "cli-cancelled", "Build request was disconnected.");
        } catch (error) {
          finish(error);
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      void work.ready.then(
        () => finish(),
        (error: unknown) => finish(error),
      );
      if (signal?.aborted) abort();
    });
  };
  return {
    invalidate() {
      for (const work of allWorks) work.controller.abort();
    },
    build: async (
      revision: string,
      requestId: string,
      channel: Channel = "dev",
      requestOptions: AuthorBuildRequestOptions = {},
    ) => {
      requireOpen();
      if (channel !== "dev" && channel !== "dist")
        ports.fail(400, "author-output-channel-invalid", "Invalid build channel.");
      const existing = requests.get(requestId);
      if (existing) {
        if (existing.revision !== revision || existing.channel !== channel)
          ports.fail(
            409,
            "author-request-id-conflict",
            "Build request ID was used for another revision.",
          );
        return observe(existing.work, requestOptions.signal);
      }
      const sequence = ++arrival;
      const response = Promise.withResolvers<BuildJob>();
      const work: Work = {
        revision,
        channel,
        controller: new AbortController(),
        ready: response.promise,
        done: Promise.resolve(),
        callers: 0,
        delivered: false,
      };
      requests.set(requestId, { revision, channel, work });
      allWorks.add(work);
      let joined = false;
      work.done = (async () => {
        try {
          await ports.validateRevision(revision, work.controller.signal);
          requireOpen();
          if (work.controller.signal.aborted)
            ports.fail(409, "cli-cancelled", "A newer build superseded this request.");
          const shared = [...pending].find(
            (item) =>
              item.revision === revision &&
              item.channel === channel &&
              !item.controller.signal.aborted,
          );
          if (shared) {
            joined = true;
            requests.set(requestId, { revision, channel, work: shared });
            const job = await observe(shared, work.controller.signal);
            work.job = job;
            response.resolve(job);
            return;
          }
          if (sequence < accepted)
            ports.fail(409, "cli-cancelled", "A newer build superseded this request.");
          if ([...pending].some((item) => item.channel !== "dev" || channel !== "dev"))
            ports.fail(409, "author-build-busy", "Another build is running.");
          const previous = running?.done ?? Promise.resolve();
          accepted = sequence;
          for (const item of pending) item.controller.abort();
          pending.add(work);
          latest = work;
          requestOptions.onAccepted?.();
          const signal = work.controller.signal;
          await new Promise<void>((resolve) => {
            const finish = () => {
              signal.removeEventListener("abort", finish);
              resolve();
            };
            signal.addEventListener("abort", finish, { once: true });
            void previous.then(finish, finish);
            if (signal.aborted) finish();
          });
          requireCurrent(work);
          running = work;
          const candidate = successes.get(channel);
          if (channel === "dev" && candidate?.revision === revision) {
            try {
              const published = await readPublished(
                candidate.generationId,
                candidate.instances,
                channel,
                options.artifactRetention?.maxBytes,
              );
              requireCurrent(work);
              if (
                published.identity === candidate.identity &&
                (await ports.canReuseBuild({ ...candidate, channel }, signal))
              ) {
                requireCurrent(work);
                artifacts.put(channel, candidate.generationId, published.assets);
                const job = register(work, revision);
                Object.assign(job, {
                  generationId: candidate.generationId,
                  status: "succeeded",
                  diagnostics: candidate.diagnostics,
                  artifacts: published.catalog,
                });
                response.resolve(job);
                return;
              }
            } catch {
              requireCurrent(work);
            }
            requireCurrent(work);
            successes.delete(channel);
          }
          const current = structuredClone(await ports.prepareBuild(revision, channel, signal));
          requireCurrent(work);
          const job = register(work, current.revision);
          response.resolve(job);
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (signal.aborted) {
            job.status = "cancelled";
            return;
          }
          job.status = "running";
          let committed = false;
          try {
            const result = await run({ revision: current.revision, channel, signal });
            if (result.status !== "succeeded") {
              job.status = result.status;
              job.diagnostics = result.diagnostics;
              return;
            }
            if (!result.generationId || !/^[0-9a-f]{32}$/.test(result.generationId))
              ports.fail(500, "author-output-unsafe", "Build output is not a managed generation.");
            committed = true;
            job.generationId = result.generationId;
            const instances = current.snapshot.instances.map(({ instanceId }) => instanceId);
            const published = await readPublished(
              result.generationId,
              instances,
              channel,
              options.artifactRetention?.maxBytes,
            );
            artifacts.put(channel, result.generationId, published.assets);
            job.artifacts = published.catalog;
            job.diagnostics = result.diagnostics;
            job.status = "succeeded";
            if (channel === "dev" && !signal.aborted && !closed && latest === work)
              successes.set(channel, {
                revision: current.revision,
                generationId: result.generationId,
                identity: published.identity,
                instances,
                diagnostics: structuredClone(result.diagnostics),
              });
          } catch (error) {
            job.status = committed || !signal.aborted ? "failed" : "cancelled";
            if (committed || !signal.aborted)
              job.diagnostics = [
                diagnostic(
                  "author-build-failed",
                  error instanceof Error ? error.message : "Build failed.",
                ),
              ];
          }
        } catch (error) {
          let failure = error;
          try {
            requireOpen();
            if (work.controller.signal.aborted)
              ports.fail(409, "cli-cancelled", "Build was cancelled.");
          } catch (cancelled) {
            failure = cancelled;
          }
          response.reject(failure);
        } finally {
          pending.delete(work);
          allWorks.delete(work);
          if (running === work) running = undefined;
          if (work.job && !joined) retainCompleted(work.job);
          else
            for (const [id, request] of requests) {
              if (request.work === work) requests.delete(id);
            }
        }
      })();
      return observe(work, requestOptions.signal);
    },
    job: async (id: string) => structuredClone(getJob(id)),
    cancel: async (id: string) => {
      const job = getJob(id);
      for (const work of pending) if (work.job === job) work.controller.abort();
      return structuredClone(job);
    },
    artifact: async (id: string, assetId: string) => {
      const job = getJob(id);
      if (job.status !== "succeeded")
        ports.fail(404, "author-asset-not-found", "Build asset was not found.");
      const value = job.generationId
        ? artifacts.get(job.channel, job.generationId, assetId)
        : undefined;
      if (!value) ports.fail(404, "author-asset-not-found", "Build asset was not found.");
      return { bytes: value.bytes.slice(), mediaType: value.mediaType };
    },
    close: async () => {
      closed = true;
      for (const work of allWorks) work.controller.abort();
      await Promise.allSettled([...allWorks].map((work) => work.done));
      successes.clear();
      artifacts.clear();
    },
  };
};
