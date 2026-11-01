import { sourceAssetPorts } from "../application/media-ports.js";
import { readBuildExecutionResult } from "./build-result.js";
import { createProjectRevision } from "@unframe/workspace";
import {
  createAuthorService as createService,
  saveAuthorPatch,
  prepareAuthorSave,
  readAuthorArtifacts,
  createAuthorProjectSnapshot,
  AuthorError,
  type AuthorService,
} from "@unframe/author-service";
import { join } from "node:path";
import { runPresentationCli } from "../application/run-presentation-cli.js";
import type { RunPresentationCliInput } from "../application/types.js";
import { discoverPresentationProjectFiles } from "@unframe/workspace-node";
import { loadUnframeLock } from "@unframe/workspace";
import { prepareProjectSource } from "@unframe/workspace-node";
import { StylePreparationError } from "@unframe/build";
import { readRegularFile } from "@unframe/workspace-node";
import { readBuildGeneration } from "@unframe/workspace-node";
import { acquireSourceLock } from "@unframe/workspace-node";
import { refreshLocalProjectLock } from "@unframe/workspace-node";
import { resolveDevProjectSourceAssets } from "@unframe/workspace-node";
import { type ProjectSnapshot } from "@unframe/contracts/author-http";
import {
  AuthorTransactionConflict,
  commitAuthorPair,
  prepareAuthorStorage,
  readAuthorReceipt,
  recoverAuthorTransactions,
} from "@unframe/workspace-node";

function fail(status: number, code: string, message: string): never {
  throw new AuthorError(status, code, message);
}
type Discovery = Extract<
  Awaited<ReturnType<typeof discoverPresentationProjectFiles>>,
  { ok: true }
>;
type Loaded = Extract<ReturnType<typeof loadUnframeLock>, { ok: true }>;
const sourceInput = async (found: Discovery, loaded: Loaded, replacement?: string) =>
  prepareProjectSource(sourceAssetPorts.styles, found, loaded.value.lock, {
    refresh: true,
    ...(replacement !== undefined ? { replacement } : {}),
  });
const sourceRevision = async (found: Discovery, entryBytes: Uint8Array, lockBytes: Uint8Array) => {
  const config = await readRegularFile(join(found.projectDirectory, "unframe.config.ts"));
  if (!config) fail(500, "author-source-io", "Project config could not be read.");
  return createProjectRevision({
    configBytes: config,
    lockBytes,
    localFiles: found.localFiles,
    entryReplacement: { path: found.entryFile, bytes: entryBytes },
  });
};
type ProjectState = {
  snapshot: ProjectSnapshot;
  found: Discovery;
  loaded: Loaded;
  sourceText: string;
  source?: unknown;
};
const readState = async (directory: string, captured?: Discovery): Promise<ProjectState> => {
  const found =
    captured ?? (await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true }));
  if (!found.ok) fail(500, found.code, found.message);
  const loaded = loadUnframeLock(found.lockBytes);
  if (!loaded.ok) fail(422, loaded.diagnostic.code, loaded.diagnostic.message);
  const sourceText = found.files.find((file) => file.fileName === found.entryFile)?.sourceText;
  if (sourceText === undefined)
    fail(500, "author-source-missing", "Presentation source is missing.");
  let prepared: Parameters<typeof createAuthorProjectSnapshot>[0]["prepared"];
  try {
    prepared = { ok: true, ...(await sourceInput(found, loaded)) };
  } catch (error) {
    if (!(error instanceof StylePreparationError)) throw error;
    prepared = {
      ok: false,
      code: error.code,
      message: error.message,
      diagnostics: error.diagnostics,
    };
  }
  const result = await createAuthorProjectSnapshot({
    revision: found.revision,
    sourceText,
    files: found.files,
    localFiles: found.localFiles,
    componentLocks: loaded.value.assemblyCarrier.componentLocks,
    carrier: loaded.value.assemblyCarrier,
    prepared,
    resolveAssets: () =>
      resolveDevProjectSourceAssets(sourceAssetPorts, found.assetSources, found.localFiles),
  });
  return { found, loaded, sourceText, ...result };
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
  } = {},
): Promise<AuthorService> => {
  const readPublished = options.readPublishedArtifacts ?? readPublishedArtifacts;
  const run = options.run ?? runPresentationCli;
  return createService(
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
      withSource: async (callback, allowRecovery, waitTimeoutMs, signal) => {
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
      },
      project: async () => (await readState(directory)).snapshot,
      patch: (revision, request) =>
        saveAuthorPatch(revision, request, {
          readReceipt: (id) => readAuthorReceipt(directory, id),
          readCurrent: () => readState(directory),
          prepare: (current, revision, request) =>
            prepareAuthorSave({
              source: current.source,
              sourceText: current.sourceText,
              entryFile: current.found.entryFile,
              snapshot: current.snapshot,
              revision,
              request,
              lock: current.loaded.value.lock,
              prepareSource: async (text) => {
                const prepared = await sourceInput(current.found, current.loaded, text);
                return {
                  source: prepared.source,
                  ...(prepared.styleTransform ? { styleTransform: prepared.styleTransform } : {}),
                  ...(prepared.styleSourceIdentity
                    ? { styleSourceIdentity: prepared.styleSourceIdentity }
                    : {}),
                };
              },
              resolveAssets: async () => {
                const assets = await resolveDevProjectSourceAssets(
                  sourceAssetPorts,
                  current.found.assetSources,
                  current.found.localFiles,
                );
                if (!assets.ok) fail(422, assets.code, assets.message);
                return {
                  assets: assets.value.assets,
                  bytes: assets.value.sourceAssetBytes,
                };
              },
              revisionFor: (source, lock) => sourceRevision(current.found, source, lock),
            }),
          currentRevision: async () => {
            const latest = await discoverPresentationProjectFiles(directory, {
              sourceLeaseHeld: true,
            });
            return latest.ok ? latest.revision : undefined;
          },
          commit: async (current, { afterSource, lockBytes, saved }, requestHash) => {
            const beforeSource = current.found.localFiles.find(
              (file) => file.path === current.found.entryFile,
            )?.bytes;
            if (!beforeSource)
              fail(500, "author-source-io", "Presentation source could not be read.");
            try {
              await commitAuthorPair({
                root: directory,
                sourcePath: current.found.entryFile,
                beforeSource,
                afterSource,
                beforeLock: current.found.lockBytes,
                afterLock: lockBytes,
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
      prepareBuild: async (revision, channel) => {
        const refreshed =
          channel === "dev"
            ? await refreshLocalProjectLock(sourceAssetPorts, directory, {
                sourceLeaseHeld: true,
                expectedRevision: revision,
              })
            : { ok: true as const, revision };
        if (!refreshed.ok)
          fail(
            refreshed.code === "cli-output-stale" ? 412 : 422,
            refreshed.code,
            refreshed.message,
          );
        const current = await readState(directory);
        if (current.snapshot.revision !== refreshed.revision)
          fail(412, "author-revision-mismatch", "Project revision changed.");
        if (!current.snapshot.irHash)
          fail(422, "author-source-invalid", "Project source cannot be built.");
        return { revision: refreshed.revision, snapshot: current.snapshot };
      },

      run: async ({ revision, channel, signal }) =>
        readBuildExecutionResult(
          await run({
            args: ["build", directory, "--format", "json"],
            host: { expectedRevision: revision, channel, signal },
          }),
        ),
      readPublishedArtifacts: (generation, instances, channel, maxBytes) =>
        readPublished(directory, generation, instances, channel, maxBytes),
    },
    options,
  );
};
