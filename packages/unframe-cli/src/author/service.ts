import { createHash, randomBytes } from "node:crypto";
import { readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import {
  checkAuthoringProject,
  checkAuthoringProjectAssembly,
  computeFrozenComponentInputs,
  patchEditableReactScene,
  readEditableReactScene,
} from "@unframe/unframe-compiler";
import { canonicalizeJsonPayload, hashCanonicalJsonPayload } from "@unframe/unframe-core";
import { runPresentationCli } from "../application/run-presentation-cli.js";
import type { RunPresentationCliInput } from "../application/types.js";
import { discoverPresentationProjectFiles } from "../filesystem/discover-project.js";
import { verifyFrozenLocalFiles } from "../filesystem/frozen-local-files.js";
import { loadUnframeLock } from "../filesystem/load-lock.js";
import { hashDependencyGraph, type UnframeLockV2 } from "../filesystem/lock-v2.js";
import { lockedFile } from "../filesystem/package-snapshot.js";
import { readRegularFile } from "../filesystem/path-policy.js";
import { acquireSourceLock } from "../filesystem/source-lock.js";
import {
  AuthorError,
  type AuthorDiagnostic,
  type AuthorService,
  type BuildJob,
  type ProjectSnapshot,
  type SavedCommand,
} from "./contract.js";
import {
  AuthorTransactionConflict,
  commitAuthorPair,
  prepareAuthorStorage,
  readAuthorReceipt,
  recoverAuthorTransactions,
} from "./save-transaction.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const randomId = () => randomBytes(16).toString("hex");
const diagnostic = (
  code: string,
  message: string,
  path?: ReadonlyArray<string | number>,
): AuthorDiagnostic => ({ code, message, ...(path ? { path } : {}) });
function fail(status: number, code: string, message: string): never {
  throw new AuthorError(status, code, message);
}
type Discovery = Extract<
  Awaited<ReturnType<typeof discoverPresentationProjectFiles>>,
  { ok: true }
>;
type Loaded = Extract<ReturnType<typeof loadUnframeLock>, { ok: true }>;
const sourceInput = (found: Discovery, loaded: Loaded, replacement?: string) => ({
  entryFile: found.entryFile,
  files: found.files.map((file) =>
    file.fileName === found.entryFile && replacement !== undefined
      ? { ...file, sourceText: replacement }
      : file,
  ),
  projectRoot: found.projectDirectory,
  rawFiles: found.localFiles
    .filter(({ path }) => /\.(js|mjs|cjs|css|png|jpe?g|webp|ttf|otf)$/i.test(path))
    .map(({ bytes, path }) => lockedFile(path, bytes)),
  ...loaded.value.virtualSource,
});
const sourceRevision = async (found: Discovery, entryBytes: Uint8Array, lockBytes: Uint8Array) => {
  const config = await readRegularFile(join(found.projectDirectory, "unframe.config.ts"));
  if (!config) {
    fail(500, "author-source-io", "Project config could not be read.");
  }
  const inputs = [
    { bytes: config, path: "unframe.config.ts" },
    { bytes: lockBytes, path: "unframe.lock" },
    ...found.localFiles.map((file) =>
      file.path === found.entryFile ? { bytes: entryBytes, path: file.path } : file,
    ),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return (
    "sha256:" +
    digest(encoder.encode(JSON.stringify(inputs.map(({ bytes, path }) => [path, digest(bytes)]))))
  );
};
type ProjectState = {
  catalog?: Extract<ReturnType<typeof checkAuthoringProject>, { valid: true }>["value"];
  found: Discovery;
  loaded: Loaded;
  snapshot: ProjectSnapshot;
  sourceText: string;
};
const readState = async (directory: string): Promise<ProjectState> => {
  const found = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
  if (!found.ok) {
    fail(500, found.code, found.message);
  }
  const loaded = loadUnframeLock(found.lockBytes);
  if (!loaded.ok) {
    fail(422, loaded.diagnostic.code, loaded.diagnostic.message);
  }
  const sourceText = found.files.find((file) => file.fileName === found.entryFile)?.sourceText;
  if (sourceText === undefined) {
    fail(500, "author-source-missing", "Presentation source is missing.");
  }
  const source = sourceInput(found, loaded);
  const fallbackHash = hashCanonicalJsonPayload(
    source.files.map(({ fileName, sourceText }) => [fileName, sourceText]),
  );
  const frozen = verifyFrozenLocalFiles(
    found.localFiles,
    loaded.value.assemblyCarrier.componentLocks,
  );
  const catalog = checkAuthoringProject(source);
  const checked =
    frozen.length === 0
      ? checkAuthoringProjectAssembly(source, loaded.value.assemblyCarrier)
      : undefined;
  const diagnostics: Array<AuthorDiagnostic> = [
    ...frozen.map((item) =>
      diagnostic(item.code, "Source differs from its frozen lock.", [item.path]),
    ),
    ...(!catalog.valid
      ? catalog.diagnostics.map((item) =>
          diagnostic(item.code, item.message, [item.fileName, item.line, item.column]),
        )
      : []),
    ...(checked && !checked.valid
      ? checked.diagnostics.map((item) =>
          diagnostic(
            item.code,
            item.message,
            "path" in item ? item.path : [item.fileName, item.line, item.column],
          ),
        )
      : []),
  ];
  const editable =
    catalog.valid && checked?.valid ? readEditableReactScene(catalog.value, sourceText) : undefined;
  if (editable && !editable.ok) {
    diagnostics.push(
      ...editable.diagnostics.map((item) =>
        diagnostic(item.code, item.message, item.instanceId ? [item.instanceId] : []),
      ),
    );
  }
  const instances = editable?.ok
    ? editable.value.map((item) => ({
        instanceId: item.instanceId,
        props: Object.fromEntries(
          Object.entries(item.props).map(([id, prop]) => [
            id,
            { editable: prop.editable, type: prop.kind, value: prop.value },
          ]),
        ),
        transform: {
          position: [...item.transform.position] as [number, number, number],
          rotation: [...item.transform.rotation] as [number, number, number, number],
          scale: [...item.transform.scale] as [number, number, number],
        },
        transformEditable: item.transformEditable,
      }))
    : [];
  return {
    found,
    loaded,
    sourceText,
    ...(catalog.valid ? { catalog: catalog.value } : {}),
    snapshot: {
      diagnostics,
      instances,
      irHash: checked?.valid && editable?.ok ? checked.value.definitionHash : null,
      revision: found.revision,
      sourceHash: checked?.valid ? checked.value.sourceHash : fallbackHash,
    },
  };
};
const surfaceIdFor = (instanceId: string) =>
  "r:" + digest(encoder.encode(JSON.stringify(["react-component-v1", "surface", instanceId, ""])));
const readPublishedArtifacts = async (directory: string, instanceIds: ReadonlyArray<string>) => {
  const link = await readlink(join(directory, "dist"));
  const match = /^\.unframe\/generations\/([0-9a-f]{32})$/.exec(link);
  if (!match) {
    fail(500, "author-output-unsafe", "Build output is not a managed generation.");
  }
  const generation = join(directory, ".unframe", "generations", match[1]!);
  const bundle = JSON.parse(
    decoder.decode(await readFile(join(generation, "render-bundle.json"))),
  ) as {
    surfaces: Record<
      string,
      {
        renderSurfaces: Record<
          string,
          {
            artifacts: Record<string, { states: Record<string, { texture: { assetId: string } }> }>;
          }
        >;
      }
    >;
  };
  const assetSet = JSON.parse(
    decoder.decode(await readFile(join(generation, "asset-set.json"))),
  ) as {
    assets: Record<string, { mediaType: string }>;
  };
  const catalog: BuildJob["artifacts"] = [];
  const catalogKeys = new Set<string>();
  const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  for (const instanceId of instanceIds) {
    const surface = bundle.surfaces[surfaceIdFor(instanceId)];
    if (!surface) {
      continue;
    }
    for (const renderSurface of Object.values(surface.renderSurfaces)) {
      for (const artifact of Object.values(renderSurface.artifacts)) {
        for (const state of Object.values(artifact.states)) {
          const assetId = state.texture.assetId;
          const mediaType = assetSet.assets[assetId]?.mediaType;
          if (mediaType !== "image/png") continue;
          if (!assets.has(assetId)) {
            const bytes = await readFile(
              join(generation, "assets", encodeURIComponent(assetId) + ".png"),
            );
            assets.set(assetId, { bytes: new Uint8Array(bytes), mediaType });
          }
          const key = JSON.stringify([instanceId, assetId]);
          if (!catalogKeys.has(key)) {
            catalogKeys.add(key);
            catalog.push({ assetId, mediaType, instanceId });
          }
        }
      }
    }
  }
  return { assets, catalog };
};

export const createAuthorService = async (
  directory: string,
  options: {
    readPublishedArtifacts?: typeof readPublishedArtifacts;
    run?: (input: RunPresentationCliInput) => ReturnType<typeof runPresentationCli>;
  } = {},
): Promise<AuthorService> => {
  await prepareAuthorStorage(directory);
  const initial = await acquireSourceLock(directory, { allowRecovery: true });
  if (!initial.ok) {
    fail(409, initial.code, "Project source is busy or requires recovery.");
  }
  try {
    try {
      await recoverAuthorTransactions(directory);
    } catch {
      fail(409, "author-recovery-required", "Source save recovery requires attention.");
    }
  } finally {
    await initial.value.release();
  }
  const run = options.run ?? runPresentationCli;
  const readPublished = options.readPublishedArtifacts ?? readPublishedArtifacts;
  const jobs = new Map<
    string,
    {
      assets: Map<string, { bytes: Uint8Array; mediaType: string }>;
      controller: AbortController;
      job: BuildJob;
      promise: Promise<void> | undefined;
    }
  >();
  const requests = new Map<string, { buildId: string; revision: string }>();
  let closed = false;
  const withSource = async <T>(callback: () => Promise<T>, allowRecovery = false): Promise<T> => {
    if (closed) {
      fail(409, "author-service-closed", "Author host is closed.");
    }
    const lease = await acquireSourceLock(directory, { allowRecovery });
    if (!lease.ok) {
      fail(409, lease.code, "Project source is busy or requires recovery.");
    }
    try {
      if (allowRecovery) {
        try {
          await recoverAuthorTransactions(directory);
        } catch {
          fail(409, "author-recovery-required", "Source save recovery requires attention.");
        }
      }
      return await callback();
    } finally {
      await lease.value.release();
    }
  };
  const getJob = (id: string) => {
    const value = jobs.get(id);
    if (!value) {
      fail(404, "author-build-not-found", "Build job was not found.");
    }
    return value;
  };
  return {
    artifact: async (id, assetId) => {
      const record = getJob(id);
      if (record.job.status !== "succeeded") {
        fail(404, "author-asset-not-found", "Build asset was not found.");
      }
      const value = record.assets.get(assetId);
      if (!value) {
        fail(404, "author-asset-not-found", "Build asset was not found.");
      }
      return { bytes: value.bytes.slice(), mediaType: value.mediaType };
    },
    build: async (revision, requestId) => {
      let start: (() => void) | undefined;
      const response = await withSource(async () => {
        const existing = requests.get(requestId);
        if (existing) {
          if (existing.revision !== revision) {
            fail(
              409,
              "author-request-id-conflict",
              "Build request ID was used for another revision.",
            );
          }
          return getJob(existing.buildId).job;
        }
        const current = await readState(directory);
        if (current.snapshot.revision !== revision) {
          fail(412, "author-revision-mismatch", "Project revision changed.");
        }
        if (!current.snapshot.irHash) {
          fail(422, "author-source-invalid", "Project source cannot be built.");
        }
        if (
          [...jobs.values()].some(({ job }) => job.status === "queued" || job.status === "running")
        ) {
          fail(409, "author-build-busy", "Another build is running.");
        }
        const buildId = randomId();
        const controller = new AbortController();
        const job: BuildJob = {
          artifacts: [],
          buildId,
          diagnostics: [],
          revision,
          status: "queued",
        };
        const record = {
          assets: new Map<string, { bytes: Uint8Array; mediaType: string }>(),
          controller,
          job,
          promise: undefined as Promise<void> | undefined,
        };
        jobs.set(buildId, record);
        requests.set(requestId, { buildId, revision });
        start = () => {
          record.promise = (async () => {
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (controller.signal.aborted) {
              job.status = "cancelled";
              return;
            }
            job.status = "running";
            try {
              const result = await run({
                args: ["build", directory, "--format", "json"],
                host: { expectedRevision: revision, signal: controller.signal },
              });
              if (controller.signal.aborted || result.exitCode === 130) {
                job.status = "cancelled";
                return;
              }
              if (result.exitCode !== 0) {
                job.status = result.stderr.includes("cli-output-stale") ? "stale" : "failed";
                job.diagnostics = [diagnostic("author-build-failed", result.stderr.trim())];
                return;
              }
              const latest = await withSource(
                async () => (await readState(directory)).snapshot.revision,
              );
              if (controller.signal.aborted) {
                job.status = "cancelled";
                return;
              }
              if (latest !== revision) {
                job.status = "stale";
                return;
              }
              const published = await readPublished(
                directory,
                current.snapshot.instances.map(({ instanceId }) => instanceId),
              );
              if (controller.signal.aborted) {
                job.status = "cancelled";
                return;
              }
              job.artifacts = published.catalog;
              record.assets = published.assets;
              job.status = "succeeded";
            } catch (error) {
              job.status = controller.signal.aborted ? "cancelled" : "failed";
              if (!controller.signal.aborted) {
                job.diagnostics = [
                  diagnostic(
                    "author-build-failed",
                    error instanceof Error ? error.message : "Build failed.",
                  ),
                ];
              }
            }
          })();
        };
        return job;
      });
      start?.();
      return response;
    },
    cancel: async (id) => {
      const record = getJob(id);
      if (record.job.status === "queued" || record.job.status === "running") {
        record.controller.abort();
      }
      return record.job;
    },
    close: async () => {
      closed = true;
      for (const item of jobs.values()) {
        item.controller.abort();
      }
      await Promise.all([...jobs.values()].map((item) => item.promise));
    },
    job: async (id) => getJob(id).job,
    patch: (revision, request) =>
      withSource(async () => {
        const requestHash = digest(encoder.encode(JSON.stringify({ request, revision })));
        const prior = await readAuthorReceipt(directory, request.commandId);
        if (prior) {
          if (prior.requestHash !== requestHash) {
            fail(409, "author-command-id-conflict", "Command ID was used for another request.");
          }
          return prior.saved;
        }
        const current = await readState(directory);
        if (
          current.snapshot.revision !== revision ||
          current.snapshot.irHash !== request.expectedIrHash
        ) {
          fail(412, "author-revision-mismatch", "Project revision or IR changed.");
        }
        if (!current.catalog || !current.snapshot.irHash) {
          fail(422, "author-source-invalid", "Project source cannot be edited.");
        }
        const patched = patchEditableReactScene(
          current.catalog,
          current.sourceText,
          request.command,
        );
        if (!patched.ok) {
          fail(
            422,
            patched.diagnostics[0]?.code ?? "author-edit-unsupported",
            patched.diagnostics[0]?.message ?? "Edit is unsupported.",
          );
        }
        const source = sourceInput(current.found, current.loaded, patched.value);
        const catalog = checkAuthoringProject(source);
        if (!catalog.valid) {
          fail(
            422,
            catalog.diagnostics[0]?.code ?? "author-source-invalid",
            catalog.diagnostics[0]?.message ?? "Patched source is invalid.",
          );
        }
        const computed = computeFrozenComponentInputs(source, catalog.value);
        if (!computed.valid) {
          fail(
            422,
            computed.diagnostics[0]?.code ?? "author-lock-invalid",
            computed.diagnostics[0]?.message ?? "Patched lock is invalid.",
          );
        }
        const base = current.loaded.value.lock;
        const nextWithoutHash = {
          ...base,
          componentLocks: computed.value.componentLocks.map((item) => ({
            ...item,
          })) as UnframeLockV2["componentLocks"],
          themeHashes: computed.value.themeHashes.map((item) => ({
            hash: item.hash as UnframeLockV2["themeHashes"][number]["hash"],
            themeId: item.themeId,
          })),
        };
        const nextLock: UnframeLockV2 = {
          ...nextWithoutHash,
          dependencyGraphHash: hashDependencyGraph(nextWithoutHash),
        };
        const lockBytes = encoder.encode(canonicalizeJsonPayload(nextLock) + "\n");
        const loaded = loadUnframeLock(lockBytes);
        if (!loaded.ok) {
          fail(422, loaded.diagnostic.code, loaded.diagnostic.message);
        }
        const checked = checkAuthoringProjectAssembly(source, loaded.value.assemblyCarrier);
        if (!checked.valid) {
          fail(
            422,
            checked.diagnostics[0]?.code ?? "author-source-invalid",
            checked.diagnostics[0]?.message ?? "Patched source is invalid.",
          );
        }
        const afterSource = encoder.encode(patched.value);
        const saved: SavedCommand = {
          commandId: request.commandId,
          irHash: checked.value.definitionHash,
          revision: await sourceRevision(current.found, afterSource, lockBytes),
          sourceHash: checked.value.sourceHash,
        };
        const beforeSource = current.found.localFiles.find(
          (file) => file.path === current.found.entryFile,
        )?.bytes;
        if (!beforeSource) {
          fail(500, "author-source-io", "Presentation source could not be read.");
        }
        const latest = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
        if (!latest.ok || latest.revision !== current.found.revision) {
          fail(412, "author-revision-mismatch", "Project inputs changed during save.");
        }
        try {
          await commitAuthorPair({
            afterLock: lockBytes,
            afterSource,
            beforeLock: current.found.lockBytes,
            beforeSource,
            requestHash,
            root: directory,
            saved,
            sourcePath: current.found.entryFile,
          });
        } catch (error) {
          if (error instanceof AuthorTransactionConflict) {
            fail(412, "author-revision-mismatch", "Project inputs changed during save.");
          }
          throw error;
        }
        for (const item of jobs.values()) {
          if (item.job.status === "queued" || item.job.status === "running")
            item.controller.abort();
        }
        return saved;
      }, true),
    project: () => withSource(async () => (await readState(directory)).snapshot),
  };
};
