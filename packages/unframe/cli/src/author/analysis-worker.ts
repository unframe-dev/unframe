import { parentPort, workerData } from "node:worker_threads";
import { createAuthorProjectSnapshot, prepareAuthorSave } from "@unframe/author-service";
import {
  prepareProjectSource,
  prepareLockRefresh,
  assembleAuthoringProject,
  prepareOpaquePrograms,
  StylePreparationError,
  type StylePreparationPort,
} from "@unframe/build";
import {
  loadUnframeLock,
  lockSourceAssets,
  createProjectRevision,
  identifyNodeTransformSnapshot,
  mediaTypeFor,
} from "@unframe/workspace";
import type { AnalysisRequest, AnalysisInputs } from "./analysis-protocol.js";

if (!parentPort) throw new Error("Analysis worker requires a parent channel.");
const channel = parentPort;
let nextId = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
channel.on("message", (message: { kind: string; id: number; value?: unknown; error?: string }) => {
  if (message.kind !== "reply") return;
  const waiter = pending.get(message.id);
  if (!waiter) throw new Error("Unknown analysis callback response.");
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error));
  else waiter.resolve(message.value);
});
const call = (method: "styles" | "video" | "bundle", args: unknown[]): Promise<unknown> => {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    channel.postMessage({ kind: "call", id, method, args });
  });
};
const styles: StylePreparationPort = {
  snapshot: async () => {
    throw new Error("Analysis may only use captured style inputs.");
  },
  withSources: (snapshot, files) => {
    const { identity: _identity, sourceIdentity: _sourceIdentity, ...value } = snapshot;
    return identifyNodeTransformSnapshot({ ...value, sourceFiles: [...files] });
  },
  compile: async (snapshot, entries) =>
    (await call("styles", [snapshot, entries])) as Awaited<
      ReturnType<StylePreparationPort["compile"]>
    >,
};
const videoTransformIdentity = async () => (await call("video", [])) as `sha256:${string}`;
const loaded = (input: AnalysisInputs) => {
  const result = loadUnframeLock(input.found.lockBytes);
  if (!result.ok)
    throw Object.assign(new Error(result.diagnostic.message), {
      status: 422,
      code: result.diagnostic.code,
    });
  return result.value;
};
const assets = async (input: AnalysisInputs) => {
  try {
    return lockSourceAssets(
      { modelTransformIdentity: input.modelTransformIdentity },
      input.found.assetSources,
      input.found.localFiles,
      Object.values(input.found.assetSources).some((asset) => asset.mediaType === "video/mp4")
        ? await videoTransformIdentity()
        : undefined,
    );
  } catch {
    return {
      ok: false as const,
      code: "cli-source-asset-transform-unavailable",
      path: "unframe.config.ts",
      message: "Source Assets differ from the frozen lock. Refresh the lock explicitly.",
    };
  }
};
const prepare = (
  input: AnalysisInputs,
  lock: ReturnType<typeof loaded>["lock"],
  replacement?: string,
) =>
  prepareProjectSource(
    input.found,
    lock,
    { refresh: true, ...(replacement !== undefined ? { replacement } : {}) },
    { styles, typeLibraries: input.typeLibraries },
  );

const execute = async (request: AnalysisRequest) => {
  if (request.operation === "opaque") {
    return prepareOpaquePrograms(
      request.input.source,
      request.input.carrier,
      request.input.sourceAssetBytes,
      {
        mediaTypeFor,
        bundle: async (input) =>
          (await call("bundle", [input])) as Awaited<
            ReturnType<import("@unframe/build").OpaqueBundlePort["bundle"]>
          >,
      },
    );
  }
  if (request.operation === "assemble") {
    const result = assembleAuthoringProject(
      request.input.source,
      request.input.carrier,
      request.input.sourceAssetBytes,
    );
    if (!result.valid) return result;
    return { valid: true, value: { project: result.value.project }, diagnostics: [] };
  }
  if (request.operation === "refresh")
    return prepareLockRefresh(
      { found: request.input.found },
      {
        styles,
        readTypeLibraries: async () => request.input.typeLibraries,
        modelTransformIdentity: request.input.modelTransformIdentity,
        videoTransformIdentity,
      },
    );
  const input = request.input;
  const graph = loaded(input);
  const sourceText = input.found.files.find(
    (file) => file.fileName === input.found.entryFile,
  )?.sourceText;
  if (sourceText === undefined) throw new Error("Captured project entry is missing.");
  if (request.operation === "project") {
    let prepared: Parameters<typeof createAuthorProjectSnapshot>[0]["prepared"];
    try {
      prepared = { ok: true, ...(await prepare(input, graph.lock)) };
    } catch (error) {
      if (!(error instanceof StylePreparationError)) throw error;
      prepared = {
        ok: false,
        code: error.code,
        message: error.message,
        diagnostics: error.diagnostics,
      };
    }
    return (
      await createAuthorProjectSnapshot({
        revision: input.found.revision,
        sourceText,
        files: input.found.files,
        localFiles: input.found.localFiles,
        componentLocks: graph.assemblyCarrier.componentLocks,
        carrier: graph.assemblyCarrier,
        prepared,
        resolveAssets: () => assets(input),
      })
    ).snapshot;
  }
  const prepared = await prepare(input, graph.lock);
  return prepareAuthorSave({
    source: prepared.source,
    sourceText,
    entryFile: input.found.entryFile,
    snapshot: request.input.snapshot,
    revision: request.input.revision,
    request: request.input.request,
    lock: graph.lock,
    prepareSource: async (text) => {
      const result = await prepare(input, graph.lock, text);
      return {
        source: result.source,
        ...(result.styleTransform ? { styleTransform: result.styleTransform } : {}),
        ...(result.styleSourceIdentity ? { styleSourceIdentity: result.styleSourceIdentity } : {}),
      };
    },
    resolveAssets: async () => {
      const result = await assets(input);
      if (!result.ok)
        throw Object.assign(new Error(result.message), { status: 422, code: result.code });
      return { assets: result.value.assets, bytes: result.value.sourceAssetBytes };
    },
    revisionFor: async (source, lock) =>
      createProjectRevision({
        configBytes: input.found.configBytes,
        lockBytes: lock,
        localFiles: input.found.localFiles,
        entryReplacement: { path: input.found.entryFile, bytes: source },
      }),
  });
};
void execute(workerData as AnalysisRequest).then(
  (value) => channel.postMessage({ kind: "result", value }),
  (error: unknown) =>
    channel.postMessage({
      kind: "error",
      error: {
        message: error instanceof Error ? error.message : "Analysis worker failed.",
        ...(error instanceof Error ? { name: error.name } : {}),
        ...(error && typeof error === "object" && "diagnostics" in error
          ? { diagnostics: error.diagnostics }
          : {}),
        ...(error && typeof error === "object"
          ? {
              ...("status" in error ? { status: error.status } : {}),
              ...("code" in error ? { code: error.code } : {}),
            }
          : {}),
      },
    }),
);
