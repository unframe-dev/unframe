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
  checkBuildAvailability(): Promise<void>;
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
    ready: Promise<void>;
    done: Promise<void>;
    job?: Omit<BuildJob, "buildId">;
    requests: Set<BuildRequest>;
  };
  type BuildRequest = {
    requestId: string;
    buildId: string;
    work: Work;
    controller: AbortController;
    ready: Promise<void>;
    callers: number;
    delivered: boolean;
    cancelled: boolean;
    cancelledJob?: BuildJob;
    retained: boolean;
  };
  type Success = {
    revision: string;
    generationId: string;
    identity: string;
    instances: string[];
    diagnostics: AuthorDiagnostic[];
  };
  const jobs = new Map<string, BuildRequest>();
  const requests = new Map<string, BuildRequest>();
  const completed: string[] = [];
  const validations = new Set<Promise<void>>();
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
  const forget = (request: BuildRequest) => {
    request.controller.abort();
    jobs.delete(request.buildId);
    if (requests.get(request.requestId) === request) requests.delete(request.requestId);
    request.work.requests.delete(request);
  };
  const retainCompleted = (request: BuildRequest) => {
    if (request.retained) return;
    request.retained = true;
    completed.push(request.buildId);
    while (completed.length > maxCompletedJobs) {
      const stale = jobs.get(completed.shift()!);
      if (stale) forget(stale);
    }
  };
  const getRequest = (id: string) => {
    const request = jobs.get(id);
    if (!request) ports.fail(404, "author-build-not-found", "Build job was not found.");
    return request;
  };
  const requestJob = (request: BuildRequest): BuildJob =>
    structuredClone(request.cancelledJob ?? { ...request.work.job!, buildId: request.buildId });
  const getJob = (id: string) => requestJob(getRequest(id));
  const register = (work: Work, revision: string) => {
    requireCurrent(work);
    const job: Omit<BuildJob, "buildId"> = {
      channel: work.channel,
      revision,
      generationId: null,
      status: "queued",
      diagnostics: [],
      artifacts: [],
    };
    work.job = job;
    return job;
  };
  const attach = (work: Work, requestId: string, validateRevision = false): BuildRequest => {
    const request: BuildRequest = {
      requestId,
      buildId: randomId(),
      work,
      controller: new AbortController(),
      ready: work.ready,
      callers: 0,
      delivered: false,
      cancelled: false,
      retained: false,
    };
    requests.set(requestId, request);
    work.requests.add(request);
    if (validateRevision) {
      const signal = AbortSignal.any([request.controller.signal, work.controller.signal]);
      const validation = (async () => {
        try {
          await ports.validateRevision(work.revision, signal);
        } catch (error) {
          requireOpen();
          if (!signal.aborted) throw error;
        }
        requireOpen();
        if (signal.aborted) ports.fail(409, "cli-cancelled", "Build request was cancelled.");
      })();
      validations.add(validation);
      void validation.then(
        () => validations.delete(validation),
        () => validations.delete(validation),
      );
      request.ready = Promise.all([work.ready, validation]).then(() => {});
    }
    return request;
  };
  const abortIfUnobserved = (work: Work) => {
    const unobserved = ![...work.requests].some(
      (request) => !request.cancelled && (request.delivered || request.callers > 0),
    );
    if (unobserved) work.controller.abort();
    return unobserved;
  };
  const observe = (request: BuildRequest, signal?: AbortSignal): Promise<BuildJob> => {
    const { work } = request;
    ++request.callers;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        --request.callers;
        if (error) {
          abortIfUnobserved(work);
          if (!request.delivered && request.callers === 0) forget(request);
          reject(error);
        } else {
          if (!request.delivered) {
            request.delivered = true;
            jobs.set(request.buildId, request);
            if (!allWorks.has(work)) retainCompleted(request);
          }
          resolve(requestJob(request));
        }
      };
      const abort = () => {
        try {
          ports.fail(409, "cli-cancelled", "Build request was disconnected.");
        } catch (error) {
          finish(error);
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      void request.ready.then(
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
        if (existing.work.revision !== revision || existing.work.channel !== channel)
          ports.fail(
            409,
            "author-request-id-conflict",
            "Build request ID was used for another revision.",
          );
        return observe(existing, requestOptions.signal);
      }
      const shared = [...allWorks].find(
        (work) =>
          work.revision === revision && work.channel === channel && !work.controller.signal.aborted,
      );
      if (shared) {
        return observe(attach(shared, requestId, pending.has(shared)), requestOptions.signal);
      }
      const sequence = ++arrival;
      const response = Promise.withResolvers<void>();
      const work: Work = {
        revision,
        channel,
        controller: new AbortController(),
        ready: response.promise,
        done: Promise.resolve(),
        requests: new Set(),
      };
      const request = attach(work, requestId);
      allWorks.add(work);
      work.done = (async () => {
        try {
          // An active build in this host can be superseded and will release its lease before this work starts.
          if (!running) await ports.checkBuildAvailability();
          await ports.validateRevision(revision, work.controller.signal);
          requireOpen();
          if (work.controller.signal.aborted || sequence < accepted)
            ports.fail(409, "cli-cancelled", "A newer build superseded this request.");
          if (
            [...pending].some(
              (item) =>
                !item.controller.signal.aborted && (item.channel !== "dev" || channel !== "dev"),
            )
          )
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
          await ports.checkBuildAvailability();
          requireCurrent(work);
          const candidate = successes.get(channel);
          if (candidate?.revision === revision) {
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
                response.resolve();
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
          response.resolve();
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
            if (!signal.aborted && !closed && latest === work)
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
          for (const request of work.requests) {
            if (request.delivered) retainCompleted(request);
            else if (request.callers === 0) forget(request);
          }
        }
      })();
      return observe(request, requestOptions.signal);
    },
    job: async (id: string) => getJob(id),
    cancel: async (id: string) => {
      const request = getRequest(id);
      const job = request.work.job!;
      if (
        !request.cancelled &&
        (job.status === "queued" || job.status === "running") &&
        !job.generationId
      ) {
        request.cancelled = true;
        if (!abortIfUnobserved(request.work)) {
          request.cancelledJob = { ...requestJob(request), status: "cancelled" };
          retainCompleted(request);
        }
      }
      return requestJob(request);
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
      for (const request of requests.values()) request.controller.abort();
      await Promise.allSettled([...allWorks].map((work) => work.done).concat([...validations]));
      successes.clear();
      artifacts.clear();
    },
  };
};
