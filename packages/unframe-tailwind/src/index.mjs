import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import loadConfig from "postcss-load-config";

function inside(root, file) {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function logicalPath(root, value, base = root) {
  if (typeof value !== "string") return undefined;
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

function diagnosticMessage(root, value) {
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

function sourceMap(root, from, map) {
  const result = map.toJSON();
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
export async function compileStyles(request) {
  let root;
  let phase = "resolve";
  let currentFile;
  const cwd = process.cwd();
  const environment = process.env.NODE_ENV;
  try {
    if (!request || typeof request.projectRoot !== "string" || !Array.isArray(request.entries))
      throw new Error("Expected projectRoot and CSS entries");
    root = await realpath(request.projectRoot);
    process.chdir(root);
    process.env.NODE_ENV = "production";
    const entries = [];
    for (const entry of request.entries) {
      if (typeof entry !== "string" || !entry || path.isAbsolute(entry))
        throw new Error("CSS entry must be project-root-relative");
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
    const postcssManifest = JSON.parse(
      await readFile(path.join(projectPostcss, "package.json"), "utf8"),
    );
    if (!postcssManifest.version.startsWith("8."))
      throw new Error(`PostCSS 8 is required; found ${postcssManifest.version}`);
    if (config.plugins.some((plugin) => plugin.postcssPlugin === "@tailwindcss/postcss")) {
      for (const name of ["tailwindcss", "@tailwindcss/postcss"]) {
        const manifest = JSON.parse(
          await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"),
        );
        if (!manifest.version.startsWith("4."))
          throw new Error(`Tailwind 4 is required; found ${name}@${manifest.version}`);
      }
    }
    const { default: postcss } = await import(pathToFileURL(resolved).href);
    const stylesheets = [];
    const dependencies = new Map();
    const diagnostics = [];
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
      for (const message of result.messages) {
        if (message.type === "dependency" && typeof message.file === "string") {
          const dependency = { kind: "file", path: logicalPath(root, message.file) };
          dependencies.set(JSON.stringify(dependency), dependency);
        } else if (message.type === "dir-dependency" && typeof message.dir === "string") {
          const dependency = {
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
    return {
      ok: true,
      configFile: logicalPath(root, config.file),
      stylesheets,
      observedDependencies: [...dependencies.values()],
      diagnostics,
    };
  } catch (caught) {
    const error = caught && typeof caught === "object" ? caught : { message: String(caught) };
    let file = currentFile;
    if (root && phase === "config" && !file) {
      for (const match of String(error.stack).matchAll(/(?:file:\/\/)?(\/[^\s():]+):\d+:\d+/g)) {
        try {
          const location = pathToFileURL(match[1].split("?")[0]);
          const candidate = fileURLToPath(location);
          if (inside(root, candidate)) {
            file = logicalPath(root, candidate);
            break;
          }
        } catch {
          /* Stack entries are not necessarily file URLs. */
        }
      }
    }
    if (root && typeof error.file === "string") {
      try {
        file = logicalPath(root, error.file);
      } catch {
        /* Keep the entry when a plugin reports an inaccessible file. */
      }
    }
    return {
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
    };
  } finally {
    process.chdir(cwd);
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
  }
}
