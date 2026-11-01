import { readBuildExecutionResult } from "./build-result.js";
import { createWorkspaceSnapshot } from "@unframe/workspace";
import {
  createAuthorService as createService,
  createAuthorPatch,
  inspectAuthorSource,
  surfaceIdFor,
  AuthorError,
  type AuthorService,
} from "@unframe/author-service";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  checkAuthoringProjectAssembly,
  computeFrozenComponentInputs,
} from "../source-preparation/index.js";
import { checkAuthoringProject } from "@unframe/source";
import { canonicalizeJsonPayload, hashCanonicalJsonPayload } from "@unframe/artifacts";
import { runPresentationCli } from "../application/run-presentation-cli.js";
import { sourceDiagnosticFamily } from "../application/source-diagnostic-family.js";
import type { RunPresentationCliInput } from "../application/types.js";
import { discoverPresentationProjectFiles } from "../filesystem/discover-project.js";
import { verifyFrozenLocalFiles } from "@unframe/workspace";
import { loadUnframeLock } from "@unframe/workspace";
import { hashDependencyGraph, type UnframeLock } from "@unframe/workspace";
import { prepareProjectSource, StylePreparationError } from "../filesystem/prepare-project.js";
import { styleDiagnostics } from "../application/style-diagnostics.js";
import { readRegularFile } from "@unframe/workspace-node";
import { readBuildGeneration } from "../filesystem/read-build-generation.js";
import { acquireSourceLock } from "@unframe/workspace-node";
import { refreshLocalProjectLock } from "../filesystem/refresh-local-lock.js";
import {
  createSourceAssetAssemblyCarrier,
  resolveDevProjectSourceAssets,
} from "../filesystem/source-assets.js";
import {
  type AuthorDiagnostic,
  type BuildJob,
  type ProjectSnapshot,
  type SavedCommand,
} from "@unframe/contracts/author-http";
import {
  AuthorTransactionConflict,
  commitAuthorPair,
  prepareAuthorStorage,
  readAuthorReceipt,
  recoverAuthorTransactions,
} from "@unframe/workspace-node";

const encoder = new TextEncoder();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const diagnostic = (
  code: string,
  message: string,
  path?: readonly (string | number)[],
): AuthorDiagnostic => ({ code, message, ...(path ? { path: [...path] } : {}) });
const sourceDiagnostic = (item: {
  code: string;
  message: string;
  fileName: string;
  start: number;
  end: number;
  line: number;
  column: number;
}): AuthorDiagnostic => ({
  family: sourceDiagnosticFamily(item.code),
  code: item.code,
  message: item.message,
  path: item.fileName ? [item.fileName] : [],
  ...(item.fileName
    ? {
        location: {
          fileName: item.fileName,
          start: item.start,
          end: item.end,
          line: item.line,
          column: item.column,
        },
      }
    : {}),
});
function fail(status: number, code: string, message: string): never {
  throw new AuthorError(status, code, message);
}
type Discovery = Extract<
  Awaited<ReturnType<typeof discoverPresentationProjectFiles>>,
  { ok: true }
>;
type Loaded = Extract<ReturnType<typeof loadUnframeLock>, { ok: true }>;
const sourceInput = async (found: Discovery, loaded: Loaded, replacement?: string) =>
  prepareProjectSource(found, loaded.value.lock, {
    refresh: true,
    ...(replacement !== undefined ? { replacement } : {}),
  });
const sourceRevision = async (found: Discovery, entryBytes: Uint8Array, lockBytes: Uint8Array) => {
  const config = await readRegularFile(join(found.projectDirectory, "unframe.config.ts"));
  if (!config) fail(500, "author-source-io", "Project config could not be read.");
  const inputs = [
    { path: "unframe.config.ts", bytes: config },
    { path: "unframe.lock", bytes: lockBytes },
    ...found.localFiles.map((file) =>
      file.path === found.entryFile ? { path: file.path, bytes: entryBytes } : file,
    ),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return createWorkspaceSnapshot(inputs).revision;
};
type ProjectState = {
  snapshot: ProjectSnapshot;
  found: Discovery;
  loaded: Loaded;
  catalog?: Extract<ReturnType<typeof checkAuthoringProject>, { valid: true }>["value"];
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
  let prepared: Awaited<ReturnType<typeof sourceInput>>;
  try {
    prepared = await sourceInput(found, loaded);
  } catch (error) {
    if (!(error instanceof StylePreparationError)) throw error;
    return {
      found,
      loaded,
      sourceText,
      snapshot: {
        revision: found.revision,
        sourceHash: hashCanonicalJsonPayload(
          found.files.map(({ fileName, sourceText }) => [fileName, sourceText]),
        ),
        irHash: null,
        definition: null,
        instances: [],
        diagnostics: error.diagnostics.length
          ? styleDiagnostics(error.diagnostics, error.code).map((item) => ({
              ...item,
              path: [...item.path],
            }))
          : [{ ...diagnostic(error.code, error.message), severity: "error" }],
      },
    };
  }
  const { source } = prepared;
  const fallbackHash = hashCanonicalJsonPayload(
    source.files.map(({ fileName, sourceText }) => [fileName, sourceText]),
  );
  const frozen = verifyFrozenLocalFiles(
    found.localFiles,
    loaded.value.assemblyCarrier.componentLocks,
  );
  const sourceAssets = await resolveDevProjectSourceAssets(found.assetSources, found.localFiles);
  const checked =
    frozen.length === 0 && sourceAssets.ok
      ? checkAuthoringProjectAssembly(
          source,
          createSourceAssetAssemblyCarrier(loaded.value.assemblyCarrier, sourceAssets.value.assets),
          sourceAssets.value.sourceAssetBytes,
        )
      : undefined;
  const diagnostics: AuthorDiagnostic[] = [
    ...styleDiagnostics(prepared.diagnostics).map((item) => ({ ...item, path: [...item.path] })),
    ...frozen.map((item) =>
      diagnostic(item.code, "Source differs from its frozen lock.", [item.path]),
    ),
    ...(!sourceAssets.ok
      ? [diagnostic(sourceAssets.code, sourceAssets.message, [sourceAssets.path])]
      : []),
    ...(checked && !checked.valid
      ? checked.diagnostics.map((item) =>
          "path" in item
            ? { ...diagnostic(item.code, item.message, item.path), family: "semantic" as const }
            : sourceDiagnostic(item),
        )
      : []),
  ];
  const inspected = inspectAuthorSource({
    source,
    sourceText,
    semanticValid: checked?.valid === true,
  });
  const { catalog, instances } = inspected;
  diagnostics.push(...inspected.diagnostics);
  return {
    found,
    loaded,
    sourceText,
    source,
    ...(catalog.valid ? { catalog: catalog.value } : {}),
    snapshot: {
      revision: found.revision,
      sourceHash: checked?.valid ? checked.value.sourceHash : fallbackHash,
      irHash: checked?.valid ? checked.value.definitionHash : null,
      definition: checked?.valid ? checked.value.definition : null,
      instances,
      diagnostics,
    },
  };
};
const readPublishedArtifacts = async (
  directory: string,
  generationId: string,
  instanceIds: readonly string[],
  channel: "dev" | "dist" = "dev",
  maxBytes = 256 * 1024 * 1024,
) => {
  if (!/^[0-9a-f]{32}$/.test(generationId))
    fail(500, "author-output-unsafe", "Build output is not a managed generation.");
  const generation = await readBuildGeneration(directory, { channel, generationId });
  const bundle = generation.artifacts.renderBundle;
  const assetSet = generation.artifacts.assetSet;
  const catalog: BuildJob["artifacts"] = [];
  const catalogKeys = new Set<string>();
  const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  let totalBytes = 0;
  for (const instanceId of instanceIds) {
    const surface = bundle.surfaces[surfaceIdFor(instanceId)];
    if (!surface) continue;
    for (const renderSurface of Object.values(surface.renderSurfaces))
      for (const artifact of Object.values(renderSurface.artifacts)) {
        if (artifact.kind !== "baked-web") continue;
        for (const [stateId, state] of Object.entries(artifact.states)) {
          const assetId = state.texture.assetId;
          const mediaType = assetSet.assets[assetId]?.mediaType;
          if (mediaType !== "image/png") continue;
          if (!assets.has(assetId)) {
            totalBytes += assetSet.assets[assetId]!.encodedSizeBytes;
            if (totalBytes > maxBytes)
              throw new RangeError("Author artifact byte budget exceeded.");
            assets.set(assetId, await generation.readAsset(assetId));
          }
          const key = JSON.stringify([instanceId, stateId, assetId]);
          if (!catalogKeys.has(key)) {
            catalogKeys.add(key);
            catalog.push({ assetId, mediaType, instanceId, stateId });
          }
        }
      }
  }
  return { catalog, assets };
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
      patch: async (revision, request) => {
        const requestHash = digest(encoder.encode(JSON.stringify({ revision, request })));
        const prior = await readAuthorReceipt(directory, request.commandId);
        if (prior) {
          if (prior.requestHash !== requestHash)
            fail(409, "author-command-id-conflict", "Command ID was used for another request.");
          return prior.saved;
        }
        const current = await readState(directory);
        const patched = {
          value: createAuthorPatch({
            source: current.source,
            sourceText: current.sourceText,
            entryFile: current.found.entryFile,
            snapshot: current.snapshot,
            revision,
            request,
          }),
        };
        const prepared = await sourceInput(current.found, current.loaded, patched.value.sourceText);
        const source = prepared.source;
        const catalog = checkAuthoringProject(source);
        if (!catalog.valid)
          fail(
            422,
            catalog.diagnostics[0]?.code ?? "author-source-invalid",
            catalog.diagnostics[0]?.message ?? "Patched source is invalid.",
          );
        const computed = computeFrozenComponentInputs(source, catalog.value);
        if (!computed.valid)
          fail(
            422,
            computed.diagnostics[0]?.code ?? "author-lock-invalid",
            computed.diagnostics[0]?.message ?? "Patched lock is invalid.",
          );
        const base = current.loaded.value.lock;
        const nextWithoutHash = {
          ...base,
          ...(prepared.styleTransform
            ? {
                styleTransform: prepared.styleTransform,
                styleSourceIdentity: prepared.styleSourceIdentity,
              }
            : {}),
          componentLocks: computed.value.componentLocks.map((item) => ({
            ...item,
          })) as UnframeLock["componentLocks"],
          themeHashes: computed.value.themeHashes.map((item) => ({
            themeId: item.themeId,
            hash: item.hash as UnframeLock["themeHashes"][number]["hash"],
          })),
        };
        const nextLock: UnframeLock = {
          ...nextWithoutHash,
          dependencyGraphHash: hashDependencyGraph(nextWithoutHash),
        };
        const lockBytes = encoder.encode(canonicalizeJsonPayload(nextLock) + "\n");
        const loaded = loadUnframeLock(lockBytes);
        if (!loaded.ok) fail(422, loaded.diagnostic.code, loaded.diagnostic.message);
        const sourceAssets = await resolveDevProjectSourceAssets(
          current.found.assetSources,
          current.found.localFiles,
        );
        if (!sourceAssets.ok) fail(422, sourceAssets.code, sourceAssets.message);
        const checked = checkAuthoringProjectAssembly(
          source,
          createSourceAssetAssemblyCarrier(loaded.value.assemblyCarrier, sourceAssets.value.assets),
          sourceAssets.value.sourceAssetBytes,
        );
        if (!checked.valid)
          fail(
            422,
            checked.diagnostics[0]?.code ?? "author-source-invalid",
            checked.diagnostics[0]?.message ?? "Patched source is invalid.",
          );
        const afterSource = encoder.encode(patched.value.sourceText);
        const saved: SavedCommand = {
          revision: await sourceRevision(current.found, afterSource, lockBytes),
          sourceHash: checked.value.sourceHash,
          irHash: checked.value.definitionHash,
          commandId: request.commandId,
        };
        const beforeSource = current.found.localFiles.find(
          (file) => file.path === current.found.entryFile,
        )?.bytes;
        if (!beforeSource) fail(500, "author-source-io", "Presentation source could not be read.");
        const latest = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
        if (!latest.ok || latest.revision !== current.found.revision)
          fail(412, "author-revision-mismatch", "Project inputs changed during save.");
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
      prepareBuild: async (revision, channel) => {
        const refreshed =
          channel === "dev"
            ? await refreshLocalProjectLock(directory, {
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
