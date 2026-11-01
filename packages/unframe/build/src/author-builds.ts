import { randomBytes } from "node:crypto";
import type { AuthorDiagnostic, BuildJob, ProjectSnapshot } from "@unframe/contracts/author-http";
import { AuthorArtifactCache } from "./artifact-cache.js";
const randomId = () => randomBytes(16).toString("hex");
export type AuthorBuildOptions = {
  artifactRetention?: { maxGenerations?: number; maxBytes?: number };
  maxCompletedJobs?: number;
};
export type AuthorBuildExecutionResult =
  | { status: "succeeded"; generationId: string; diagnostics: AuthorDiagnostic[] }
  | { status: "cancelled" | "stale" | "failed"; diagnostics: AuthorDiagnostic[] };
export type AuthorBuildPorts = {
  fail(status: number, code: string, message: string): never;
  withSource<T>(
    callback: () => Promise<T>,
    allowRecovery: boolean,
    waitTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T>;
  prepareBuild(
    revision: string,
    channel: "dev" | "dist",
  ): Promise<{ revision: string; snapshot: ProjectSnapshot }>;
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
  const jobs = new Map<string, BuildJob>();
  const active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> | undefined }
  >();
  const requests = new Map<
    string,
    { revision: string; buildId: string; channel: "dev" | "dist" }
  >();
  const completed: { buildId: string; requestId: string }[] = [];
  const retainCompleted = (buildId: string, requestId: string) => {
    completed.push({ buildId, requestId });
    while (completed.length > maxCompletedJobs) {
      const stale = completed.shift()!;
      jobs.delete(stale.buildId);
      requests.delete(stale.requestId);
    }
  };
  const artifacts = new AuthorArtifactCache(
    options.artifactRetention?.maxGenerations,
    options.artifactRetention?.maxBytes,
  );
  let closed = false;
  const withSource = async <T>(
    callback: () => Promise<T>,
    allowRecovery = false,
    waitTimeoutMs = 0,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (closed) ports.fail(409, "author-service-closed", "Author host is closed.");
    return ports.withSource(
      async () => {
        if (closed) ports.fail(409, "author-service-closed", "Author host is closed.");
        return callback();
      },
      allowRecovery,
      waitTimeoutMs,
      signal,
    );
  };
  const getJob = (id: string) => {
    const value = jobs.get(id);
    if (!value) ports.fail(404, "author-build-not-found", "Build job was not found.");
    return value;
  };
  return {
    invalidate() {
      for (const item of active.values()) item.controller.abort();
    },
    build: async (revision: string, requestId: string, channel: "dev" | "dist" = "dev") => {
      if (channel !== "dev" && channel !== "dist")
        ports.fail(400, "author-output-channel-invalid", "Invalid build channel.");
      let start: (() => void) | undefined;
      const response = await withSource(
        async () => {
          const existing = requests.get(requestId);
          if (existing) {
            if (existing.revision !== revision || existing.channel !== channel)
              ports.fail(
                409,
                "author-request-id-conflict",
                "Build request ID was used for another revision.",
              );
            return getJob(existing.buildId);
          }
          if (active.size > 0) ports.fail(409, "author-build-busy", "Another build is running.");
          const current = structuredClone(await ports.prepareBuild(revision, channel));
          if (closed) ports.fail(409, "author-service-closed", "Author host is closed.");
          const buildRevision = current.revision;
          const buildId = randomId();
          const controller = new AbortController();
          const job: BuildJob = {
            buildId,
            channel,
            revision: buildRevision,
            generationId: null,
            status: "queued",
            diagnostics: [],
            artifacts: [],
          };
          const record = {
            controller,
            promise: undefined as Promise<void> | undefined,
          };
          jobs.set(buildId, job);
          active.set(buildId, record);
          requests.set(requestId, { revision, buildId, channel });
          start = () => {
            record.promise = (async () => {
              await new Promise<void>((resolve) => setImmediate(resolve));
              if (controller.signal.aborted) {
                job.status = "cancelled";
                return;
              }
              job.status = "running";
              let committed = false;
              try {
                const result = await run({
                  revision: buildRevision,
                  channel,
                  signal: controller.signal,
                });
                if (result.status !== "succeeded") {
                  job.status = result.status;
                  job.diagnostics = result.diagnostics;
                  return;
                }
                if (!result.generationId || !/^[0-9a-f]{32}$/.test(result.generationId))
                  ports.fail(
                    500,
                    "author-output-unsafe",
                    "Build output is not a managed generation.",
                  );
                committed = true;
                job.generationId = result.generationId;
                const published = await readPublished(
                  result.generationId,
                  current.snapshot.instances.map(({ instanceId }) => instanceId),
                  channel,
                  options.artifactRetention?.maxBytes,
                );
                artifacts.put(channel, result.generationId, published.assets);
                job.artifacts = published.catalog;
                job.diagnostics = result.diagnostics;
                job.generationId = result.generationId;
                job.status = "succeeded";
              } catch (error) {
                job.status = committed
                  ? "succeeded"
                  : controller.signal.aborted
                    ? "cancelled"
                    : "failed";
                if (committed || !controller.signal.aborted)
                  job.diagnostics = [
                    diagnostic(
                      "author-build-failed",
                      error instanceof Error ? error.message : "Build failed.",
                    ),
                  ];
              }
            })().finally(() => {
              active.delete(buildId);
              retainCompleted(buildId, requestId);
            });
          };
          return job;
        },
        false,
        5000,
      );
      start?.();
      return structuredClone(response);
    },
    job: async (id: string) => structuredClone(getJob(id)),
    cancel: async (id: string) => {
      const job = getJob(id);
      active.get(id)?.controller.abort();
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
      for (const item of active.values()) item.controller.abort();
      await Promise.all([...active.values()].map((item) => item.promise));
      artifacts.clear();
    },
  };
};
