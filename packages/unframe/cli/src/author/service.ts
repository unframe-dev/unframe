import { hashCanonicalJsonPayload } from "@unframe-dev/artifacts";
import type { AnalysisOperations } from "./analysis-protocol.js";
import { runAnalysisOperation } from "./analysis-client.js";
import { sourceAssetPorts } from "../application/media-ports.js";
import { readBuildExecutionResult } from "./build-result.js";
import {
  createAuthorService as createService,
  saveAuthorPatch,
  readAuthorArtifacts,
  AuthorError,
  type AuthorService,
} from "@unframe-dev/author-service";
import { runPresentationCli } from "../application/run-presentation-cli.js";
import type {
  PresentationCliBuildTiming,
  PresentationCliExitCode,
  RunPresentationCliInput,
} from "../application/types.js";
import { createOpaqueCaptureCache } from "@unframe-dev/render-browser";
import { discoverPresentationProjectFiles } from "@unframe-dev/workspace-node";
import { readPresentationProjectRevision } from "@unframe-dev/workspace-node";
import { readTypeLibraries } from "@unframe-dev/workspace-node";
import { readBuildGeneration } from "@unframe-dev/workspace-node";
import { acquireSourceLock, checkBuildLockAvailability } from "@unframe-dev/workspace-node";
import { type ProjectSnapshot } from "@unframe-dev/contracts/author-http";
import {
  AuthorTransactionConflict,
  commitAuthorSource,
  prepareAuthorStorage,
  readAuthorReceipt,
  recoverAuthorTransactions,
} from "@unframe-dev/workspace-node";

function fail(status: number, code: string, message: string): never {
  throw new AuthorError(status, code, message);
}
type Discovery = Extract<
  Awaited<ReturnType<typeof discoverPresentationProjectFiles>>,
  { ok: true }
>;
type ProjectState = {
  snapshot: ProjectSnapshot;
  preparedInputs?: AnalysisOperations["project"]["output"]["preparedInputs"];
  found: Discovery;
  typeLibraries: Awaited<ReturnType<typeof readTypeLibraries>>;
};
export type AuthorBuildProfile = {
  channel: "dev" | "dist";
  exitCode: PresentationCliExitCode | null;
  durationMilliseconds: number;
  stages: Partial<Record<PresentationCliBuildTiming["stage"], number>>;
  opaqueCaptures: { hits: number; misses: number };
};
const readPublishedArtifacts = async (
  directory: string,
  generationId: string,
  instanceIds: readonly string[],
  channel: "dev" | "dist" = "dev",
  maxBytes = 256 * 1024 * 1024,
) => {
  return readAuthorArtifacts(
    generationId,
    () => readBuildGeneration(directory, { channel, generationId }),
    instanceIds,
    maxBytes,
  );
};

export const createAuthorService = async (
  directory: string,
  options: {
    run?: (input: RunPresentationCliInput) => ReturnType<typeof runPresentationCli>;
    readPublishedArtifacts?: typeof readPublishedArtifacts;
    artifactRetention?: { maxGenerations?: number; maxBytes?: number };
    maxCompletedJobs?: number;
    onBuildProfile?: (profile: AuthorBuildProfile) => void;
  } = {},
): Promise<AuthorService> => {
  const readPublished = options.readPublishedArtifacts ?? readPublishedArtifacts;
  const run = options.run ?? runPresentationCli;
  const captureCache = createOpaqueCaptureCache();
  let closed = false;
  const shutdown = new AbortController();
  const workers = new Set<Promise<unknown>>();
  const analyze = <K extends keyof AnalysisOperations>(
    operation: K,
    input: AnalysisOperations[K]["input"],
    signal: AbortSignal,
  ) => {
    const result = runAnalysisOperation(operation, input, signal);
    workers.add(result);
    void result.then(
      () => workers.delete(result),
      () => workers.delete(result),
    );
    return result;
  };
  let cached: ProjectState | undefined;
  let captureSequence = 0;
  let latestCapture = 0;
  let analyzing: { revision: string; sequence: number; promise: Promise<ProjectState> } | undefined;
  const withSource = async <T>(
    callback: () => Promise<T>,
    allowRecovery = false,
    waitTimeoutMs = 5000,
    signal?: AbortSignal,
  ): Promise<T> => {
    const lease = await acquireSourceLock(directory, {
      allowRecovery,
      waitTimeoutMs,
      ...(signal ? { signal } : {}),
    });
    if (!lease.ok) fail(409, lease.code, "Project source is busy or requires recovery.");
    try {
      return await lease.value.run(async () => {
        if (allowRecovery) {
          try {
            await recoverAuthorTransactions(directory);
          } catch {
            fail(409, "author-recovery-required", "Source save recovery requires attention.");
          }
        }
        return await callback();
      });
    } finally {
      await lease.value.release();
    }
  };
  const readState = async (signal?: AbortSignal, recovery = false): Promise<ProjectState> => {
    const captured = await withSource(
      async () => {
        const previous = cached;
        let found: Awaited<ReturnType<typeof discoverPresentationProjectFiles>>;
        if (previous) {
          const current = await readPresentationProjectRevision(directory, {
            sourceLeaseHeld: true,
          });
          found = !current.ok
            ? current
            : current.revision === previous.snapshot.revision
              ? previous.found
              : await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
        } else {
          found = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
        }
        if (!found.ok) {
          latestCapture = ++captureSequence;
          cached = undefined;
          fail(500, found.code, found.message);
        }
        const sequence = ++captureSequence;
        latestCapture = sequence;
        if (cached?.snapshot.revision !== found.revision) cached = undefined;
        return { found, sequence };
      },
      recovery,
      Number.POSITIVE_INFINITY,
      signal,
    );
    const { found, sequence } = captured;
    if (cached?.snapshot.revision === found.revision) return cached;
    if (analyzing?.revision === found.revision) {
      analyzing.sequence = sequence;
      return analyzing.promise;
    }
    const prepared = readTypeLibraries().then(async (typeLibraries) => ({
      found,
      typeLibraries,
      ...(await analyze(
        "project",
        { found, typeLibraries, modelTransformIdentity: sourceAssetPorts.modelTransformIdentity },
        shutdown.signal,
      )),
    }));
    const analysis = { revision: found.revision, sequence, promise: prepared };
    analysis.promise = prepared
      .then((current) => {
        if (signal?.aborted || shutdown.signal.aborted)
          fail(409, "cli-cancelled", "Project analysis was cancelled.");
        if (!closed && analysis.sequence === latestCapture && current.snapshot.irHash !== null)
          cached = current;
        return current;
      })
      .finally(() => {
        if (analyzing === analysis) analyzing = undefined;
      });
    analyzing = analysis;
    return analysis.promise;
  };
  const service = await createService(
    {
      initialize: async () => {
        await prepareAuthorStorage(directory);
        const lease = await acquireSourceLock(directory, { allowRecovery: true });
        if (!lease.ok) fail(409, lease.code, "Project source is busy or requires recovery.");
        try {
          try {
            await lease.value.run(() => recoverAuthorTransactions(directory));
          } catch {
            fail(409, "author-recovery-required", "Source save recovery requires attention.");
          }
        } finally {
          await lease.value.release();
        }
      },
      project: async (signal) => (await readState(signal)).snapshot,
      patch: (revision, request, signal) =>
        saveAuthorPatch(revision, request, {
          withCommit: (callback) => withSource(callback, true, Number.POSITIVE_INFINITY, signal),
          readReceipt: (id) => readAuthorReceipt(directory, id),
          readCurrent: () => readState(signal, true),
          prepare: (current, revision, request) =>
            analyze(
              "save",
              {
                found: current.found,
                typeLibraries: current.typeLibraries,
                snapshot: current.snapshot,
                modelTransformIdentity: sourceAssetPorts.modelTransformIdentity,
                revision,
                request,
              },
              signal,
            ),
          currentRevision: async () => {
            const latest = await readPresentationProjectRevision(directory, {
              sourceLeaseHeld: true,
            });
            return latest.ok ? latest.revision : undefined;
          },
          commit: async (current, { afterSource, saved }, requestHash) => {
            const beforeSource = current.found.localFiles.find(
              (file) => file.path === current.found.entryFile,
            )?.bytes;
            if (!beforeSource)
              fail(500, "author-source-io", "Presentation source could not be read.");
            try {
              await commitAuthorSource({
                root: directory,
                sourcePath: current.found.entryFile,
                beforeSource,
                afterSource,
                requestHash,
                saved,
              });
            } catch (error) {
              if (error instanceof AuthorTransactionConflict)
                fail(412, "author-revision-mismatch", "Project inputs changed during save.");
              throw error;
            }
            return saved;
          },
        }),
      checkBuildAvailability: async () => {
        const availability = await checkBuildLockAvailability(directory);
        if (!availability.ok)
          fail(
            availability.code === "cli-build-lock-unavailable" ? 409 : 500,
            availability.code,
            "Another build owns this project or its build lock is unsafe.",
          );
      },
      validateRevision: async (revision, signal) =>
        withSource(
          async () => {
            const found = await readPresentationProjectRevision(directory, {
              sourceLeaseHeld: true,
            });
            if (!found.ok) fail(500, found.code, found.message);
            if (found.revision !== revision)
              fail(412, "author-revision-mismatch", "Project revision changed.");
          },
          false,
          Number.POSITIVE_INFINITY,
          signal,
        ),
      canReuseBuild: async ({ revision, channel, generationId, identity }, signal) => {
        const matches = async () => {
          if (signal.aborted) return false;
          const found = await readPresentationProjectRevision(directory, {
            sourceLeaseHeld: true,
          });
          if (!found.ok || found.revision !== revision) return false;
          const current = await readBuildGeneration(directory, { channel });
          return (
            current.generationId === generationId &&
            hashCanonicalJsonPayload(current.artifacts.buildManifest) === identity
          );
        };
        try {
          if (!(await withSource(matches, false, Number.POSITIVE_INFINITY, signal))) return false;
          const fixed = await readBuildGeneration(directory, { channel, generationId });
          if (hashCanonicalJsonPayload(fixed.artifacts.buildManifest) !== identity) return false;
          for (const id of Object.keys(fixed.artifacts.assetSet.assets)) {
            if (signal.aborted) return false;
            await fixed.readAsset(id);
          }
          return await withSource(matches, false, Number.POSITIVE_INFINITY, signal);
        } catch {
          return false;
        }
      },
      prepareBuild: async (revision, _channel, signal) => {
        const current = await readState(signal);
        if (current.snapshot.revision !== revision)
          fail(412, "author-revision-mismatch", "Project revision changed.");
        if (!current.snapshot.irHash)
          fail(422, "author-source-invalid", "Project source cannot be built.");
        return { revision, snapshot: current.snapshot };
      },

      run: async ({ revision, channel, signal }) => {
        const started = options.onBuildProfile ? performance.now() : 0;
        const before = captureCache.stats();
        const stages: AuthorBuildProfile["stages"] = {};
        let exitCode: PresentationCliExitCode | null = null;
        try {
          const result = await run({
            args: ["build", directory, "--format", "json"],
            host: {
              expectedRevision: revision,
              channel,
              signal,
              ...(channel === "dev" ? { opaqueCaptureCache: captureCache } : {}),
              ...(options.onBuildProfile
                ? {
                    onBuildTiming: (timing: PresentationCliBuildTiming) => {
                      stages[timing.stage] =
                        (stages[timing.stage] ?? 0) + timing.durationMilliseconds;
                    },
                  }
                : {}),
              prepareInputs: async (found, signal) => {
                const preparedInputs =
                  cached?.snapshot.revision === found.revision ? cached.preparedInputs : undefined;
                if (preparedInputs) return { ok: true, value: structuredClone(preparedInputs) };
                return analyze(
                  "prepare",
                  {
                    found,
                    typeLibraries: await readTypeLibraries(),
                    modelTransformIdentity: sourceAssetPorts.modelTransformIdentity,
                  },
                  signal ?? shutdown.signal,
                );
              },
            },
          });
          exitCode = result.exitCode;
          return readBuildExecutionResult(result);
        } finally {
          if (options.onBuildProfile) {
            const after = captureCache.stats();
            try {
              options.onBuildProfile({
                channel,
                exitCode,
                durationMilliseconds: performance.now() - started,
                stages,
                opaqueCaptures: {
                  hits: after.hits - before.hits,
                  misses: after.misses - before.misses,
                },
              });
            } catch {
              // Diagnostic output must not change a build's outcome.
            }
          }
        }
      },
      readPublishedArtifacts: (generation, instances, channel, maxBytes) =>
        readPublished(directory, generation, instances, channel, maxBytes),
    },
    options,
  );
  return {
    ...service,
    close: async () => {
      closed = true;
      shutdown.abort();
      cached = undefined;
      analyzing = undefined;
      await service.close();
      await Promise.allSettled(workers);
      captureCache.clear();
    },
  };
};
