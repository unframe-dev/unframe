import { createHash } from "node:crypto";
import {
  createSourceSnapshot,
  createReactScenePatch,
  checkAuthoringProject,
  readEditableReactScene,
  type CheckAuthoringProjectResult,
  type ReactScenePatch,
} from "@unframe/source";
import type {
  AuthorDiagnostic,
  AuthorInstance,
  BuildJob,
  ProjectSnapshot,
  SavedCommand,
  PatchRequest,
} from "@unframe/contracts/author-http";
import {
  createAuthorBuildService,
  computeFrozenComponentInputs,
  checkAuthoringProjectAssembly,
  createSourceAssetAssemblyCarrier,
  type AuthorBuildPorts,
} from "@unframe/build";
import { hashCanonicalJsonPayload, type BuildArtifacts } from "@unframe/artifacts";
import {
  refreshProjectLock,
  verifyFrozenLocalFiles,
  loadUnframeLock,
  type UnframeLock,
  type LockedSourceAsset,
} from "@unframe/workspace";
export class AuthorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path: string; reason: string }[] = [],
    readonly retryable = false,
  ) {
    super(message);
  }
}
export type AuthorService = {
  project(): Promise<ProjectSnapshot>;
  patch(revision: string, request: PatchRequest): Promise<SavedCommand>;
  build(revision: string, requestId: string, channel?: "dev" | "dist"): Promise<BuildJob>;
  job(id: string): Promise<BuildJob>;
  cancel(id: string): Promise<BuildJob>;
  artifact(id: string, assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  close(): Promise<void>;
};
export type AuthorServiceOptions = {
  artifactRetention?: { maxGenerations?: number; maxBytes?: number };
  maxCompletedJobs?: number;
};
export type AuthorServicePorts = {
  initialize(): Promise<void>;
  withSource<T>(
    callback: () => Promise<T>,
    allowRecovery: boolean,
    waitTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T>;
  project(): Promise<ProjectSnapshot>;
  patch(revision: string, request: PatchRequest): Promise<SavedCommand>;
  prepareBuild(
    revision: string,
    channel: "dev" | "dist",
  ): Promise<{ revision: string; snapshot: ProjectSnapshot }>;
  run: AuthorBuildPorts["run"];
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
export function createAuthorPatch(input: {
  source: unknown;
  sourceText: string;
  entryFile: string;
  snapshot: ProjectSnapshot;
  revision: string;
  request: PatchRequest;
}): ReactScenePatch {
  if (
    input.snapshot.revision !== input.revision ||
    input.snapshot.irHash !== input.request.expectedIrHash
  )
    fail(412, "author-revision-mismatch", "Project revision or IR changed.");
  if (!input.snapshot.irHash)
    fail(422, "author-source-invalid", "Project source cannot be edited.");
  if (input.snapshot.instances.length === 0)
    fail(422, "author-edit-unsupported", "Project source does not support Inspector edits.");
  const snapshot = createSourceSnapshot(input.source);
  if (!snapshot.ok) fail(422, "author-source-invalid", "Project source cannot be snapshotted.");
  const patched = createReactScenePatch({
    snapshot: snapshot.value,
    fileName: input.entryFile,
    targetHash: `sha256:${digest(encoder.encode(input.sourceText))}`,
    command: input.request.command,
  });
  if (!patched.ok)
    fail(
      422,
      patched.diagnostics[0]?.code ?? "author-edit-unsupported",
      patched.diagnostics[0]?.message ?? "Edit is unsupported.",
    );
  return patched.value;
}
function fail(status: number, code: string, message: string): never {
  throw new AuthorError(status, code, message);
}
const encoder = new TextEncoder();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function prepareAuthorSave(input: {
  source: unknown;
  sourceText: string;
  entryFile: string;
  snapshot: ProjectSnapshot;
  revision: string;
  request: PatchRequest;
  lock: UnframeLock;
  prepareSource(text: string): Promise<{
    source: unknown;
    styleTransform?: UnframeLock["styleTransform"];
    styleSourceIdentity?: string;
  }>;
  resolveAssets(): Promise<{
    assets: readonly LockedSourceAsset[];
    bytes: Readonly<Record<string, Uint8Array>>;
  }>;
  revisionFor(source: Uint8Array, lock: Uint8Array): Promise<string>;
}): Promise<{ afterSource: Uint8Array; lockBytes: Uint8Array; saved: SavedCommand }> {
  const patch = createAuthorPatch(input);
  const prepared = await input.prepareSource(patch.sourceText);
  const catalog = checkAuthoringProject(prepared.source);
  if (!catalog.valid)
    fail(
      422,
      catalog.diagnostics[0]?.code ?? "author-source-invalid",
      catalog.diagnostics[0]?.message ?? "Patched source is invalid.",
    );
  const computed = computeFrozenComponentInputs(prepared.source, catalog.value);
  if (!computed.valid)
    fail(
      422,
      computed.diagnostics[0]?.code ?? "author-lock-invalid",
      computed.diagnostics[0]?.message ?? "Patched lock is invalid.",
    );
  const lockBytes = refreshProjectLock(input.lock, {
    componentLocks: computed.value.componentLocks,
    themeHashes: computed.value.themeHashes,
    ...(prepared.styleTransform
      ? {
          styleTransform: prepared.styleTransform,
          styleSourceIdentity: prepared.styleSourceIdentity,
        }
      : {}),
  });
  const loaded = loadUnframeLock(lockBytes);
  if (!loaded.ok) fail(422, loaded.diagnostic.code, loaded.diagnostic.message);
  const assets = await input.resolveAssets();
  const carrier = createSourceAssetAssemblyCarrier(loaded.value.assemblyCarrier, assets.assets);
  const checked = checkAuthoringProjectAssembly(prepared.source, carrier, assets.bytes);
  if (!checked.valid)
    fail(
      422,
      checked.diagnostics[0]?.code ?? "author-source-invalid",
      checked.diagnostics[0]?.message ?? "Patched source is invalid.",
    );
  const afterSource = encoder.encode(patch.sourceText);
  return {
    afterSource,
    lockBytes,
    saved: {
      revision: await input.revisionFor(afterSource, lockBytes),
      sourceHash: checked.value.sourceHash,
      irHash: checked.value.definitionHash,
      commandId: input.request.commandId,
    },
  };
}
export async function saveAuthorPatch<Current, Prepared>(
  revision: string,
  request: PatchRequest,
  ports: {
    readReceipt(id: string): Promise<{ requestHash: string; saved: SavedCommand } | undefined>;
    readCurrent(): Promise<Current & { snapshot: Pick<ProjectSnapshot, "revision"> }>;
    prepare(current: Current, revision: string, request: PatchRequest): Promise<Prepared>;
    currentRevision(): Promise<string | undefined>;
    commit(current: Current, prepared: Prepared, requestHash: string): Promise<SavedCommand>;
  },
): Promise<SavedCommand> {
  const requestHash = digest(encoder.encode(JSON.stringify({ revision, request })));
  const prior = await ports.readReceipt(request.commandId);
  if (prior) {
    if (prior.requestHash !== requestHash)
      fail(409, "author-command-id-conflict", "Command ID was used for another request.");
    return prior.saved;
  }
  const current = await ports.readCurrent();
  const prepared = await ports.prepare(current, revision, request);
  if ((await ports.currentRevision()) !== current.snapshot.revision)
    fail(412, "author-revision-mismatch", "Project inputs changed during save.");
  return ports.commit(current, prepared, requestHash);
}
type AuthorStyleDiagnostic = {
  severity: "warning" | "error";
  message: string;
  file?: string | undefined;
};
const styleAuthorDiagnostics = (
  items: readonly AuthorStyleDiagnostic[],
  errorCode = "cli-style-transform-failed",
): AuthorDiagnostic[] =>
  items.map((item) => ({
    ...item,
    family: "semantic",
    code: item.severity === "warning" ? "cli-style-warning" : errorCode,
    path: item.file ? [item.file] : [],
  }));
const authorDiagnostic = (
  code: string,
  message: string,
  path?: readonly (string | number)[],
): AuthorDiagnostic => ({ code, message, ...(path ? { path: [...path] } : {}) });
const authorSourceDiagnostic = (item: {
  code: string;
  message: string;
  fileName: string;
  start: number;
  end: number;
  line: number;
  column: number;
}): AuthorDiagnostic => ({
  family:
    item.code === "compiler-source-syntax-error" ||
    item.code === "compiler-source-kind-unsupported" ||
    item.code.startsWith("compiler-static-")
      ? "syntax"
      : item.code === "compiler-source-type-error" ||
          item.code.startsWith("compiler-module-") ||
          item.code === "compiler-project-entry-invariant-invalid"
        ? "type"
        : "semantic",
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
export async function createAuthorProjectSnapshot(input: {
  revision: string;
  sourceText: string;
  files: readonly { fileName: string; sourceText: string }[];
  localFiles: Parameters<typeof verifyFrozenLocalFiles>[0];
  componentLocks: Parameters<typeof verifyFrozenLocalFiles>[1];
  carrier: Extract<ReturnType<typeof loadUnframeLock>, { ok: true }>["value"]["assemblyCarrier"];
  prepared:
    | {
        ok: true;
        source: { files: readonly { fileName: string; sourceText: string }[] };
        diagnostics: readonly AuthorStyleDiagnostic[];
      }
    | { ok: false; code: string; message: string; diagnostics: readonly AuthorStyleDiagnostic[] };
  resolveAssets(): Promise<
    | {
        ok: true;
        value: {
          assets: readonly LockedSourceAsset[];
          sourceAssetBytes: Readonly<Record<string, Uint8Array>>;
        };
      }
    | { ok: false; code: string; message: string; path: string }
  >;
}): Promise<{ snapshot: ProjectSnapshot; source?: unknown }> {
  const { prepared } = input;
  if (!prepared.ok)
    return {
      snapshot: {
        revision: input.revision,
        sourceHash: hashCanonicalJsonPayload(
          input.files.map(({ fileName, sourceText }) => [fileName, sourceText]),
        ),
        irHash: null,
        definition: null,
        instances: [],
        diagnostics: prepared.diagnostics.length
          ? styleAuthorDiagnostics(prepared.diagnostics, prepared.code)
          : [{ ...authorDiagnostic(prepared.code, prepared.message), severity: "error" }],
      },
    };
  const { source } = prepared;
  const fallbackHash = hashCanonicalJsonPayload(
    source.files.map(({ fileName, sourceText }) => [fileName, sourceText]),
  );
  const frozen = verifyFrozenLocalFiles(input.localFiles, input.componentLocks);
  const sourceAssets = await input.resolveAssets();
  const checked =
    frozen.length === 0 && sourceAssets.ok
      ? checkAuthoringProjectAssembly(
          source,
          createSourceAssetAssemblyCarrier(
            input.carrier as Extract<
              ReturnType<typeof loadUnframeLock>,
              { ok: true }
            >["value"]["assemblyCarrier"],
            sourceAssets.value.assets,
          ),
          sourceAssets.value.sourceAssetBytes,
        )
      : undefined;
  const diagnostics: AuthorDiagnostic[] = [
    ...styleAuthorDiagnostics(prepared.diagnostics),
    ...frozen.map((item) =>
      authorDiagnostic(item.code, "Source differs from its frozen lock.", [item.path]),
    ),
    ...(!sourceAssets.ok
      ? [authorDiagnostic(sourceAssets.code, sourceAssets.message, [sourceAssets.path])]
      : []),
    ...(checked && !checked.valid
      ? checked.diagnostics.map((item) =>
          "path" in item
            ? {
                ...authorDiagnostic(item.code, item.message, item.path),
                family: "semantic" as const,
              }
            : authorSourceDiagnostic(item),
        )
      : []),
  ];
  const inspected = inspectAuthorSource({
    source,
    sourceText: input.sourceText,
    semanticValid: checked?.valid === true,
  });
  diagnostics.push(...inspected.diagnostics);
  return {
    source,
    snapshot: {
      revision: input.revision,
      sourceHash: checked?.valid ? checked.value.sourceHash : fallbackHash,
      irHash: checked?.valid ? checked.value.definitionHash : null,
      definition: checked?.valid ? checked.value.definition : null,
      instances: inspected.instances,
      diagnostics,
    },
  };
}

export async function readAuthorArtifacts(
  generationId: string,
  load: () => Promise<{
    artifacts: BuildArtifacts;
    readAsset(id: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  }>,
  instanceIds: readonly string[],
  maxBytes = 256 * 1024 * 1024,
) {
  if (!/^[0-9a-f]{32}$/.test(generationId))
    fail(500, "author-output-unsafe", "Build output is not a managed generation.");
  const generation = await load();
  return collectAuthorArtifacts(generation.artifacts, generation.readAsset, instanceIds, maxBytes);
}
export async function collectAuthorArtifacts(
  artifacts: BuildArtifacts,
  readAsset: (id: string) => Promise<{ bytes: Uint8Array; mediaType: string }>,
  instanceIds: readonly string[],
  maxBytes = 256 * 1024 * 1024,
) {
  const bundle = artifacts.renderBundle;
  const assetSet = artifacts.assetSet;
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
            assets.set(assetId, await readAsset(assetId));
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
}
export const createAuthorService = async (
  ports: AuthorServicePorts,
  options: AuthorServiceOptions = {},
): Promise<AuthorService> => {
  await ports.initialize();
  let closed = false;
  const withSource: AuthorServicePorts["withSource"] = (callback, recovery, timeout, signal) => {
    if (closed) fail(409, "author-service-closed", "Author host is closed.");
    return ports.withSource(
      async () => {
        if (closed) fail(409, "author-service-closed", "Author host is closed.");
        return callback();
      },
      recovery,
      timeout,
      signal,
    );
  };
  const builds = createAuthorBuildService({ ...ports, withSource, fail }, options);
  return {
    project: () => withSource(ports.project, false, 5000),
    patch: (revision, request) =>
      withSource(
        async () => {
          const saved = await ports.patch(revision, request);
          builds.invalidate();
          return saved;
        },
        true,
        0,
      ),
    build: builds.build,
    job: builds.job,
    cancel: builds.cancel,
    artifact: builds.artifact,
    close: async () => {
      closed = true;
      await builds.close();
    },
  };
};

export type AuthorSourceInspection = {
  catalog: CheckAuthoringProjectResult;
  instances: AuthorInstance[];
  diagnostics: AuthorDiagnostic[];
};
export function inspectAuthorSource(input: {
  source: unknown;
  sourceText: string;
  semanticValid: boolean;
}): AuthorSourceInspection {
  const catalog = checkAuthoringProject(input.source);
  const diagnostics: AuthorDiagnostic[] = !catalog.valid
    ? catalog.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        family:
          item.code === "compiler-source-syntax-error" ||
          item.code === "compiler-source-kind-unsupported" ||
          item.code.startsWith("compiler-static-")
            ? "syntax"
            : item.code === "compiler-source-type-error" ||
                item.code.startsWith("compiler-module-") ||
                item.code === "compiler-project-entry-invariant-invalid"
              ? "type"
              : "semantic",
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
      }))
    : [];
  const editable =
    catalog.valid && input.semanticValid
      ? readEditableReactScene(catalog.value, input.sourceText)
      : undefined;
  if (editable && !editable.ok)
    diagnostics.push(
      ...editable.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        path: item.instanceId ? [item.instanceId] : [],
      })),
    );
  const instances = editable?.ok
    ? editable.value.map((item) => ({
        instanceId: item.instanceId,
        surfaceId: surfaceIdFor(item.instanceId),
        props: Object.fromEntries(
          Object.entries(item.props).map(([id, prop]) => [
            id,
            {
              type: prop.kind,
              value: prop.value,
              editable: prop.editable,
              inherited: prop.inherited,
              ...(prop.editor ? { editor: prop.editor } : {}),
              ...(prop.inheritanceExpression
                ? { inheritanceExpression: prop.inheritanceExpression }
                : {}),
            },
          ]),
        ),
        transform: {
          position: [...item.transform.position] as [number, number, number],
          rotation: [...item.transform.rotation] as [number, number, number, number],
          scale: [...item.transform.scale] as [number, number, number],
        },
        transformEditable: item.transformEditable,
        transformInherited: item.transformInherited,
        ...(item.transformInheritanceExpression
          ? { transformInheritanceExpression: item.transformInheritanceExpression }
          : {}),
      }))
    : [];
  return { catalog, instances, diagnostics };
}
export const surfaceIdFor = (instanceId: string) =>
  "r:" + digest(encoder.encode(JSON.stringify(["react-component-v1", "surface", instanceId, ""])));
