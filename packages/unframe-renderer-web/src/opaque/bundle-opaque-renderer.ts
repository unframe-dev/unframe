import { rolldown, type RolldownBuild, type RolldownOutput } from "rolldown";

import {
  extensionOf,
  opaqueRendererBundleInputSchema,
  type OpaqueRendererModule,
} from "./input-schema.js";
import {
  copyUint8Array,
  snapshotDenseArray,
  snapshotStrictRecord,
} from "../validation/safe-data.js";

export type {
  OpaqueRendererBundleInput,
  OpaqueRendererModule,
  OpaqueRendererModuleType,
} from "./input-schema.js";

export type OpaqueBundleDiagnostic = {
  readonly code:
    | "opaque-bundle-failed"
    | "opaque-bundle-input-invalid"
    | "opaque-import-denied"
    | "opaque-module-not-found";
  readonly message: string;
  readonly path: ReadonlyArray<string>;
};

export type OpaqueRendererBundleResult =
  | {
      readonly assets: ReadonlyArray<{
        readonly fileName: string;
        readonly source: string | Uint8Array;
      }>;
      readonly diagnostics: [];
      readonly externalImports: ReadonlyArray<string>;
      readonly javascript: string;
      readonly ok: true;
      readonly stylesheets: ReadonlyArray<string>;
    }
  | { readonly diagnostics: ReadonlyArray<OpaqueBundleDiagnostic>; readonly ok: false };

type ModuleSnapshot = Readonly<OpaqueRendererModule>;

const VIRTUAL_PREFIX = "\0unframe:opaque/";
const RUNTIME_ID = "\0unframe:renderer-runtime";
const RUNTIME_SPECIFIER = "@unframe/renderer-runtime";
const RUNTIME_SOURCE = "export const defineOpaqueRenderer = (renderer) => renderer;";
const BOOTSTRAP_PATH = "__unframe__/bootstrap.ts";
const BOOTSTRAP_SOURCE = [
  'import * as React from "react";',
  'import { createRoot } from "react-dom/client";',
  'import { flushSync } from "react-dom";',
  'import { render } from "@unframe/renderer-entry";',
  "let root;",
  "globalThis.__unframeMount = (input) => {",
  '  const element = document.getElementById("unframe-root");',
  '  if (!element) throw new Error("Missing opaque renderer root.");',
  "  root ??= createRoot(element);",
  "  flushSync(() => root.render(React.createElement(render, input)));",
  "};",
].join("\n");
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"] as const;
const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const failure = (
  code: OpaqueBundleDiagnostic["code"],
  path: ReadonlyArray<string>,
  message: string,
): OpaqueRendererBundleResult => ({ diagnostics: [{ code, message, path }], ok: false });

const snapshotInputUnchecked = (
  input: unknown,
):
  | {
      ok: true;
      value: {
        entry: string;
        modules: ReadonlyMap<string, ModuleSnapshot>;
        rendererInputHash: string;
        resolutions: ReadonlyMap<string, string>;
        stylesheets: ReadonlyArray<string>;
      };
    }
  | { ok: false; path: ReadonlyArray<string> } => {
  const record = snapshotStrictRecord(input, [
    "entry",
    "rendererInputHash",
    "modules",
    "resolutions",
    "stylesheets",
  ]);
  if (!record) {
    return { ok: false, path: [] };
  }
  const moduleValues = snapshotDenseArray(record.modules);
  if (!moduleValues) {
    return { ok: false, path: ["modules"] };
  }
  const safeModules: Array<Record<string, unknown>> = [];
  for (const [index, value] of moduleValues.entries()) {
    const item = snapshotStrictRecord(value, ["moduleType", "path", "source"]);
    if (!item) {
      return { ok: false, path: ["modules", String(index)] };
    }
    const source = typeof item.source === "string" ? item.source : copyUint8Array(item.source);
    if (source === undefined) {
      return { ok: false, path: ["modules", String(index), "source"] };
    }
    safeModules.push({ ...item, source });
  }
  const resolutionValues = snapshotDenseArray(record.resolutions);
  if (!resolutionValues) {
    return { ok: false, path: ["resolutions"] };
  }
  const safeResolutions: Array<Record<string, unknown>> = [];
  for (const [index, value] of resolutionValues.entries()) {
    const item = snapshotStrictRecord(value, ["importerPath", "specifier", "kind", "targetPath"]);
    if (!item) {
      return { ok: false, path: ["resolutions", String(index)] };
    }
    safeResolutions.push(item);
  }
  const stylesheets = snapshotDenseArray(record.stylesheets);
  if (!stylesheets) {
    return { ok: false, path: ["stylesheets"] };
  }
  const parsed = opaqueRendererBundleInputSchema.safeParse({
    entry: record.entry,
    modules: safeModules,
    rendererInputHash: record.rendererInputHash,
    resolutions: safeResolutions,
    stylesheets,
  });
  if (!parsed.success) {
    return {
      ok: false,
      path: parsed.error.issues[0]?.path.map(String) ?? [],
    };
  }
  const modules = new Map<string, ModuleSnapshot>();
  for (const item of parsed.data.modules) {
    modules.set(item.path, Object.freeze(item));
  }
  const resolutions = new Map(
    parsed.data.resolutions.map((item) => [
      `${item.importerPath}\0${item.specifier}\0${item.kind}`,
      item.targetPath,
    ]),
  );
  return {
    ok: true,
    value: {
      entry: parsed.data.entry,
      modules,
      rendererInputHash: parsed.data.rendererInputHash,
      resolutions,
      stylesheets: parsed.data.stylesheets,
    },
  };
};

const snapshotInput = (input: unknown) => {
  try {
    return snapshotInputUnchecked(input);
  } catch {
    return { ok: false as const, path: [] };
  }
};

const resolveRelativePath = (importerPath: string, specifier: string) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return undefined;
  }
  if (
    specifier.includes("\\") ||
    specifier.includes(":") ||
    specifier.includes("?") ||
    specifier.includes("#")
  ) {
    return undefined;
  }
  const segments = importerPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
};

const resolvedModulePath = (path: string, modules: ReadonlyMap<string, ModuleSnapshot>) => {
  if (modules.has(path)) {
    return path;
  }
  if (extensionOf(path) !== "") {
    return undefined;
  }
  for (const extension of sourceExtensions) {
    if (modules.has(`${path}${extension}`)) {
      return `${path}${extension}`;
    }
  }
  return undefined;
};

const cssReferences = (source: string) => {
  const references: Array<string> = [];
  for (const pattern of [
    /@import\s+(?:url\(\s*)?["']([^"']+)["']/g,
    /url\(\s*["']?([^"')]+)["']?\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) references.push(match[1]);
    }
  }
  return references;
};

const invalidCssReference = (snapshot: {
  entry: string;
  modules: ReadonlyMap<string, ModuleSnapshot>;
}): OpaqueBundleDiagnostic | undefined => {
  for (const item of snapshot.modules.values()) {
    if (item.moduleType !== "css") {
      continue;
    }
    for (const specifier of cssReferences(item.source)) {
      const relativePath = resolveRelativePath(
        item.path,
        specifier.startsWith(".") ? specifier : `./${specifier}`,
      );
      const target = relativePath === undefined ? undefined : snapshot.modules.get(relativePath);
      if (!target || (target.moduleType !== "asset" && target.moduleType !== "css")) {
        return {
          code: "opaque-import-denied",
          message: `CSS reference is outside the locked package: ${specifier}`,
          path: [item.path, specifier],
        };
      }
    }
  }
  return undefined;
};

const copyAssetSource = (source: string | Uint8Array) =>
  typeof source === "string" ? source : new Uint8Array(source);

const validAssetSignature = (path: string, source: string | Uint8Array) => {
  if (!(source instanceof Uint8Array)) {
    return false;
  }
  const extension = extensionOf(path);
  if (extension === ".png") {
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => source[index] === byte);
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff;
  }
  if (extension === ".webp") {
    return (
      source.length >= 21 &&
      String.fromCharCode(...source.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...source.slice(8, 12)) === "WEBP" &&
      !(String.fromCharCode(...source.slice(12, 16)) === "VP8X" && (source[20]! & 2) !== 0)
    );
  }
  if (extension === ".ttf") {
    return source[0] === 0 && source[1] === 1 && source[2] === 0 && source[3] === 0;
  }
  if (extension === ".otf") {
    return String.fromCharCode(...source.slice(0, 4)) === "OTTO";
  }
  return false;
};

const resultFromOutput = (
  output: RolldownOutput,
  stylesheets: ReadonlyArray<string>,
): OpaqueRendererBundleResult => {
  const chunks = output.output.filter((item) => item.type === "chunk");
  if (chunks.length !== 1) {
    return failure(
      "opaque-bundle-failed",
      [],
      "Opaque renderer must produce one JavaScript chunk.",
    );
  }
  const chunk = chunks[0];
  if (!chunk) {
    return failure("opaque-bundle-failed", [], "Opaque renderer output is missing.");
  }
  const imports = [...new Set(chunk.imports)].sort();
  if (imports.length) {
    return failure("opaque-bundle-failed", [], "Opaque renderer emitted an external import.");
  }
  const assets = output.output
    .filter((item) => item.type === "asset")
    .map((asset) => ({ fileName: asset.fileName, source: copyAssetSource(asset.source) }))
    .sort((left, right) => compareStrings(left.fileName, right.fileName));
  return {
    assets,
    diagnostics: [],
    externalImports: [],
    javascript: chunk.code,
    ok: true,
    stylesheets: stylesheets.map((path) => `assets/${path}`),
  };
};

export const bundleOpaqueRenderer = async (input: unknown): Promise<OpaqueRendererBundleResult> => {
  const snapshotResult = snapshotInput(input);
  if (!snapshotResult.ok) {
    return failure(
      "opaque-bundle-input-invalid",
      snapshotResult.path,
      "Opaque bundle input must be a locked TS/TSX/JS/JSX/JSON/CSS/asset module set.",
    );
  }
  const snapshot = snapshotResult.value;
  for (const item of snapshot.modules.values()) {
    if (item.moduleType === "asset" && !validAssetSignature(item.path, item.source)) {
      return failure(
        "opaque-bundle-input-invalid",
        ["modules", item.path, "source"],
        "Opaque asset signature is invalid.",
      );
    }
  }
  const cssFailure = invalidCssReference(snapshot);
  if (cssFailure) {
    return { diagnostics: [cssFailure], ok: false };
  }

  let resolutionFailure: OpaqueBundleDiagnostic | undefined;
  let bundle: RolldownBuild | undefined;
  const rememberFailure = (
    code: OpaqueBundleDiagnostic["code"],
    path: ReadonlyArray<string>,
    message: string,
  ) => {
    resolutionFailure ??= { code, message, path };
    throw new Error(message);
  };

  try {
    const entryId = `${VIRTUAL_PREFIX}${BOOTSTRAP_PATH}`;
    bundle = await rolldown({
      input: entryId,
      platform: "browser",
      plugins: [
        {
          buildStart() {
            for (const item of snapshot.modules.values())
              if (item.moduleType === "asset" || item.moduleType === "css")
                this.emitFile({
                  type: "asset",
                  fileName: `assets/${item.path}`,
                  source: item.source,
                });
          },
          load(id) {
            if (id === RUNTIME_ID) return { code: RUNTIME_SOURCE, moduleType: "js" };
            if (id === entryId) return { code: BOOTSTRAP_SOURCE, moduleType: "ts" };
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
          name: "unframe-opaque-modules",
          resolveId(specifier, importer, options) {
            if (specifier === entryId && importer === undefined) return entryId;
            if (specifier === "@unframe/renderer-entry" && importer === entryId)
              return `${VIRTUAL_PREFIX}${snapshot.entry}`;
            if (specifier === RUNTIME_SPECIFIER) return RUNTIME_ID;
            if (!importer?.startsWith(VIRTUAL_PREFIX))
              return rememberFailure(
                "opaque-import-denied",
                [snapshot.entry, specifier],
                `Import is outside the locked package: ${specifier}`,
              );
            const importerPath = importer.slice(VIRTUAL_PREFIX.length);
            const kind = options.kind === "require-call" ? "require" : "import";
            if (
              options.kind === "dynamic-import" ||
              options.kind === "new-url" ||
              options.kind === "hot-accept"
            )
              return rememberFailure(
                "opaque-import-denied",
                [importerPath, specifier],
                `Dynamic import is not allowed: ${specifier}`,
              );
            const lockedPath = snapshot.resolutions.get(`${importerPath}\0${specifier}\0${kind}`);
            if (lockedPath !== undefined) return `${VIRTUAL_PREFIX}${lockedPath}`;
            const relativePath = resolveRelativePath(importerPath, specifier);
            if (relativePath === undefined)
              return rememberFailure(
                "opaque-import-denied",
                [importerPath, specifier],
                `Import is not locked: ${specifier}`,
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
        },
      ],
      transform: {
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        jsx: "react-jsx",
      },
    });
    const output = await bundle.generate({
      assetFileNames: "assets/[name]-[hash:16][extname]",
      codeSplitting: false,
      entryFileNames: "renderer.js",
      format: "iife",
      sourcemap: false,
    });
    return resultFromOutput(output, snapshot.stylesheets);
  } catch {
    return resolutionFailure
      ? { diagnostics: [resolutionFailure], ok: false }
      : failure("opaque-bundle-failed", [], "Rolldown could not bundle the opaque renderer.");
  } finally {
    await bundle?.close().catch(() => undefined);
  }
};
