import {
  checkAuthoringProjectAssembly,
  compileAuthoringProject,
  type AuthoringProjectPipelineResult,
  type CompiledDeclarationProject,
} from "@unframe/presentation-compiler";
import { hashCanonicalJsonPayload } from "@unframe/presentation-core";
import {
  createBakedWebRenderer,
  createWebRendererConfigHash,
  openPlaywrightFixedBrowser,
  type FixedBrowserSession,
} from "@unframe/presentation-renderer-web";

import { publishAtomicArtifacts } from "../filesystem/atomic-output.js";
import { discoverPresentationProjectFiles } from "../filesystem/discover-project.js";
import { loadUnframeLock } from "../filesystem/load-lock.js";
import type {
  PresentationCliDiagnostic,
  PresentationCliExitCode,
  PresentationCliHost,
  PresentationCliResult,
} from "./types.js";

type Command = Readonly<{ command: "check" | "build"; directory: string; format: "text" | "json" }>;
class BrowserProvisionFailure extends Error {}
class BrowserCleanupFailure extends Error {}
const encoder = new TextEncoder();
const fixedContext = Object.freeze({
  compiler: Object.freeze({
    name: "unframe",
    version: "1",
    baseEnvironmentHash: hashCanonicalJsonPayload({
      browser: "playwright-chromium-fixed",
      fontProfile: "Noto Sans CJK JP",
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
      toolchain: "unframe-presentation-m1",
    }),
  }),
  locale: "ja-JP" as const,
  timezone: "Asia/Tokyo" as const,
  colorScheme: "light" as const,
  pixelTarget: [1920, 1080] as const,
  webRendererConfig: Object.freeze({
    documentBackground: [0, 0, 0, 255] as const,
    fontFamily: "Noto Sans CJK JP",
  }),
});
const limits = Object.freeze({
  maxWidth: 4096,
  maxHeight: 4096,
  maxPixels: 16_777_216,
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 65 * 1024 * 1024,
});
const usage =
  "Usage: presentation-cli check <absolute-project-directory> [--format text|json]\n       presentation-cli build <absolute-project-directory> [--format text|json]";
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
const ordered = (items: readonly PresentationCliDiagnostic[]) =>
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
): PresentationCliResult => {
  const list = ordered(diagnostics);
  if (exitCode === 0)
    return {
      exitCode,
      stdout:
        format === "json"
          ? `${JSON.stringify({ ok: true, command, diagnostics: [] })}\n`
          : `${command}: ok\n`,
      stderr: "",
    };
  const stderr =
    format === "json"
      ? `${JSON.stringify({ ok: false, command: command ?? null, diagnostics: list })}\n`
      : list.map((d) => `${pathText(d.path)}: ${d.family}/${d.code}: ${d.message}`).join("\n") +
        "\n";
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
  const command = args[0] === "check" || args[0] === "build" ? args[0] : undefined;
  const at = args.indexOf("--format");
  const format = at >= 0 && args[at + 1] === "json" ? "json" : "text";
  const positional = at < 0 ? args : args.filter((_, i) => i !== at && i !== at + 1);
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
      const source = item as {
        code: string;
        message: string;
        fileName: string;
        typescriptCode?: number;
      };
      return diagnostic(
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
      );
    }
    const domain = item as { code: string; message: string; path: readonly (string | number)[] };
    const rendererCode =
      domain.code.startsWith("compiler-renderer-") || rendererDiagnosticCodes.has(domain.code);
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
    assets: Object.entries(compiled.assets)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([assetId, bytes]) => Object.freeze({ assetId, bytes: new Uint8Array(bytes) })),
  });
const closeSession = async (session: FixedBrowserSession) => {
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
  const lock = loadUnframeLock(discovered.lockBytes);
  if (!lock.ok)
    return output(1, command, format, [
      diagnostic(lock.diagnostic.family, lock.diagnostic.code, lock.diagnostic.message, [
        "unframe.lock",
      ]),
    ]);
  const source = Object.freeze({
    projectRoot: discovered.projectDirectory,
    entryFile: discovered.entryFile,
    files: discovered.files,
    ...lock.value.virtualSource,
  });
  if (command === "check") {
    const checked = checkAuthoringProjectAssembly(source, lock.value.assemblyCarrier);
    return checked.valid
      ? output(0, command, format)
      : output(1, command, format, compilerDiagnostics(checked));
  }
  let session: FixedBrowserSession | undefined;
  try {
    const opener = host.openFixedBrowser ?? (() => openPlaywrightFixedBrowser());
    try {
      session = await opener(host.signal ? { signal: host.signal } : {});
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
    const context = host.buildContext ?? fixedContext;
    const adapter = Object.freeze({
      identity: session.identity,
      environment: session.environment,
      capture: (request: Parameters<FixedBrowserSession["capture"]>[0]) =>
        Reflect.apply(session!.capture, session, [
          request,
          ...(host.signal ? [{ signal: host.signal }] : []),
        ]),
    });
    const compiled = await compileAuthoringProject(source, lock.value.assemblyCarrier, {
      ...context,
      rendererConfigHash: createWebRendererConfigHash(context.webRendererConfig),
      renderers: [createBakedWebRenderer({ adapter, config: context.webRendererConfig })],
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
    const published = await publishAtomicArtifacts({
      projectDirectory: discovered.projectDirectory,
      artifacts: artifacts(compiled.value),
      ...(host.signal ? { signal: host.signal } : {}),
    });
    if (!published.ok)
      return output(published.family === "cancel" ? 130 : 3, command, format, [
        diagnostic(
          published.family,
          published.code,
          published.family === "cancel"
            ? "Build was cancelled."
            : "Build artifacts could not be published.",
        ),
      ]);
    return output(0, command, format);
  } catch (error) {
    const cancel = host.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    const browserFailure =
      error instanceof BrowserProvisionFailure || error instanceof BrowserCleanupFailure;
    return output(cancel ? 130 : browserFailure ? 1 : 3, command, format, [
      diagnostic(
        cancel ? "cancel" : browserFailure ? "renderer" : "io",
        cancel
          ? "cli-cancelled"
          : error instanceof BrowserCleanupFailure
            ? "cli-browser-cleanup-failed"
            : error instanceof BrowserProvisionFailure
              ? "cli-browser-provision-failed"
              : "cli-build-io",
        cancel
          ? "Build was cancelled."
          : browserFailure
            ? "Fixed Browser could not be completed."
            : "Build could not be completed.",
      ),
    ]);
  } finally {
    if (session) await closeSession(session).catch(() => undefined);
  }
};
