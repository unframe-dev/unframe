import {
  checkDeclarationProject,
  compileDeclarationProject,
  type CompiledDeclarationProject,
} from "@unframe/presentation-compiler";
import {
  createBakedWebRenderer,
  createWebRendererConfigHash,
} from "@unframe/presentation-renderer-web";
import { z } from "zod";

import type {
  BuildArtifactFile,
  PresentationCliBuildContext,
  PresentationCliExitCode,
  PresentationCliHost,
  PresentationCliResult,
} from "./types.js";

type ParsedCommand =
  | Readonly<{ command: "check"; projectPath: string; format: "text" | "json" }>
  | Readonly<{
      command: "build";
      projectPath: string;
      outputDirectory: string;
      format: "text" | "json";
    }>;

type Diagnostic = Readonly<{ code: string; message: string; path: readonly (string | number)[] }>;
type ParseResult =
  | Readonly<{ ok: true; value: ParsedCommand }>
  | Readonly<{
      ok: false;
      command: "check" | "build" | undefined;
      format: "text" | "json";
      diagnostics: readonly Diagnostic[];
    }>;

const absolutePathSchema = z.string().refine((value) => value.startsWith("/") && value.length > 1);
const argumentArraySchema = z.array(z.string());
const buildContextSchema = z
  .object({
    compiler: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
        baseEnvironmentHash: z.string().min(1),
      })
      .strict(),
    locale: z.string().min(1),
    timezone: z.string().min(1),
    colorScheme: z.enum(["light", "dark"]),
    pixelTarget: z.tuple([z.int().positive(), z.int().positive()]),
    webRendererConfig: z
      .object({
        documentBackground: z.tuple([
          z.int().min(0).max(255),
          z.int().min(0).max(255),
          z.int().min(0).max(255),
          z.int().min(0).max(255),
        ]),
        fontFamily: z.string(),
      })
      .strict(),
  })
  .strict();
const publicInputSchema = z.object({ args: z.unknown(), host: z.unknown() }).strict();
const checkHostSchema = z.object({ readProject: z.function().optional() });
const buildHostSchema = checkHostSchema.extend({
  writeBuildArtifacts: z.function().optional(),
  browserAdapter: z.unknown().optional(),
  buildContext: z.unknown().optional(),
});
const hostCallbackSchema = z.function();
const projectSourceSchema = z.string();

const textEncoder = new TextEncoder();
const PNG_LIMITS = Object.freeze({
  maxWidth: 4_096,
  maxHeight: 4_096,
  maxPixels: 16_777_216,
  maxInputBytes: 64 * 1_024 * 1_024,
  maxOutputBytes: 65 * 1_024 * 1_024,
});

const usage =
  "Usage: presentation-cli check <absolute-project.json> [--format text|json]\n" +
  "       presentation-cli build <absolute-project.json> <absolute-output-dir> [--format text|json]\n";

const ownDataRecord = (value: unknown): Record<string, unknown> | undefined => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    if (
      Object.values(descriptors).some(
        (descriptor) =>
          descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable,
      )
    )
      return undefined;
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch {
    return undefined;
  }
};

const ownDenseValues = (value: unknown): readonly unknown[] | undefined => {
  try {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    const length = descriptors["length"]?.value;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const keys = Array.from({ length }, (_, index) => String(index));
    if (
      Object.keys(descriptors).length !== length + 1 ||
      keys.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor || descriptor.get !== undefined || descriptor.set !== undefined;
      })
    )
      return undefined;
    return keys.map((key) => descriptors[key]!.value);
  } catch {
    return undefined;
  }
};

const snapshotBuildContext = (value: unknown): PresentationCliBuildContext | undefined => {
  const context = ownDataRecord(value);
  if (!context) return undefined;
  const compiler = ownDataRecord(context.compiler);
  const config = ownDataRecord(context.webRendererConfig);
  const pixelTarget = ownDenseValues(context.pixelTarget);
  const background = config && ownDenseValues(config.documentBackground);
  if (!compiler || !config || !pixelTarget || !background) return undefined;
  const parsed = buildContextSchema.safeParse({
    ...context,
    pixelTarget,
    compiler,
    webRendererConfig: { ...config, documentBackground: background },
  });
  return parsed.success ? Object.freeze(parsed.data) : undefined;
};

const cliDiagnostic = (
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
): Diagnostic => ({
  code,
  message,
  path,
});
const pathText = (path: readonly (string | number)[]) =>
  path.length === 0 ? "$" : `$/${path.map(String).join("/")}`;
const stableDiagnostics = (items: readonly Diagnostic[]) =>
  [...items].sort((left, right) => {
    const a = `${pathText(left.path)}\\u0000${left.code}\\u0000${left.message}`;
    const b = `${pathText(right.path)}\\u0000${right.code}\\u0000${right.message}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
const json = (value: unknown) => `${JSON.stringify(value)}\n`;
const textDiagnostics = (items: readonly Diagnostic[]) =>
  stableDiagnostics(items)
    .map((item) => `${pathText(item.path)}: ${item.code}: ${item.message}`)
    .join("\n") + "\n";

const result = (
  exitCode: PresentationCliExitCode,
  command: "check" | "build" | undefined,
  format: "text" | "json",
  diagnostics: readonly Diagnostic[] = [],
): PresentationCliResult => {
  const ordered = stableDiagnostics(diagnostics);
  if (exitCode === 0)
    return {
      exitCode,
      stdout: format === "json" ? json({ ok: true, command, diagnostics: [] }) : `${command}: ok\n`,
      stderr: "",
    };
  const output =
    format === "json"
      ? json({ ok: false, command: command ?? null, diagnostics: ordered })
      : textDiagnostics(ordered);
  return { exitCode, stdout: "", stderr: output };
};

const parse = (rawArgs: unknown): ParseResult => {
  const snapshot = ownDenseValues(rawArgs);
  const parsedArguments = argumentArraySchema.safeParse(snapshot);
  if (!parsedArguments.success)
    return {
      ok: false,
      command: undefined,
      format: "text",
      diagnostics: [
        cliDiagnostic("cli-invalid-arguments", "Arguments must be a dense string array."),
      ],
    };
  const args = parsedArguments.data;
  const command = args[0];
  const formatIndex = args.indexOf("--format");
  const hasFormat = formatIndex >= 0;
  const format = hasFormat ? args[formatIndex + 1] : "text";
  const failureFormat = format === "json" ? "json" : "text";
  const knownCommand = command === "check" || command === "build" ? command : undefined;
  const positional = hasFormat
    ? args.filter((_, index) => index !== formatIndex && index !== formatIndex + 1)
    : args;
  if (
    (hasFormat && (formatIndex !== args.length - 2 || (format !== "text" && format !== "json"))) ||
    (command !== "check" && command !== "build")
  )
    return {
      ok: false,
      command: knownCommand,
      format: failureFormat,
      diagnostics: [cliDiagnostic("cli-invalid-usage", usage.trim())],
    };
  if (command === "check") {
    const projectPath = positional[1];
    if (
      positional.length !== 2 ||
      !projectPath ||
      !absolutePathSchema.safeParse(projectPath).success
    )
      return {
        ok: false,
        command,
        format: failureFormat,
        diagnostics: [cliDiagnostic("cli-invalid-usage", usage.trim())],
      };
    return { ok: true, value: { command, projectPath, format: format as "text" | "json" } };
  }
  const projectPath = positional[1];
  const outputDirectory = positional[2];
  if (
    positional.length !== 3 ||
    !projectPath ||
    !outputDirectory ||
    !absolutePathSchema.safeParse(projectPath).success ||
    !absolutePathSchema.safeParse(outputDirectory).success
  )
    return {
      ok: false,
      command,
      format: failureFormat,
      diagnostics: [cliDiagnostic("cli-invalid-usage", usage.trim())],
    };
  return {
    ok: true,
    value: { command, projectPath, outputDirectory, format: format as "text" | "json" },
  };
};

const loadProject = async (
  host: PresentationCliHost,
  projectPath: string,
): Promise<{ ok: true; value: unknown } | { ok: false; diagnostics: readonly Diagnostic[] }> => {
  try {
    const readProject = host.readProject;
    const parsedReadProject = hostCallbackSchema.safeParse(readProject);
    if (!parsedReadProject.success)
      return {
        ok: false,
        diagnostics: [cliDiagnostic("cli-read-unavailable", "Project reader is unavailable.")],
      };
    const source = await Reflect.apply(parsedReadProject.data, host, [projectPath]);
    const parsedSource = projectSourceSchema.safeParse(source);
    if (!parsedSource.success)
      return {
        ok: false,
        diagnostics: [
          cliDiagnostic("cli-invalid-json", "Project JSON cannot be parsed.", [projectPath]),
        ],
      };
    try {
      return { ok: true, value: JSON.parse(parsedSource.data) };
    } catch {
      return {
        ok: false,
        diagnostics: [
          cliDiagnostic("cli-invalid-json", "Project JSON cannot be parsed.", [projectPath]),
        ],
      };
    }
  } catch {
    return {
      ok: false,
      diagnostics: [
        cliDiagnostic("cli-read-failed", "Project JSON could not be read.", [projectPath]),
      ],
    };
  }
};

const artifactFiles = (compiled: CompiledDeclarationProject): readonly BuildArtifactFile[] => {
  const files = [
    Object.freeze({ path: "definition.json", bytes: textEncoder.encode(compiled.definitionJson) }),
    Object.freeze({
      path: "render-bundle.json",
      bytes: textEncoder.encode(compiled.renderBundleJson),
    }),
    ...Object.entries(compiled.assets)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([assetId, bytes]) =>
        Object.freeze({
          path: `assets/${encodeURIComponent(assetId)}.png`,
          bytes: new Uint8Array(bytes),
        }),
      ),
  ];
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return Object.freeze(files);
};

export const runPresentationCli = async (input: unknown): Promise<PresentationCliResult> => {
  try {
    const inputSnapshot = ownDataRecord(input);
    const parsedInput = publicInputSchema.safeParse(inputSnapshot);
    if (!parsedInput.success)
      return result(2, undefined, "text", [
        cliDiagnostic("cli-invalid-input", "CLI input is invalid."),
      ]);
    const record = parsedInput.data;
    const parsedResult = parse(record.args);
    if (!parsedResult.ok)
      return result(2, parsedResult.command, parsedResult.format, parsedResult.diagnostics);
    const parsed = parsedResult.value;
    const parsedHost = (parsed.command === "check" ? checkHostSchema : buildHostSchema).safeParse(
      record.host,
    );
    if (!parsedHost.success)
      return result(2, parsed.command, parsed.format, [
        cliDiagnostic("cli-invalid-host", "CLI host is invalid."),
      ]);
    const host = parsedHost.data as PresentationCliHost;
    const project = await loadProject(host, parsed.projectPath);
    if (!project.ok) return result(3, parsed.command, parsed.format, project.diagnostics);
    if (parsed.command === "check") {
      const checked = checkDeclarationProject(project.value);
      return checked.valid
        ? result(0, "check", parsed.format)
        : result(1, "check", parsed.format, checked.diagnostics);
    }
    let adapter: PresentationCliHost["browserAdapter"];
    let rawBuildContext: unknown;
    try {
      adapter = host.browserAdapter;
      rawBuildContext = host.buildContext;
    } catch {
      return result(3, "build", parsed.format, [
        cliDiagnostic("cli-host-failed", "Build host could not be inspected."),
      ]);
    }
    const buildContext = snapshotBuildContext(rawBuildContext);
    if (!adapter || !buildContext)
      return result(2, "build", parsed.format, [
        cliDiagnostic(
          "cli-build-unavailable",
          "Build requires an injected Browser adapter and build context.",
        ),
      ]);
    let compiled;
    try {
      const rendererConfigHash = createWebRendererConfigHash(buildContext.webRendererConfig);
      compiled = await compileDeclarationProject(project.value, {
        compiler: buildContext.compiler,
        locale: buildContext.locale,
        timezone: buildContext.timezone,
        colorScheme: buildContext.colorScheme,
        pixelTarget: buildContext.pixelTarget,
        rendererConfigHash,
        renderers: [createBakedWebRenderer({ adapter, config: buildContext.webRendererConfig })],
        encodeLimits: PNG_LIMITS,
      });
    } catch {
      return result(2, "build", parsed.format, [
        cliDiagnostic("cli-invalid-build-host", "Build host configuration is invalid."),
      ]);
    }
    if (!compiled.valid) return result(1, "build", parsed.format, compiled.diagnostics);
    const files = artifactFiles(compiled.value);
    try {
      const writeBuildArtifacts = host.writeBuildArtifacts;
      const parsedWriteBuildArtifacts = hostCallbackSchema.safeParse(writeBuildArtifacts);
      if (!parsedWriteBuildArtifacts.success)
        return result(3, "build", parsed.format, [
          cliDiagnostic("cli-write-unavailable", "Artifact writer is unavailable."),
        ]);
      await Reflect.apply(parsedWriteBuildArtifacts.data, host, [parsed.outputDirectory, files]);
    } catch {
      return result(3, "build", parsed.format, [
        cliDiagnostic("cli-write-failed", "Build artifacts could not be written."),
      ]);
    }
    return result(0, "build", parsed.format);
  } catch {
    return result(2, undefined, "text", [
      cliDiagnostic("cli-invalid-input", "CLI input could not be inspected safely."),
    ]);
  }
};
