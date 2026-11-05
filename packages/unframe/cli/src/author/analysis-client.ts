import { bundleOpaqueRenderer } from "@unframe-dev/render-browser";
import { OpaquePreparationFailure } from "@unframe-dev/build";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import { AuthorError } from "@unframe-dev/author-service";
import { projectSnapshotSchema, savedCommandSchema } from "@unframe-dev/contracts/author-http";
import { validateNodeTransformSnapshot } from "@unframe-dev/workspace";
import { readInstalledDependencyInputs } from "@unframe-dev/workspace-node";
import { sourceAssetPorts } from "../application/media-ports.js";
import type { StylePreparationPort } from "@unframe-dev/build";
import type { AnalysisOperations, CapturedProject } from "./analysis-protocol.js";

const diagnostic = z.strictObject({
  code: z.string(),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number().finite()])),
  relatedPath: z.array(z.union([z.string(), z.number().finite()])).optional(),
});
const sourceDiagnostic = z.strictObject({
  code: z.string(),
  message: z.string(),
  fileName: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  line: z.number().int(),
  column: z.number().int(),
  typescriptCode: z.number().int().optional(),
});
const results = {
  prepare: z.union([
    z.strictObject({ ok: z.literal(true), value: z.unknown() }),
    z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).passthrough(),
  ]),
  project: z.strictObject({
    snapshot: projectSnapshotSchema,
    preparedInputs: z.unknown().optional(),
  }),
  save: z.strictObject({
    afterSource: z.instanceof(Uint8Array),
    saved: savedCommandSchema,
  }),
  opaque: z.array(
    z.strictObject({
      entryId: z.string(),
      moduleHash: z.string(),
      javascript: z.string(),
      stylesheets: z.array(z.string()),
      assets: z.array(
        z.strictObject({ path: z.string(), mediaType: z.string(), dataBase64: z.string() }),
      ),
      props: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])),
      stateKeysById: z.record(z.string(), z.string()).optional(),
      debugSourceMap: z.string().optional(),
      debugSourcePaths: z.array(z.string()).optional(),
      debugLocalSourceFiles: z.record(z.string(), z.string()).optional(),
      entryOrigins: z
        .array(
          z.strictObject({
            startLine: z.number(),
            endLine: z.number(),
            firstLinePrefix: z.number(),
            origin: z.strictObject({
              fileName: z.string(),
              start: z.number(),
              end: z.number(),
              line: z.number(),
              column: z.number(),
            }),
          }),
        )
        .optional(),
    }),
  ),
  assemble: z.union([
    z.strictObject({
      valid: z.literal(true),
      value: z.strictObject({ project: z.unknown() }),
      diagnostics: z.tuple([]),
    }),
    z.strictObject({
      valid: z.literal(false),
      phase: z.literal("source"),
      diagnostics: z.array(sourceDiagnostic),
    }),
    z.strictObject({
      valid: z.literal(false),
      phase: z.enum(["assembly", "compile"]),
      diagnostics: z.array(diagnostic),
    }),
  ]),
};
const messageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("result"), value: z.unknown() }),
  z.strictObject({
    kind: z.literal("error"),
    error: z.strictObject({
      message: z.string(),
      name: z.string().optional(),
      diagnostics: z
        .array(
          z
            .object({
              code: z.string(),
              message: z.string(),
              path: z.array(z.union([z.string(), z.number().finite()])),
              relatedPath: z.array(z.union([z.string(), z.number().finite()])).optional(),
            })
            .strict(),
        )
        .optional(),
      code: z.string().optional(),
      status: z.number().int().min(400).max(599).optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("call"),
    id: z.number().int().positive(),
    method: z.enum(["styles", "video", "bundle", "styleSnapshot"]),
    args: z.array(z.unknown()),
  }),
]);

type Ports = Pick<typeof sourceAssetPorts, "videoTransformIdentity"> & {
  styles: StylePreparationPort;
};
const requireCapturedDependencies = async (found: CapturedProject) => {
  try {
    const current = await readInstalledDependencyInputs(found.projectDirectory);
    if (current.dependencyHash === found.dependencyHash) return;
  } catch {
    // A partial installation cannot be combined with the previously captured graph.
  }
  throw new AuthorError(
    409,
    "cli-output-stale",
    "Installed dependencies changed while capturing style inputs. Retry the operation.",
  );
};
export const runAnalysisOperation = async <K extends keyof AnalysisOperations>(
  operation: K,
  input: AnalysisOperations[K]["input"],
  signal?: AbortSignal,
  ports: Ports = sourceAssetPorts,
): Promise<AnalysisOperations[K]["output"]> => {
  if (signal?.aborted)
    throw new AuthorError(409, "cli-cancelled", "Project analysis was cancelled.");
  const worker = new Worker(
    new URL("../analysis/worker.mjs", import.meta.resolve("@unframe-dev/cli/template")),
    { workerData: { operation, input } },
  );
  const controller = new AbortController();
  const active = new Set<Promise<unknown>>();
  let settled = false;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      controller.abort();
      await Promise.allSettled(active);
      await worker.terminate();
    })());
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown, value?: AnalysisOperations[K]["output"]) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      void close().then(() => (error ? reject(error) : resolve(value!)), reject);
    };
    const abort = () =>
      finish(new AuthorError(409, "cli-cancelled", "Project analysis was cancelled."));
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("error", (error) => finish(error));
    worker.on("exit", (code) => {
      if (!settled)
        finish(new Error(`Analysis worker exited before returning a result (${code}).`));
    });
    worker.on("message", (raw: unknown) => {
      if (settled) return;
      try {
        const message = messageSchema.parse(raw);
        if (message.kind === "result") {
          finish(
            undefined,
            results[operation].parse(message.value) as AnalysisOperations[K]["output"],
          );
        } else if (message.kind === "error") {
          const error = message.error;
          finish(
            error.name === "OpaquePreparationFailure" && error.diagnostics
              ? new OpaquePreparationFailure(error.diagnostics)
              : error.status && error.code
                ? new AuthorError(error.status, error.code, error.message)
                : new Error(error.message),
          );
        } else {
          const task = (async () => {
            if (message.method === "styleSnapshot") {
              if (operation !== "prepare" && operation !== "project" && operation !== "save")
                throw new Error("Style snapshots require a project analysis operation.");
              const [files] = z
                .tuple([
                  z.array(
                    z.strictObject({
                      path: z.string(),
                      bytes: z.string(),
                      executable: z.boolean().optional(),
                    }),
                  ),
                ])
                .parse(message.args);
              const { found } = input as AnalysisOperations["project"]["input"];
              await requireCapturedDependencies(found);
              const snapshot = await ports.styles.snapshot(found.projectDirectory, files);
              await requireCapturedDependencies(found);
              return snapshot;
            }
            if (message.method === "video") {
              z.tuple([]).parse(message.args);
              return ports.videoTransformIdentity(controller.signal);
            }
            if (message.method === "bundle") {
              const [input] = z.tuple([z.unknown()]).parse(message.args);
              return bundleOpaqueRenderer(input);
            }
            const [snapshot, entries] = z
              .tuple([z.unknown(), z.array(z.string())])
              .parse(message.args);
            return ports.styles.compile(
              validateNodeTransformSnapshot(snapshot),
              entries,
              controller.signal,
            );
          })();
          active.add(task);
          void task
            .then(
              (value) => {
                if (!settled) worker.postMessage({ kind: "reply", id: message.id, value });
              },
              (error: unknown) => {
                if (error instanceof AuthorError && error.code === "cli-output-stale") {
                  finish(error);
                  return;
                }
                if (!settled)
                  worker.postMessage({
                    kind: "reply",
                    id: message.id,
                    error: error instanceof Error ? error.message : "Analysis callback failed.",
                  });
              },
            )
            .catch((error: unknown) => finish(error))
            .finally(() => active.delete(task));
        }
      } catch (error) {
        finish(error);
      }
    });
    if (signal?.aborted) abort();
  });
};
