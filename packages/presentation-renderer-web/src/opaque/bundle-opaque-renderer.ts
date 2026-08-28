import { rolldown, type RolldownBuild, type RolldownOutput } from "rolldown";

export type OpaqueRendererModuleType = "asset" | "css" | "js" | "jsx" | "json" | "ts" | "tsx";

export type OpaqueRendererModule = {
  readonly path: string;
  readonly source: string;
  readonly moduleType: OpaqueRendererModuleType;
};

export type OpaqueRendererBundleInput = {
  readonly entry: string;
  readonly modules: readonly OpaqueRendererModule[];
};

export type OpaqueBundleDiagnostic = {
  readonly code:
    | "opaque-bundle-failed"
    | "opaque-bundle-input-invalid"
    | "opaque-import-denied"
    | "opaque-module-not-found";
  readonly path: readonly string[];
  readonly message: string;
};

export type OpaqueRendererBundleResult =
  | {
      readonly ok: true;
      readonly javascript: string;
      readonly assets: readonly {
        readonly fileName: string;
        readonly source: string | Uint8Array;
      }[];
      readonly externalImports: readonly string[];
      readonly diagnostics: [];
    }
  | { readonly ok: false; readonly diagnostics: readonly OpaqueBundleDiagnostic[] };

type ModuleSnapshot = Readonly<OpaqueRendererModule>;

const VIRTUAL_PREFIX = "\0unframe:opaque/";
const RUNTIME_ID = "\0unframe:renderer-runtime";
const RUNTIME_SPECIFIER = "@unframe/renderer-runtime";
const RUNTIME_SOURCE = "export const defineOpaqueRenderer = (renderer) => renderer;";
const externalImports = new Set(["react", "react/jsx-runtime"]);
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".json", ".css"] as const;
const assetExtensions = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);
const sourceTypeExtensions: Record<
  Exclude<OpaqueRendererModuleType, "asset">,
  readonly string[]
> = {
  css: [".css"],
  js: [".js"],
  jsx: [".jsx"],
  json: [".json"],
  ts: [".ts"],
  tsx: [".tsx"],
};
const deniedConfigPattern = /(?:^|\/)(?:postcss|rolldown|tailwind|vite)\.config\.[^/]+$/;
const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const failure = (
  code: OpaqueBundleDiagnostic["code"],
  path: readonly string[],
  message: string,
): OpaqueRendererBundleResult => ({ ok: false, diagnostics: [{ code, path, message }] });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const ownData = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | undefined => {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]))
    return undefined;
  if (expectedKeys.some((key) => descriptors[key]?.get || descriptors[key]?.set)) return undefined;
  return Object.fromEntries(expectedKeys.map((key) => [key, descriptors[key]?.value]));
};

const extensionOf = (path: string) => {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const index = fileName.lastIndexOf(".");
  return index < 0 ? "" : fileName.slice(index).toLowerCase();
};

const validModulePath = (path: string) =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.includes(":") &&
  !path.includes("?") &&
  !path.includes("#") &&
  !deniedConfigPattern.test(path) &&
  path
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== ".." && segment !== "node_modules",
    );

const validModuleType = (path: string, moduleType: OpaqueRendererModuleType) => {
  const extension = extensionOf(path);
  return moduleType === "asset"
    ? assetExtensions.has(extension)
    : sourceTypeExtensions[moduleType].includes(extension);
};

const snapshotInputUnchecked = (
  input: unknown,
): { entry: string; modules: ReadonlyMap<string, ModuleSnapshot> } | undefined => {
  const record = ownData(input, ["entry", "modules"]);
  if (!record || typeof record.entry !== "string" || !Array.isArray(record.modules))
    return undefined;
  const moduleValues = record.modules;
  if (
    Object.keys(moduleValues).length !== moduleValues.length ||
    [...Array(moduleValues.length).keys()].some((index) => !Object.hasOwn(moduleValues, index))
  )
    return undefined;

  const modules = new Map<string, ModuleSnapshot>();
  for (const value of moduleValues) {
    const item = ownData(value, ["moduleType", "path", "source"]);
    if (
      !item ||
      typeof item.path !== "string" ||
      typeof item.source !== "string" ||
      (item.moduleType !== "asset" &&
        item.moduleType !== "css" &&
        item.moduleType !== "js" &&
        item.moduleType !== "jsx" &&
        item.moduleType !== "json" &&
        item.moduleType !== "ts" &&
        item.moduleType !== "tsx") ||
      !validModulePath(item.path) ||
      !validModuleType(item.path, item.moduleType) ||
      modules.has(item.path)
    )
      return undefined;
    modules.set(
      item.path,
      Object.freeze({ path: item.path, source: item.source, moduleType: item.moduleType }),
    );
  }
  if (!validModulePath(record.entry) || !modules.has(record.entry)) return undefined;
  const entry = modules.get(record.entry);
  if (!entry || entry.moduleType === "asset" || entry.moduleType === "css") return undefined;
  return { entry: record.entry, modules };
};

const snapshotInput = (input: unknown) => {
  try {
    return snapshotInputUnchecked(input);
  } catch {
    return undefined;
  }
};

const resolveRelativePath = (importerPath: string, specifier: string) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  if (
    specifier.includes("\\") ||
    specifier.includes(":") ||
    specifier.includes("?") ||
    specifier.includes("#")
  )
    return undefined;
  const segments = importerPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
};

const resolvedModulePath = (path: string, modules: ReadonlyMap<string, ModuleSnapshot>) => {
  if (modules.has(path)) return path;
  if (extensionOf(path) !== "") return undefined;
  for (const extension of sourceExtensions)
    if (modules.has(`${path}${extension}`)) return `${path}${extension}`;
  return undefined;
};

const cssReferences = (source: string) => {
  const references: string[] = [];
  for (const pattern of [
    /@import\s+(?:url\(\s*)?["']([^"']+)["']/g,
    /url\(\s*["']?([^"')]+)["']?\s*\)/g,
  ])
    for (const match of source.matchAll(pattern)) if (match[1]) references.push(match[1]);
  return references;
};

const invalidCssReference = (snapshot: {
  entry: string;
  modules: ReadonlyMap<string, ModuleSnapshot>;
}): OpaqueBundleDiagnostic | undefined => {
  for (const item of snapshot.modules.values()) {
    if (item.moduleType !== "css") continue;
    for (const specifier of cssReferences(item.source)) {
      const relativePath = resolveRelativePath(item.path, specifier);
      const target = relativePath === undefined ? undefined : snapshot.modules.get(relativePath);
      if (!target || (target.moduleType !== "asset" && target.moduleType !== "css"))
        return {
          code: "opaque-import-denied",
          path: [item.path, specifier],
          message: `CSS reference is outside the locked package: ${specifier}`,
        };
    }
  }
  return undefined;
};

const copyAssetSource = (source: string | Uint8Array) =>
  typeof source === "string" ? source : new Uint8Array(source);

const resultFromOutput = (output: RolldownOutput): OpaqueRendererBundleResult => {
  const chunks = output.output.filter((item) => item.type === "chunk");
  if (chunks.length !== 1)
    return failure(
      "opaque-bundle-failed",
      [],
      "Opaque renderer must produce one JavaScript chunk.",
    );
  const chunk = chunks[0];
  if (!chunk) return failure("opaque-bundle-failed", [], "Opaque renderer output is missing.");
  const imports = [...new Set(chunk.imports)].sort();
  if (imports.some((specifier) => !externalImports.has(specifier)))
    return failure(
      "opaque-bundle-failed",
      [],
      "Opaque renderer emitted an unapproved external import.",
    );
  const assets = output.output
    .filter((item) => item.type === "asset")
    .map((asset) => ({ fileName: asset.fileName, source: copyAssetSource(asset.source) }))
    .sort((left, right) => compareStrings(left.fileName, right.fileName));
  return {
    ok: true,
    javascript: chunk.code,
    assets,
    externalImports: imports,
    diagnostics: [],
  };
};

export const bundleOpaqueRenderer = async (input: unknown): Promise<OpaqueRendererBundleResult> => {
  const snapshot = snapshotInput(input);
  if (!snapshot)
    return failure(
      "opaque-bundle-input-invalid",
      [],
      "Opaque bundle input must be a locked TS/TSX/JS/JSX/JSON/CSS/asset module set.",
    );
  const cssFailure = invalidCssReference(snapshot);
  if (cssFailure) return { ok: false, diagnostics: [cssFailure] };

  let resolutionFailure: OpaqueBundleDiagnostic | undefined;
  let bundle: RolldownBuild | undefined;
  const rememberFailure = (
    code: OpaqueBundleDiagnostic["code"],
    path: readonly string[],
    message: string,
  ) => {
    resolutionFailure ??= { code, path, message };
    throw new Error(message);
  };

  try {
    const entryId = `${VIRTUAL_PREFIX}${snapshot.entry}`;
    bundle = await rolldown({
      input: entryId,
      platform: "browser",
      transform: { jsx: "react-jsx" },
      plugins: [
        {
          name: "unframe-opaque-modules",
          buildStart() {
            for (const item of snapshot.modules.values())
              if (item.moduleType === "asset" || item.moduleType === "css")
                this.emitFile({
                  type: "asset",
                  fileName: `assets/${item.path}`,
                  source: item.source,
                });
          },
          resolveId(specifier, importer) {
            if (specifier === entryId && importer === undefined) return entryId;
            if (externalImports.has(specifier)) return { id: specifier, external: true };
            if (specifier === RUNTIME_SPECIFIER) return RUNTIME_ID;
            if (!importer?.startsWith(VIRTUAL_PREFIX))
              return rememberFailure(
                "opaque-import-denied",
                [snapshot.entry, specifier],
                `Import is outside the locked package: ${specifier}`,
              );
            const importerPath = importer.slice(VIRTUAL_PREFIX.length);
            const relativePath = resolveRelativePath(importerPath, specifier);
            if (relativePath === undefined)
              return rememberFailure(
                "opaque-import-denied",
                [importerPath, specifier],
                `Import is not allowed: ${specifier}`,
              );
            const modulePath = resolvedModulePath(relativePath, snapshot.modules);
            if (modulePath === undefined)
              return rememberFailure(
                "opaque-module-not-found",
                [importerPath, specifier],
                `Locked package module was not found: ${specifier}`,
              );
            return `${VIRTUAL_PREFIX}${modulePath}`;
          },
          load(id) {
            if (id === RUNTIME_ID) return { code: RUNTIME_SOURCE, moduleType: "js" };
            if (!id.startsWith(VIRTUAL_PREFIX)) return null;
            const modulePath = id.slice(VIRTUAL_PREFIX.length);
            const item = snapshot.modules.get(modulePath);
            if (!item)
              return rememberFailure(
                "opaque-module-not-found",
                [modulePath],
                `Locked package module was not found: ${modulePath}`,
              );
            if (item.moduleType === "asset" || item.moduleType === "css")
              return {
                code: `export default ${JSON.stringify(`assets/${item.path}`)};`,
                moduleType: "js",
                moduleSideEffects: "no-treeshake",
              };
            return { code: item.source, moduleType: item.moduleType };
          },
        },
      ],
    });
    const output = await bundle.generate({
      format: "es",
      entryFileNames: "renderer.js",
      assetFileNames: "assets/[name]-[hash:16][extname]",
      codeSplitting: false,
      sourcemap: false,
    });
    return resultFromOutput(output);
  } catch {
    return resolutionFailure
      ? { ok: false, diagnostics: [resolutionFailure] }
      : failure("opaque-bundle-failed", [], "Rolldown could not bundle the opaque renderer.");
  } finally {
    await bundle?.close().catch(() => undefined);
  }
};
