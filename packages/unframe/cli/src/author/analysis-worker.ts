import { encodeAnalysisMessage, decodeAnalysisMessage } from "./analysis-ipc.js";
import { createAuthoringProjectChecker } from "@unframe-dev/source";

import { createAuthorProjectSnapshot, prepareAuthorSave } from "@unframe-dev/author-service";
import {
  prepareProjectInputs,
  assembleAuthoringProject,
  prepareOpaquePrograms,
  type StylePreparationPort,
} from "@unframe-dev/build";
import {
  createProjectRevision,
  identifyNodeTransformSnapshot,
  mediaTypeFor,
} from "@unframe-dev/workspace";
import type { AnalysisRequest, AnalysisInputs } from "./analysis-protocol.js";

if (!process.send) throw new Error("Analysis process requires an IPC channel.");
const channel = {
  postMessage: (message: unknown) => process.send!(encodeAnalysisMessage(message)),
  on: (
    _event: "message",
    callback: (message: { kind: string; id: number; value?: unknown; error?: string }) => void,
  ) =>
    process.on("message", (message) =>
      callback(
        decodeAnalysisMessage(message as Parameters<typeof decodeAnalysisMessage>[0]) as Parameters<
          typeof callback
        >[0],
      ),
    ),
};
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
const call = (
  method: "styles" | "video" | "bundle" | "styleSnapshot",
  args: unknown[],
): Promise<unknown> => {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    channel.postMessage({ kind: "call", id, method, args });
  });
};
const started = performance.now();
const profile = (stage: string) => {
  const memory = process.memoryUsage();
  channel.postMessage({
    kind: "profile",
    stage,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    elapsedMilliseconds: performance.now() - started,
  });
};
const checkSource = createAuthoringProjectChecker((stage) => profile(`source-${stage}`));
const styles: StylePreparationPort = {
  snapshot: async (_directory, files) =>
    (await call("styleSnapshot", [files])) as Awaited<ReturnType<StylePreparationPort["snapshot"]>>,
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
const prepare = async (input: AnalysisInputs, replacement?: string) => {
  const found =
    replacement === undefined
      ? input.found
      : {
          ...input.found,
          files: input.found.files.map((file) =>
            file.fileName === input.found.entryFile ? { ...file, sourceText: replacement } : file,
          ),
          localFiles: input.found.localFiles.map((file) =>
            file.path === input.found.entryFile
              ? { ...file, bytes: new TextEncoder().encode(replacement) }
              : file,
          ),
        };
  profile("prepare-start");
  const result = await prepareProjectInputs(
    { found, graph: input.found.dependencyGraph },
    {
      styles,
      checkSource,
      readTypeLibraries: async () => input.typeLibraries,
      modelTransformIdentity: input.modelTransformIdentity,
      videoTransformIdentity,
    },
  );
  profile("prepare-complete");
  return result;
};
const requirePrepared = async (input: AnalysisInputs, replacement?: string) => {
  const result = await prepare(input, replacement);
  if (!result.ok)
    throw Object.assign(new Error(result.message), { status: 422, code: result.code });
  return result.value;
};

const execute = async (request: AnalysisRequest) => {
  if (request.operation === "prepare") return prepare(request.input);
  if (request.operation === "opaque") {
    return prepareOpaquePrograms(
      request.input.source,
      request.input.carrier,
      request.input.sourceAssetBytes,
      {
        mediaTypeFor,
        bundle: async (input) =>
          (await call("bundle", [input])) as Awaited<
            ReturnType<import("@unframe-dev/build").OpaqueBundlePort["bundle"]>
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
  const input = request.input;
  const sourceText = input.found.files.find(
    (file) => file.fileName === input.found.entryFile,
  )?.sourceText;
  if (sourceText === undefined) throw new Error("Captured project entry is missing.");
  if (request.operation === "project") {
    const result = await prepare(input);
    if (!result.ok && !("prepared" in result))
      return {
        snapshot: (
          await createAuthorProjectSnapshot({
            checkSource,
            revision: input.found.revision,
            sourceText,
            files: input.found.files,
            localFiles: input.found.localFiles,
            componentLocks: [],
            carrier: { componentLocks: [], themeHashes: [], assets: {} },
            prepared: {
              ok: false,
              code: result.code,
              message: result.message,
              diagnostics: "diagnostics" in result ? result.diagnostics : [],
            },
            resolveAssets: async () => {
              throw new Error("Failed inputs cannot resolve assets.");
            },
          })
        ).snapshot,
      };
    const prepared = result.ok
      ? result.value
      : {
          ...result.prepared,
          assemblyCarrier:
            "assemblyCarrier" in result
              ? result.assemblyCarrier
              : { componentLocks: [], themeHashes: [], assets: {} },
          assets: "assets" in result ? result.assets : [],
          sourceAssetBytes: "sourceAssetBytes" in result ? result.sourceAssetBytes : {},
        };
    return {
      snapshot: (
        await createAuthorProjectSnapshot({
          checkSource,
          revision: input.found.revision,
          sourceText,
          files: input.found.files,
          localFiles: input.found.localFiles,
          componentLocks: prepared.assemblyCarrier.componentLocks,
          carrier: prepared.assemblyCarrier,
          prepared: { ok: true, source: prepared.source, diagnostics: prepared.diagnostics },
          resolveAssets: async () => ({
            ok: true,
            value: {
              assets: prepared.assets,
              sourceAssetBytes: prepared.sourceAssetBytes,
            },
          }),
        })
      ).snapshot,
      ...(result.ok ? { preparedInputs: result.value } : {}),
    };
  }
  const prepared = await requirePrepared(input);
  return prepareAuthorSave({
    source: prepared.source,
    sourceText,
    entryFile: input.found.entryFile,
    snapshot: request.input.snapshot,
    revision: request.input.revision,
    request: request.input.request,
    prepareSource: (text) => requirePrepared(input, text),
    revisionFor: async (source) =>
      createProjectRevision({
        configBytes: input.found.configBytes,
        dependencyHash: input.found.dependencyHash,
        localFiles: input.found.localFiles,
        entryReplacement: { path: input.found.entryFile, bytes: source },
      }),
  });
};
process.once("message", (message) => {
  const request = decodeAnalysisMessage(
    message as Parameters<typeof decodeAnalysisMessage>[0],
  ) as AnalysisRequest & { kind: string };
  if (request.kind !== "request") throw new Error("Analysis process requires an initial request.");
  profile("input-received");
  void execute(request).then(
    (value) => {
      profile("result");
      channel.postMessage({ kind: "result", value });
    },
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
});
