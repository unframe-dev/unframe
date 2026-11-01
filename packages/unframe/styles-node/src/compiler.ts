import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import loadConfig from "postcss-load-config";
import type postcssType from "postcss";
import isPathInside from "path-is-inside";
import semver from "semver";
import ErrorStackParser from "error-stack-parser";
import {
  compileStylesRequestSchema,
  compileStylesResultSchema,
  dependencyMessageSchema,
  errorDiagnosticSchema,
  packageManifestSchema,
  sourceMapSchema,
  styleDiagnosticSchema,
  type CompileStylesRequest,
  type CompileStylesResult,
  type StyleDiagnostic,
  type ObservedDependency,
} from "./schemas.js";
export {
  compileStylesRequestSchema,
  compileStylesResultSchema,
  styleDiagnosticSchema,
  observedDependencySchema,
} from "./schemas.js";
export type {
  CompileStylesRequest,
  CompileStylesResult,
  StyleDiagnostic,
  ObservedDependency,
} from "./schemas.js";

function inside(root: string, file: string) {
  return isPathInside(file, root);
}

function logicalPath(root: string, value: string, base = root): string {
  if (value.startsWith("file:")) value = fileURLToPath(value);
  else if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  const absolute = path.resolve(base, value);
  if (inside(root, absolute)) return path.relative(root, absolute).split(path.sep).join("/") || ".";
  const marker = `${path.sep}node_modules${path.sep}`;
  const index = absolute.indexOf(marker);
  if (index !== -1)
    return `node_modules/${absolute
      .slice(index + marker.length)
      .split(path.sep)
      .join("/")}`;
  // The worker must expose only its declared project and dependency graph.
  throw new Error("File reference is outside the project and dependency graph");
}

function diagnosticMessage(root: string, value: unknown) {
  return String(value).replace(
    /(^|[\s("'=])((?:file:\/\/)?\/[^\s"'<>),;]+)/g,
    (_match, prefix, location) => {
      const suffix = location.match(/:\d+(?::\d+)?$/)?.[0] ?? "";
      const file = suffix ? location.slice(0, -suffix.length) : location;
      try {
        return prefix + logicalPath(root, file) + suffix;
      } catch {
        return prefix + "<EXTERNAL>" + suffix;
      }
    },
  );
}

function sourceMap(root: string, from: string, map: { toJSON(): unknown }) {
  const result = sourceMapSchema.parse(map.toJSON());
  const base = path.dirname(from);
  if (result.file) result.file = logicalPath(root, result.file, base);
  if (
    result.sourceRoot &&
    /^[a-z][a-z\d+.-]*:/i.test(result.sourceRoot) &&
    !result.sourceRoot.startsWith("file:")
  )
    return JSON.stringify(result);
  const sourceBase = result.sourceRoot
    ? result.sourceRoot.startsWith("file:")
      ? fileURLToPath(result.sourceRoot)
      : path.resolve(base, result.sourceRoot)
    : base;
  if (result.sources)
    result.sources = result.sources.map((source) => logicalPath(root, source, sourceBase));
  if (result.sourceRoot) result.sourceRoot = ".";
  return JSON.stringify(result);
}

/** Configs execute arbitrary Node code; invoke once inside a fresh, isolated worker. */
export async function compileStyles(request: CompileStylesRequest): Promise<CompileStylesResult> {
  let root: string | undefined;
  let phase: StyleDiagnostic["phase"] = "resolve";
  let currentFile: string | undefined;
  const cwd = process.cwd();
  const environment = process.env["NODE_ENV"];
  try {
    const input = compileStylesRequestSchema.parse(request);
    root = await realpath(input.projectRoot);
    process.chdir(root);
    process.env["NODE_ENV"] = "production";
    const entries = [];
    for (const entry of input.entries) {
      const from = path.resolve(root, entry);
      if (!inside(root, from) || !inside(root, await realpath(from)))
        throw new Error("CSS entry escapes project root");
      entries.push({ entry: logicalPath(root, from), from });
    }
    phase = "config";
    const config = await loadConfig({ cwd: root, env: "production" }, root, { stopDir: root });
    currentFile = logicalPath(root, config.file);
    if (!inside(root, await realpath(config.file)))
      throw new Error("PostCSS config escapes project root");
    const conflicts = ["from", "to", "map"].filter((key) => Object.hasOwn(config.options, key));
    if (conflicts.length)
      throw new Error(
        `PostCSS options owned by Unframe cannot be configured: ${conflicts.join(", ")}`,
      );
    phase = "resolve";
    const requireProject = createRequire(path.join(root, "package.json"));
    const resolved = requireProject.resolve("postcss");
    const projectPostcss = await realpath(path.join(root, "node_modules/postcss"));
    if (!inside(projectPostcss, await realpath(resolved)))
      throw new Error("PostCSS must be installed in the project");
    const postcssManifest = packageManifestSchema.parse(
      JSON.parse(await readFile(path.join(projectPostcss, "package.json"), "utf8")),
    );
    if (!semver.satisfies(postcssManifest.version, "8.x", { includePrerelease: true }))
      throw new Error(`PostCSS 8 is required; found ${postcssManifest.version}`);
    if (
      config.plugins.some(
        (plugin) => "postcssPlugin" in plugin && plugin.postcssPlugin === "@tailwindcss/postcss",
      )
    ) {
      for (const name of ["tailwindcss", "@tailwindcss/postcss"]) {
        const manifest = packageManifestSchema.parse(
          JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8")),
        );
        if (!semver.satisfies(manifest.version, "4.x", { includePrerelease: true }))
          throw new Error(`Tailwind 4 is required; found ${name}@${manifest.version}`);
      }
    }
    const module: { default: typeof postcssType } = await import(pathToFileURL(resolved).href);
    const postcss = module.default;
    const stylesheets: Extract<CompileStylesResult, { ok: true }>["stylesheets"] = [];
    const dependencies = new Map<string, ObservedDependency>();
    const diagnostics: StyleDiagnostic[] = [];
    phase = "transform";
    for (const { entry, from } of entries) {
      currentFile = entry;
      const result = await postcss(config.plugins).process(await readFile(from, "utf8"), {
        ...config.options,
        from,
        to: from,
        map: { inline: false, annotation: false, sourcesContent: true },
      });
      void result.root;
      stylesheets.push({
        entry,
        css: result.css,
        ...(result.map ? { sourceMap: sourceMap(root, from, result.map) } : {}),
      });
      for (const rawMessage of result.messages) {
        if (!["dependency", "dir-dependency", "warning"].includes(rawMessage.type)) continue;
        const message = dependencyMessageSchema.parse(rawMessage);
        if (message.type === "dependency") {
          const dependency: ObservedDependency = {
            kind: "file",
            path: logicalPath(root, message.file),
          };
          dependencies.set(JSON.stringify(dependency), dependency);
        } else if (message.type === "dir-dependency") {
          const dependency: ObservedDependency = {
            kind: "directory",
            path: logicalPath(root, message.dir),
            ...(typeof message.glob === "string" ? { glob: message.glob } : {}),
          };
          dependencies.set(JSON.stringify(dependency), dependency);
        } else if (message.type === "warning") {
          diagnostics.push({
            phase,
            severity: "warning",
            message: diagnosticMessage(root, message.text),
            file: message.node?.source?.input?.file
              ? logicalPath(root, message.node.source.input.file)
              : entry,
            ...(message.line ? { line: message.line } : {}),
            ...(message.column ? { column: message.column } : {}),
            ...(message.plugin ? { plugin: message.plugin } : {}),
          });
        }
      }
    }
    return compileStylesResultSchema.parse({
      ok: true,
      configFile: logicalPath(root, config.file),
      stylesheets,
      observedDependencies: [...dependencies.values()],
      diagnostics,
    });
  } catch (caught) {
    const parsedError = errorDiagnosticSchema.safeParse(caught);
    const error = parsedError.success ? parsedError.data : { message: String(caught) };
    let file = currentFile;
    if (root && phase === "config" && !file) {
      try {
        for (const frame of ErrorStackParser.parse({
          stack: error.stack ?? "",
          message: error.message ?? "",
          name: "Error",
        })) {
          if (!frame.fileName) continue;
          const candidate = frame.fileName.startsWith("file:")
            ? fileURLToPath(frame.fileName)
            : frame.fileName.split("?")[0]!;
          if (inside(root, candidate)) {
            file = logicalPath(root, candidate);
            break;
          }
        }
      } catch {
        /* A thrown value need not have a parseable stack. */
      }
    }
    if (root && typeof error.file === "string") {
      try {
        file = styleDiagnosticSchema.shape.file.unwrap().parse(logicalPath(root, error.file));
      } catch {
        /* Keep the entry when a plugin reports an inaccessible file. */
      }
    }
    return compileStylesResultSchema.parse({
      ok: false,
      diagnostics: [
        {
          phase,
          severity: "error",
          message: root
            ? diagnosticMessage(root, error.reason ?? error.message ?? error)
            : String(error.message ?? error),
          ...(file ? { file } : {}),
          ...(error.line ? { line: error.line } : {}),
          ...(error.column ? { column: error.column } : {}),
          ...(error.plugin ? { plugin: error.plugin } : {}),
        },
      ],
    });
  } finally {
    process.chdir(cwd);
    if (environment === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = environment;
  }
}
