import type { AnalysisOperations } from "../author/analysis-protocol.js";
import { runAnalysisOperation } from "../author/analysis-client.js";
import { AuthorError } from "@unframe-dev/author-service";
import { buildMediaPorts, sourceAssetPorts } from "./media-ports.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readExpectedBuildGeneration, publishProjectBuild } from "@unframe-dev/workspace-node";
import { createBuildJob } from "@unframe-dev/build";
import {
  compileCheckedDeclarationProject,
  checkDeclarationProject,
  type CompilerDeclarationProject,
} from "@unframe-dev/build";
import type { CompiledDeclarationProject } from "@unframe-dev/build";
import type { AuthoringProjectDiagnostic } from "@unframe-dev/source";
import { readTypeLibraries } from "@unframe-dev/workspace-node";
import { styleDiagnostics } from "./style-diagnostics.js";
import { type CompilerWarning } from "@unframe-dev/compiler";
import { type AuthoringProjectPipelineResult } from "@unframe-dev/build";
import { hashCanonicalJsonPayload } from "@unframe-dev/artifacts";
import { hashSourceTypeLibraries } from "@unframe-dev/source";
import {
  createBakedWebRenderer,
  combineBakedWebRenderers,
  createWebRendererConfigHash,
  openPlaywrightFixedBrowser,
  type FixedBrowserSession,
} from "@unframe-dev/render-browser";

import { prepareOpaqueRenderer } from "./opaque-renderer.js";
import { OpaquePreparationFailure } from "@unframe-dev/build";
import { createFilesystemBuildCache } from "@unframe-dev/workspace-node";
import { acquireBuildLock, type BuildLock } from "@unframe-dev/workspace-node";
import { discoverPresentationProjectFiles } from "@unframe-dev/workspace-node";
import { createVideoValidator } from "@unframe-dev/media-node";
import { initPresentationProject } from "@unframe-dev/workspace-node";
import type {
  PresentationCliDiagnostic,
  PresentationCliExitCode,
  PresentationCliHost,
  PresentationCliResult,
} from "./types.js";
import { sourceDiagnosticFamily } from "./source-diagnostic-family.js";

type Command = Readonly<{
  command: "check" | "build" | "test" | "init";
  directory: string;
  format: "text" | "json";
}>;
class BrowserProvisionFailure extends Error {}
class BrowserCleanupFailure extends Error {}
const encoder = new TextEncoder();
const fixedContext = Object.freeze({
  compiler: Object.freeze({
    name: "unframe",
    version: "1",
    baseEnvironmentHash: hashCanonicalJsonPayload({
      browser: "playwright-chromium-fixed",
      fontProfile: "explicit-font-assets",
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
      toolchain: "unframe-presentation-v2",
    }),
  }),
  locale: "ja-JP" as const,
  timezone: "Asia/Tokyo" as const,
  colorScheme: "light" as const,
  webRendererConfig: Object.freeze({}),
});
const limits = Object.freeze({
  maxWidth: 4096,
  maxHeight: 4096,
  maxPixels: 16_777_216,
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 65 * 1024 * 1024,
});
const usage =
  "Usage: unframe init|check|build|test <project-directory> [--format text|json]\n       unframe dev|author <project-directory>\n       unframe preview <dist-directory>\n       unframe publish <dist-directory> <presentation-id> <control-plane-origin>";
const rendererDiagnosticCodes = new Set([
  "unsupported-structured-tree",
  "invalid-render-scale",
  "text-outside-render-surface",
  "invalid-render-geometry",
  "renderer-not-invoked",
  "invalid-browser-environment",
  "invalid-renderer-config",
  "renderer-config-hash-mismatch",
  "browser-environment-context-mismatch",
  "unsupported-state-visual-variation",
  "renderer-invalid-input",
  "browser-capture-failed",
  "invalid-browser-capture",
  "support-build-mismatch",
  "invalid-font-asset",
  "missing-font-asset",
  "font-asset-checksum-mismatch",
  "font-asset-signature-mismatch",
  "font-glyph-missing",
  "text-max-code-points-exceeded",
]);

const safeRecord = (value: unknown): Record<string, unknown> | undefined => {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length
    )
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((d) => d.get || d.set || !d.enumerable)) return undefined;
    return Object.fromEntries(Object.entries(descriptors).map(([k, d]) => [k, d.value]));
  } catch {
    return undefined;
  }
};
const safeStrings = (value: unknown): readonly string[] | undefined => {
  try {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length) return undefined;
    const d = Object.getOwnPropertyDescriptors(value);
    const n = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(n) || n < 0 || Object.keys(d).length !== n + 1) return undefined;
    const values = Array.from({ length: n }, (_, i) => d[String(i)]);
    return values.every((x) => x && !x.get && !x.set && typeof x.value === "string")
      ? values.map((x) => x!.value as string)
      : undefined;
  } catch {
    return undefined;
  }
};
const diagnostic = (
  family: PresentationCliDiagnostic["family"],
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
): PresentationCliDiagnostic => ({ family, code, message, path });
const pathText = (path: readonly (string | number)[]) =>
  path.length ? `$/` + path.map(String).join("/") : "$";
const ordered = <T extends PresentationCliDiagnostic>(items: readonly T[]) =>
  [...items].sort((a, b) => {
    const left = `${pathText(a.path)}\0${a.family}\0${a.code}\0${a.message}`;
    const right = `${pathText(b.path)}\0${b.family}\0${b.code}\0${b.message}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
const output = (
  exitCode: PresentationCliExitCode,
  command: Command["command"] | undefined,
  format: Command["format"],
  diagnostics: readonly PresentationCliDiagnostic[] = [],
  warnings: readonly (CompilerWarning | PresentationCliDiagnostic)[] = [],
  build?: Readonly<{ sourceRevision: string; generationId: string }>,
): PresentationCliResult => {
  const list = ordered(diagnostics);
  const warningList = ordered(
    warnings.map((warning) => ({ ...warning, family: "semantic" as const })),
  );
  if (exitCode === 0)
    return {
      exitCode,
      stdout:
        format === "json"
          ? `${JSON.stringify({ ok: true, command, diagnostics: [], warnings: warningList, ...build })}\n`
          : `${command}: ok\n`,
      stderr:
        format === "text" && warningList.length
          ? warningList
              .map((warning) => {
                if (!("componentInstanceId" in warning))
                  return `${pathText(warning.path)}: warning/${warning.family}/${warning.code}: ${warning.message}`;
                const subject =
                  "propName" in warning
                    ? `prop=${JSON.stringify(warning.propName)}`
                    : `variant=${JSON.stringify(warning.variantName)}`;
                return [
                  `${pathText(warning.path)}: warning/${warning.family}/${warning.code}: ${warning.message}`,
                  `instance=${JSON.stringify(warning.componentInstanceId)}`,
                  subject,
                  `default=${JSON.stringify(warning.defaultValue)}`,
                ].join(" ");
              })
              .join("\n") + "\n"
          : "",
      ...build,
    };
  const stderr =
    format === "json"
      ? `${JSON.stringify({ ok: false, command: command ?? null, diagnostics: list })}\n`
      : list
          .map((d) => {
            const where = d.location
              ? `${d.location.fileName}:${d.location.line}:${d.location.column}`
              : pathText(d.path);
            return `${where}: ${d.family}/${d.code}: ${d.message}`;
          })
          .join("\n") + "\n";
  return { exitCode, stdout: "", stderr };
};
const parse = (
  raw: unknown,
):
  | { ok: true; value: Command }
  | {
      ok: false;
      command?: Command["command"];
      format: Command["format"];
      diagnostics: readonly PresentationCliDiagnostic[];
    } => {
  const args = safeStrings(raw);
  if (!args)
    return {
      ok: false,
      format: "text",
      diagnostics: [
        diagnostic("usage", "cli-invalid-arguments", "Arguments must be a dense string array."),
      ],
    };
  const command =
    args[0] === "check" || args[0] === "build" || args[0] === "test" || args[0] === "init"
      ? args[0]
      : undefined;
  const at = args.indexOf("--format");
  const format = at >= 0 && args[at + 1] === "json" ? "json" : "text";
  const positional = at < 0 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  if (
    !command ||
    (at >= 0 && (at !== args.length - 2 || !["text", "json"].includes(args[at + 1] ?? ""))) ||
    positional.length !== 2 ||
    !positional[1] ||
    positional[1].startsWith("-")
  )
    return command
      ? {
          ok: false,
          command,
          format,
          diagnostics: [diagnostic("usage", "cli-invalid-usage", usage)],
        }
      : { ok: false, format, diagnostics: [diagnostic("usage", "cli-invalid-usage", usage)] };
  return { ok: true, value: { command, directory: resolve(positional[1]), format } };
};
const compilerDiagnostics = (
  result: Exclude<AuthoringProjectPipelineResult<unknown>, { valid: true }>,
): readonly PresentationCliDiagnostic[] =>
  result.diagnostics.map((item) => {
    if (result.phase === "source") {
      const source = item as AuthoringProjectDiagnostic;
      return {
        ...diagnostic(
          sourceDiagnosticFamily(source.code),
          source.code,
          source.message,
          source.fileName ? [source.fileName] : [],
        ),
        ...(source.fileName
          ? {
              location: {
                fileName: source.fileName,
                start: source.start,
                end: source.end,
                line: source.line,
                column: source.column,
              },
            }
          : {}),
      };
    }
    const domain = item as { code: string; message: string; path: readonly (string | number)[] };
    const rendererCode =
      domain.code.startsWith("compiler-renderer-") ||
      domain.code.startsWith("opaque-") ||
      rendererDiagnosticCodes.has(domain.code);
    if (
      result.phase === "compile" &&
      rendererCode &&
      domain.path.length === 5 &&
      typeof domain.path[0] === "string" &&
      domain.path.slice(1).every((part) => typeof part === "number")
    ) {
      const [fileName, start, end, line, column] = domain.path as [
        string,
        number,
        number,
        number,
        number,
      ];
      return {
        ...diagnostic("renderer", domain.code, domain.message, [fileName]),
        location: { fileName, start, end, line, column },
      };
    }
    return diagnostic(
      result.phase === "compile" && rendererCode ? "renderer" : "semantic",
      domain.code,
      domain.message,
      domain.path,
    );
  });
const artifacts = (compiled: CompiledDeclarationProject) =>
  Object.freeze({
    definition: encoder.encode(compiled.definitionJson),
    renderBundle: encoder.encode(compiled.renderBundleJson),
    assetSet: encoder.encode(compiled.assetSetJson),
    buildManifest: encoder.encode(compiled.buildManifestJson),
    assets: Object.entries(compiled.assets)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([assetId, bytes]) =>
        Object.freeze({
          assetId,
          mediaType: compiled.assetSet.assets[assetId]!.mediaType,
          bytes: new Uint8Array(bytes),
        }),
      ),
  });
const closeSession = async (session: Pick<FixedBrowserSession, "close">) => {
  try {
    const close = session.close;
    if (typeof close !== "function") throw new Error("invalid close");
    await Promise.resolve(Reflect.apply(close, session, []));
  } catch {
    throw new BrowserCleanupFailure();
  }
};

export const runPresentationCli = async (input: unknown): Promise<PresentationCliResult> => {
  const record = safeRecord(input);
  if (!record)
    return output(2, undefined, "text", [
      diagnostic("usage", "cli-invalid-input", "CLI input is invalid."),
    ]);
  const parsed = parse(record.args);
  if (!parsed.ok) return output(2, parsed.command, parsed.format, parsed.diagnostics);
  const { command, directory, format } = parsed.value;
  const hostRecord = record.host === undefined ? {} : safeRecord(record.host);
  if (!hostRecord)
    return output(2, command, format, [
      diagnostic("usage", "cli-invalid-host", "CLI host is invalid."),
    ]);
  const host = hostRecord as PresentationCliHost;
  if (host.channel !== undefined && host.channel !== "dev" && host.channel !== "dist")
    return output(2, command, format, [
      diagnostic("usage", "cli-invalid-host", "CLI output channel is invalid."),
    ]);
  if (host.signal?.aborted)
    return output(130, command, format, [
      diagnostic("cancel", "cli-cancelled", "Build was cancelled."),
    ]);
  if (command === "init") {
    const result = await initPresentationProject(
      directory,
      dirname(fileURLToPath(import.meta.resolve("@unframe-dev/cli/template"))),
    );
    return result.ok
      ? output(0, command, format)
      : output(3, command, format, [
          diagnostic("io", result.code, "Project could not be initialized at this path."),
        ]);
  }
  const sourceWait = {
    // Editor inspections can outlive a fixed lease timeout; the job signal owns cancellation.
    waitTimeoutMs: host.channel ? (host.signal ? Number.POSITIVE_INFINITY : 5000) : 0,
    ...(host.signal ? { signal: host.signal } : {}),
  };
  const expectedRevision = host.expectedRevision;
  const discovered = await discoverPresentationProjectFiles(directory, sourceWait);
  if (!discovered.ok)
    return output(
      discovered.code === "cli-cancelled" ? 130 : discovered.code === "cli-config-invalid" ? 1 : 3,
      command,
      format,
      [
        diagnostic(
          discovered.code === "cli-cancelled"
            ? "cancel"
            : discovered.code === "cli-config-invalid"
              ? "syntax"
              : "io",
          discovered.code,
          discovered.message,
          [directory],
        ),
      ],
    );
  if (expectedRevision !== undefined && discovered.revision !== expectedRevision)
    return output(3, command, format, [
      diagnostic("io", "cli-output-stale", "Project inputs changed after the build was requested."),
    ]);
  let preparedInputs: AnalysisOperations["prepare"]["output"];
  try {
    preparedInputs = await runAnalysisOperation(
      "prepare",
      {
        found: discovered,
        typeLibraries: await readTypeLibraries(),
        modelTransformIdentity: sourceAssetPorts.modelTransformIdentity,
      },
      host.signal,
    );
  } catch (error) {
    const stale = error instanceof AuthorError && error.code === "cli-output-stale";
    return output(host.signal?.aborted ? 130 : 3, command, format, [
      diagnostic(
        host.signal?.aborted ? "cancel" : "io",
        host.signal?.aborted
          ? "cli-cancelled"
          : stale
            ? "cli-output-stale"
            : "cli-analysis-worker-failed",
        host.signal?.aborted
          ? "Build was cancelled."
          : stale
            ? error.message
            : "Project analysis worker failed.",
      ),
    ]);
  }
  if (!preparedInputs.ok)
    return output(
      preparedInputs.code === "cli-cancelled" ? 130 : 1,
      command,
      format,
      "analysisFailure" in preparedInputs && preparedInputs.analysisFailure
        ? compilerDiagnostics(preparedInputs.analysisFailure)
        : "diagnostics" in preparedInputs && preparedInputs.diagnostics?.length
          ? styleDiagnostics(preparedInputs.diagnostics, preparedInputs.code)
          : [diagnostic("semantic", preparedInputs.code, preparedInputs.message)],
    );
  const prepared = preparedInputs.value;
  const assemblyCarrier = prepared.assemblyCarrier;
  const sourceAssets = { value: { sourceAssetBytes: prepared.sourceAssetBytes } };
  const source = prepared.source;
  let assembled: AnalysisOperations["assemble"]["output"];
  try {
    assembled = await runAnalysisOperation(
      "assemble",
      {
        source,
        carrier: assemblyCarrier,
        sourceAssetBytes: sourceAssets.value.sourceAssetBytes,
      },
      host.signal,
    );
  } catch {
    return output(host.signal?.aborted ? 130 : 3, command, format, [
      diagnostic(
        host.signal?.aborted ? "cancel" : "io",
        host.signal?.aborted ? "cli-cancelled" : "cli-analysis-worker-failed",
        host.signal?.aborted ? "Build was cancelled." : "Project analysis worker failed.",
      ),
    ]);
  }
  if (!assembled.valid) return output(1, command, format, compilerDiagnostics(assembled));
  const checked = checkDeclarationProject(
    assembled.value.project,
    sourceAssets.value.sourceAssetBytes,
  );
  if (!checked.valid)
    return output(1, command, format, compilerDiagnostics({ ...checked, phase: "assembly" }));
  const assembledProject = assembled.value.project as CompilerDeclarationProject;
  if (command === "check")
    return output(
      0,
      command,
      format,
      [],
      [...checked.value.warnings, ...styleDiagnostics(prepared.diagnostics)],
    );
  const opaque = Object.values(checked.value.definition.scene.surfaces).find(
    (surface) => surface.content.kind === "opaque",
  );
  const acquired = await acquireBuildLock(discovered.projectDirectory);
  if (!acquired.ok)
    return output(3, command, format, [
      diagnostic(
        "io",
        acquired.code,
        "Another build owns this project or its build lock is unsafe.",
      ),
    ]);
  const buildLock: BuildLock = acquired.value;
  const finishBuild = async (result: PresentationCliResult): Promise<PresentationCliResult> => {
    try {
      await buildLock.release();
    } catch {
      return output(
        result.exitCode === 130 ? 130 : 3,
        command,
        format,
        result.exitCode === 130
          ? [
              diagnostic("cancel", "cli-cancelled", "Build was cancelled."),
              diagnostic(
                "io",
                "cli-build-lock-release-failed",
                "Build lock could not be released.",
              ),
            ]
          : [
              diagnostic(
                "io",
                "cli-build-lock-release-failed",
                "Build lock could not be released.",
              ),
            ],
      );
    }
    return result;
  };
  if (host.signal?.aborted)
    return finishBuild(
      output(130, command, format, [diagnostic("cancel", "cli-cancelled", "Build was cancelled.")]),
    );
  let cleanupFailed = false;
  const buildResult = await (async (): Promise<PresentationCliResult> => {
    let session: { close(): Promise<void> } | undefined;
    try {
      let expectedGeneration: string | null;
      try {
        expectedGeneration = await readExpectedBuildGeneration(
          discovered.projectDirectory,
          host.channel ?? "dist",
        );
      } catch {
        return host.signal?.aborted
          ? output(130, command, format, [
              diagnostic("cancel", "cli-cancelled", "Build was cancelled."),
            ])
          : output(3, command, format, [
              diagnostic(
                "io",
                "cli-output-io",
                "Build artifacts could not be published. (stage: inspect-dist)",
              ),
            ]);
      }
      const context = host.buildContext ?? fixedContext;
      let renderer: ReturnType<typeof createBakedWebRenderer> | undefined;
      const sessions: { close(): Promise<void> }[] = [];
      session = {
        close: async () => {
          const results = await Promise.allSettled(sessions.map((item) => item.close()));
          if (results.some((result) => result.status === "rejected"))
            throw new BrowserCleanupFailure();
        },
      };
      if (opaque) {
        const prepared = await prepareOpaqueRenderer(
          source,
          assemblyCarrier,
          host.signal,
          context.webRendererConfig,
          sourceAssets.value.sourceAssetBytes,
        );
        sessions.push(prepared);
        renderer = prepared.renderer;
      }
      if (
        Object.values(checked.value.definition.scene.surfaces).some(
          (surface) => surface.content.kind === "structured",
        )
      ) {
        let fixedSession: FixedBrowserSession;
        const opener =
          host.openFixedBrowser ??
          ((options: Readonly<{ signal?: AbortSignal }>) => openPlaywrightFixedBrowser(options));
        try {
          fixedSession = await opener(host.signal ? { signal: host.signal } : {});
          sessions.push(fixedSession);
        } catch {
          if (host.signal?.aborted)
            return output(130, command, format, [
              diagnostic("cancel", "cli-cancelled", "Build was cancelled."),
            ]);
          throw new BrowserProvisionFailure();
        }
        if (host.signal?.aborted)
          return output(130, command, format, [
            diagnostic("cancel", "cli-cancelled", "Build was cancelled."),
          ]);
        const adapter = Object.freeze({
          identity: fixedSession.identity,
          environment: fixedSession.environment,
          capture: (request: Parameters<FixedBrowserSession["capture"]>[0]) =>
            Reflect.apply(fixedSession.capture, fixedSession, [
              request,
              ...(host.signal ? [{ signal: host.signal }] : []),
            ]),
        });
        const structured = createBakedWebRenderer({ adapter, config: context.webRendererConfig });
        renderer = renderer ? combineBakedWebRenderers(structured, renderer) : structured;
      }
      class BuildStageFailure extends Error {
        constructor(readonly result: PresentationCliResult) {
          super("Build stage failed");
        }
      }
      const job = createBuildJob(
        { revision: discovered.revision, expectedGeneration },
        {
          prepare: async () => {
            const compiled = await compileCheckedDeclarationProject(
              assembledProject,
              checked.value,
              {
                compiler: {
                  ...context.compiler,
                  baseEnvironmentHash: hashCanonicalJsonPayload({
                    baseEnvironmentHash: context.compiler.baseEnvironmentHash,
                    typeLibraries: hashSourceTypeLibraries(source.typeLibraries),
                  }),
                },
                locale: context.locale,
                timezone: context.timezone,
                colorScheme: context.colorScheme,
                rendererConfigHash: createWebRendererConfigHash(context.webRendererConfig),
                renderers: renderer ? [renderer] : [],
                encodeLimits: limits,
                ...(Object.values(checked.value.assetSet.assets).some(
                  (asset) => asset.mediaType === "video/mp4",
                )
                  ? { videoValidator: await createVideoValidator(host.signal) }
                  : {}),
              },
              sourceAssets.value.sourceAssetBytes,
              createFilesystemBuildCache(
                discovered.projectDirectory,
                host.signal ? { signal: host.signal } : {},
              ),
              buildMediaPorts,
            );
            if (!compiled.valid)
              throw new BuildStageFailure(
                output(
                  host.signal?.aborted ? 130 : 1,
                  command,
                  format,
                  host.signal?.aborted
                    ? [diagnostic("cancel", "cli-cancelled", "Build was cancelled.")]
                    : compilerDiagnostics({ ...compiled, phase: "compile" }),
                ),
              );
            const closed = session;
            session = undefined;
            if (closed) await closeSession(closed);
            return compiled.value;
          },
          commit: async (value, identity) => {
            const outcome = await publishProjectBuild({
              projectDirectory: discovered.projectDirectory,
              artifacts: artifacts(value),
              revision: discovered.revision,
              expectedGeneration: identity.expectedGeneration,
              ...sourceWait,
              ...(host.channel ? { channel: host.channel } : {}),
            });
            if (outcome.kind === "lease-error")
              throw new BuildStageFailure(
                output(outcome.code === "cli-cancelled" ? 130 : 3, command, format, [
                  diagnostic(
                    outcome.code === "cli-cancelled" ? "cancel" : "io",
                    outcome.code,
                    "Source is being saved or requires recovery.",
                  ),
                ]),
              );
            const published = outcome.result;
            if (published.ok) return { status: "committed", generation: published.generationId };
            if (published.code === "cli-output-stale") return { status: "conflict" };
            if (published.family === "cancel") return { status: "cancelled" };
            throw new BuildStageFailure(
              output(3, command, format, [
                diagnostic(
                  "io",
                  published.code,
                  published.detail
                    ? `Build artifacts could not be published. (stage: ${published.detail.stage}${published.detail.operation ? `, operation: ${published.detail.operation}` : ""}${published.detail.code ? `, code: ${published.detail.code}` : ""})`
                    : "Build artifacts could not be published.",
                ),
              ]),
            );
          },
        },
        host.signal,
      );
      const built = await job.result;
      if (built.status === "failed") {
        if (built.error instanceof BuildStageFailure) return built.error.result;
        throw built.error;
      }
      if (built.status !== "succeeded")
        return output(built.status === "cancelled" ? 130 : 3, command, format, [
          diagnostic(
            built.status === "cancelled" ? "cancel" : "io",
            built.status === "cancelled" ? "cli-cancelled" : "cli-output-stale",
            built.status === "cancelled"
              ? "Build was cancelled."
              : "Project inputs or output generation changed during build.",
          ),
        ]);
      const compiled = { value: built.value };
      const published = { generationId: built.generation };
      return output(
        0,
        command,
        format,
        [],
        [...compiled.value.warnings, ...styleDiagnostics(prepared.diagnostics)],
        {
          sourceRevision: discovered.revision,
          generationId: published.generationId,
        },
      );
    } catch (error) {
      if (error instanceof OpaquePreparationFailure && !host.signal?.aborted)
        return output(
          1,
          command,
          format,
          error.diagnostics.map((item) =>
            diagnostic("renderer", item.code, item.message, item.path),
          ),
        );
      const opaqueCode =
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code.startsWith("opaque-")
          ? error.code
          : undefined;
      const cancel =
        host.signal?.aborted || (error instanceof Error && error.name === "AbortError");
      const browserFailure =
        error instanceof BrowserProvisionFailure ||
        error instanceof BrowserCleanupFailure ||
        opaqueCode !== undefined;
      return output(cancel ? 130 : browserFailure ? 1 : 3, command, format, [
        diagnostic(
          cancel ? "cancel" : browserFailure ? "renderer" : "io",
          cancel
            ? "cli-cancelled"
            : error instanceof BrowserCleanupFailure
              ? "cli-browser-cleanup-failed"
              : error instanceof BrowserProvisionFailure
                ? "cli-browser-provision-failed"
                : (opaqueCode ?? "cli-build-io"),
          cancel
            ? "Build was cancelled."
            : browserFailure
              ? "Fixed Browser could not be completed."
              : "Build could not be completed.",
        ),
      ]);
    } finally {
      if (session)
        await closeSession(session).catch(() => {
          cleanupFailed = true;
        });
    }
  })();
  const completedResult = cleanupFailed
    ? output(
        buildResult.exitCode === 130 ? 130 : 1,
        command,
        format,
        buildResult.exitCode === 130
          ? [
              diagnostic("cancel", "cli-cancelled", "Build was cancelled."),
              diagnostic(
                "renderer",
                "cli-browser-cleanup-failed",
                "Fixed Browser could not be completed.",
              ),
            ]
          : [
              diagnostic(
                "renderer",
                "cli-browser-cleanup-failed",
                "Fixed Browser could not be completed.",
              ),
            ],
      )
    : buildResult;
  return finishBuild(completedResult);
};
