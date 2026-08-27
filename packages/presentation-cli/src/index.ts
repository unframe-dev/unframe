import {
  checkDeclarationProject,
  compileDeclarationProject,
  type CompilerBuildOptions,
  type CompiledDeclarationProject,
} from "@unframe/presentation-compiler";
import {
  createBakedWebRenderer,
  createWebRendererConfigHash,
  type FixedBrowserAdapter,
  type WebRendererConfig,
} from "@unframe/presentation-renderer-web";

export type PresentationCliExitCode = 0 | 1 | 2 | 3;

export type PresentationCliResult = Readonly<{
  exitCode: PresentationCliExitCode;
  stdout: string;
  stderr: string;
}>;

export type BuildArtifactFile = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

export type PresentationCliBuildContext = Readonly<{
  compiler: CompilerBuildOptions["compiler"];
  locale: string;
  timezone: string;
  colorScheme: "light" | "dark";
  pixelTarget: readonly [width: number, height: number];
  webRendererConfig: WebRendererConfig;
}>;

export type PresentationCliHost = Readonly<{
  readProject?: (absoluteProjectJsonPath: string) => Promise<string> | string;
  writeBuildArtifacts?: (
    absoluteOutputDirectory: string,
    files: readonly BuildArtifactFile[],
  ) => Promise<void> | void;
  browserAdapter?: FixedBrowserAdapter;
  buildContext?: PresentationCliBuildContext;
}>;

export type RunPresentationCliInput = Readonly<{
  args: readonly string[];
  host: PresentationCliHost;
}>;

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

const ownDenseValues = (value: unknown, expectedLength: number): readonly unknown[] | undefined => {
  try {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    if (descriptors["length"]?.value !== expectedLength) return undefined;
    const keys = Array.from({ length: expectedLength }, (_, index) => String(index));
    if (
      Object.keys(descriptors).length !== expectedLength + 1 ||
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

const hasExactly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const snapshotBuildContext = (value: unknown): PresentationCliBuildContext | undefined => {
  const context = ownDataRecord(value);
  if (
    !context ||
    !hasExactly(context, [
      "compiler",
      "locale",
      "timezone",
      "colorScheme",
      "pixelTarget",
      "webRendererConfig",
    ])
  )
    return undefined;
  const compiler = ownDataRecord(context.compiler);
  const config = ownDataRecord(context.webRendererConfig);
  const pixelTarget = ownDenseValues(context.pixelTarget, 2);
  const background = config && ownDenseValues(config.documentBackground, 4);
  if (
    !compiler ||
    !hasExactly(compiler, ["name", "version", "baseEnvironmentHash"]) ||
    ![compiler.name, compiler.version, compiler.baseEnvironmentHash].every(
      (item) => typeof item === "string" && item.length > 0,
    ) ||
    typeof context.locale !== "string" ||
    context.locale.length === 0 ||
    typeof context.timezone !== "string" ||
    context.timezone.length === 0 ||
    (context.colorScheme !== "light" && context.colorScheme !== "dark") ||
    !pixelTarget ||
    !pixelTarget.every((item) => Number.isSafeInteger(item) && (item as number) > 0) ||
    !config ||
    !hasExactly(config, ["documentBackground", "fontFamily"]) ||
    !background ||
    !background.every(
      (item) => Number.isSafeInteger(item) && (item as number) >= 0 && (item as number) <= 255,
    ) ||
    typeof config.fontFamily !== "string"
  )
    return undefined;
  return Object.freeze({
    compiler: Object.freeze({
      name: compiler.name as string,
      version: compiler.version as string,
      baseEnvironmentHash: compiler.baseEnvironmentHash as string,
    }),
    locale: context.locale,
    timezone: context.timezone,
    colorScheme: context.colorScheme,
    pixelTarget: Object.freeze([pixelTarget[0] as number, pixelTarget[1] as number] as const),
    webRendererConfig: Object.freeze({
      documentBackground: Object.freeze([
        background[0] as number,
        background[1] as number,
        background[2] as number,
        background[3] as number,
      ] as const),
      fontFamily: config.fontFamily,
    }),
  });
};

const ownDenseStrings = (value: unknown): readonly string[] | undefined => {
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
    const items: string[] = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || typeof descriptor.value !== "string") return undefined;
      items.push(descriptor.value);
    }
    return items;
  } catch {
    return undefined;
  }
};

const absolutePath = (value: string) => value.startsWith("/") && value.length > 1;
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
  const args = ownDenseStrings(rawArgs);
  if (!args)
    return {
      ok: false,
      command: undefined,
      format: "text",
      diagnostics: [
        cliDiagnostic("cli-invalid-arguments", "Arguments must be a dense string array."),
      ],
    };
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
    if (positional.length !== 2 || !projectPath || !absolutePath(projectPath))
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
    !absolutePath(projectPath) ||
    !absolutePath(outputDirectory)
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
    if (typeof readProject !== "function")
      return {
        ok: false,
        diagnostics: [cliDiagnostic("cli-read-unavailable", "Project reader is unavailable.")],
      };
    const source = await Reflect.apply(readProject, host, [projectPath]);
    try {
      return { ok: true, value: JSON.parse(source) };
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
    if (typeof input !== "object" || input === null || Array.isArray(input))
      return result(2, undefined, "text", [
        cliDiagnostic("cli-invalid-input", "CLI input is invalid."),
      ]);
    const record = input as { args?: unknown; host?: unknown };
    const parsedResult = parse(record.args);
    if (!parsedResult.ok)
      return result(2, parsedResult.command, parsedResult.format, parsedResult.diagnostics);
    const parsed = parsedResult.value;
    if (typeof record.host !== "object" || record.host === null || Array.isArray(record.host))
      return result(2, parsed.command, parsed.format, [
        cliDiagnostic("cli-invalid-host", "CLI host is invalid."),
      ]);
    const host = record.host as PresentationCliHost;
    const project = await loadProject(host, parsed.projectPath);
    if (!project.ok) return result(3, parsed.command, parsed.format, project.diagnostics);
    if (parsed.command === "check") {
      const checked = checkDeclarationProject(project.value);
      return checked.valid
        ? result(0, "check", parsed.format)
        : result(1, "check", parsed.format, checked.diagnostics);
    }
    let adapter: FixedBrowserAdapter | undefined;
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
      if (typeof writeBuildArtifacts !== "function")
        return result(3, "build", parsed.format, [
          cliDiagnostic("cli-write-unavailable", "Artifact writer is unavailable."),
        ]);
      await Reflect.apply(writeBuildArtifacts, host, [parsed.outputDirectory, files]);
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
