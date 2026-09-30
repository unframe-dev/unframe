import {
  checkAuthoringProjectAssembly,
  compileAuthoringProject,
  type AuthoringProjectPipelineResult,
  type AuthoringProjectDiagnostic,
  type CompiledDeclarationProject,
  type CompilerWarning,
} from "@unframe/unframe-compiler";
import { hashCanonicalJsonPayload } from "@unframe/unframe-core";
import {
  createBakedWebRenderer,
  combineBakedWebRenderers,
  createWebRendererConfigHash,
  openPlaywrightFixedBrowser,
  type FixedBrowserSession,
} from "@unframe/unframe-renderer-web";

import { prepareOpaqueRenderer, OpaquePreparationFailure } from "./opaque-renderer.js";
import { publishAtomicArtifacts } from "../filesystem/atomic-output.js";
import { acquireSourceLock } from "../filesystem/source-lock.js";
import { acquireBuildLock, type BuildLock } from "../filesystem/build-lock.js";
import { discoverPresentationProjectFiles } from "../filesystem/discover-project.js";
import { updateProjectLock } from "../filesystem/update-lock.js";
import { lockedFile } from "../filesystem/package-snapshot.js";
import { verifyFrozenLocalFiles } from "../filesystem/frozen-local-files.js";
import { loadUnframeLock } from "../filesystem/load-lock.js";
import type {
  PresentationCliDiagnostic,
  PresentationCliExitCode,
  PresentationCliHost,
  PresentationCliResult,
} from "./types.js";

type Command = Readonly<{
  command: "check" | "build" | "lock";
  directory: string;
  format: "text" | "json";
  operation?: "refresh" | "update";
  recreate?: boolean;
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
  "Usage: unframe-cli check <absolute-project-directory> [--format text|json]\n       unframe-cli build <absolute-project-directory> [--format text|json]\n       unframe-cli lock refresh|update <absolute-project-directory> [--recreate] [--format text|json]";
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
  warnings: readonly CompilerWarning[] = [],
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
          ? `${JSON.stringify({ ok: true, command, diagnostics: [], warnings: warningList })}\n`
          : `${command}: ok\n`,
      stderr:
        format === "text" && warningList.length
          ? warningList
              .map((warning) => {
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
    args[0] === "check" || args[0] === "build" || args[0] === "lock" ? args[0] : undefined;
  const at = args.indexOf("--format");
  const format = at >= 0 && args[at + 1] === "json" ? "json" : "text";
  const positional = at < 0 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  if (command === "lock") {
    const operation = positional[1];
    const recreate = positional[3] === "--recreate";
    if (
      (operation === "refresh" || operation === "update") &&
      positional[2]?.startsWith("/") &&
      (positional.length === 3 ||
        (positional.length === 4 && recreate && operation === "update")) &&
      (at < 0 || (at === args.length - 2 && ["text", "json"].includes(args[at + 1] ?? "")))
    )
      return {
        ok: true,
        value: { command, operation, directory: positional[2], format, recreate },
      };
    return {
      ok: false,
      command,
      format,
      diagnostics: [
        diagnostic(
          "usage",
          "cli-invalid-usage",
          "Usage: unframe-cli lock refresh|update <absolute-project-directory> [--recreate] [--format text|json]",
        ),
      ],
    };
  }
  if (
    !command ||
    (at >= 0 && (at !== args.length - 2 || !["text", "json"].includes(args[at + 1] ?? ""))) ||
    positional.length !== 2 ||
    !positional[1]?.startsWith("/")
  )
    return command
      ? {
          ok: false,
          command,
          format,
          diagnostics: [diagnostic("usage", "cli-invalid-usage", usage)],
        }
      : { ok: false, format, diagnostics: [diagnostic("usage", "cli-invalid-usage", usage)] };
  return { ok: true, value: { command, directory: positional[1], format } };
};
const compilerDiagnostics = (
  result: Exclude<AuthoringProjectPipelineResult<unknown>, { valid: true }>,
): readonly PresentationCliDiagnostic[] =>
  result.diagnostics.map((item) => {
    if (result.phase === "source") {
      const source = item as AuthoringProjectDiagnostic;
      return {
        ...diagnostic(
          source.code === "compiler-source-syntax-error" ||
            source.code === "compiler-source-kind-unsupported" ||
            source.code.startsWith("compiler-static-")
            ? "syntax"
            : source.code === "compiler-source-type-error" ||
                source.code.startsWith("compiler-module-") ||
                source.code === "compiler-project-entry-invariant-invalid"
              ? "type"
              : "semantic",
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
  if (host.signal?.aborted)
    return output(130, command, format, [
      diagnostic("cancel", "cli-cancelled", "Build was cancelled."),
    ]);
  if (command === "lock") {
    const result = await updateProjectLock(
      directory,
      parsed.value.operation!,
      parsed.value.recreate ?? false,
      host.signal,
    );
    return result.ok
      ? output(0, command, format)
      : output(result.code === "cli-cancelled" ? 130 : 1, command, format, [
          diagnostic(
            result.code === "cli-cancelled" ? "cancel" : "semantic",
            result.code,
            result.message,
          ),
        ]);
  }
  const discovered = await discoverPresentationProjectFiles(directory);
  if (!discovered.ok)
    return output(discovered.code === "cli-config-invalid" ? 1 : 3, command, format, [
      diagnostic(
        discovered.code === "cli-config-invalid" ? "syntax" : "io",
        discovered.code,
        discovered.message,
        [directory],
      ),
    ]);
  if (host.expectedRevision !== undefined && discovered.revision !== host.expectedRevision)
    return output(3, command, format, [
      diagnostic("io", "cli-output-stale", "Project inputs changed after the build was requested."),
    ]);
  const lock = loadUnframeLock(discovered.lockBytes);
  if (!lock.ok)
    return output(1, command, format, [
      diagnostic(lock.diagnostic.family, lock.diagnostic.code, lock.diagnostic.message, [
        "unframe.lock",
      ]),
    ]);
  const frozenFailures = verifyFrozenLocalFiles(
    discovered.localFiles,
    lock.value.assemblyCarrier.componentLocks,
  );
  if (frozenFailures.length)
    return output(
      1,
      command,
      format,
      frozenFailures.map(({ path, code }) =>
        diagnostic(
          "semantic",
          code,
          "Local Component inputs differ from the frozen lock. Refresh the lock explicitly.",
          [path],
        ),
      ),
    );
  const source = Object.freeze({
    projectRoot: discovered.projectDirectory,
    entryFile: discovered.entryFile,
    files: discovered.files,
    rawFiles: discovered.localFiles
      .filter(({ path }) => /\.(js|mjs|cjs|css|png|jpe?g|webp|ttf|otf)$/i.test(path))
      .map(({ path, bytes }) => lockedFile(path, bytes)),
    ...lock.value.virtualSource,
  });
  const checked = checkAuthoringProjectAssembly(source, lock.value.assemblyCarrier);
  if (!checked.valid) return output(1, command, format, compilerDiagnostics(checked));
  if (command === "check") return output(0, command, format, [], checked.value.warnings);
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
          lock.value.assemblyCarrier,
          host.signal,
          context.webRendererConfig,
        );
        sessions.push(prepared);
        renderer = prepared.renderer;
      }
      if (
        !opaque ||
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
      if (!renderer) throw new BrowserProvisionFailure();
      const compiled = await compileAuthoringProject(source, lock.value.assemblyCarrier, {
        compiler: context.compiler,
        locale: context.locale,
        timezone: context.timezone,
        colorScheme: context.colorScheme,
        rendererConfigHash: createWebRendererConfigHash(context.webRendererConfig),
        renderers: [renderer],
        encodeLimits: limits,
      });
      if (!compiled.valid)
        return output(
          host.signal?.aborted ? 130 : 1,
          command,
          format,
          host.signal?.aborted
            ? [diagnostic("cancel", "cli-cancelled", "Build was cancelled.")]
            : compilerDiagnostics(compiled),
        );
      const closed = session;
      session = undefined;
      await closeSession(closed);
      if (host.signal?.aborted)
        return output(130, command, format, [
          diagnostic("cancel", "cli-cancelled", "Build was cancelled."),
        ]);
      const sourceLease = await acquireSourceLock(discovered.projectDirectory);
      if (!sourceLease.ok)
        return output(3, command, format, [
          diagnostic("io", sourceLease.code, "Source is being saved or requires recovery."),
        ]);
      const published = await (async () => {
        try {
          return await publishAtomicArtifacts({
            projectDirectory: discovered.projectDirectory,
            artifacts: artifacts(compiled.value),
            isCurrentRevision: async () => {
              const current = await discoverPresentationProjectFiles(discovered.projectDirectory, {
                sourceLeaseHeld: true,
              });
              return current.ok && current.revision === discovered.revision;
            },
            ...(host.signal ? { signal: host.signal } : {}),
          });
        } finally {
          await sourceLease.value.release();
        }
      })();
      if (!published.ok)
        return output(published.family === "cancel" ? 130 : 3, command, format, [
          diagnostic(
            published.family,
            published.code,
            published.family === "cancel"
              ? "Build was cancelled."
              : published.code === "cli-output-stale"
                ? "Project inputs changed during build. Rebuild the current revision."
                : published.detail
                  ? `Build artifacts could not be published. (stage: ${published.detail.stage}${published.detail.operation ? `, operation: ${published.detail.operation}` : ""}${published.detail.code ? `, code: ${published.detail.code}` : ""})`
                  : "Build artifacts could not be published.",
          ),
        ]);
      return output(0, command, format, [], compiled.value.warnings);
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
