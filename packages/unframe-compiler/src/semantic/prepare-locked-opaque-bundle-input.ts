import * as ts from "typescript";
import type { ValidationResult } from "@unframe/unframe-core";
import type { CompilerDeclarationProject } from "../api/types.js";
import { parseAuthoringProject } from "../project/parse-authoring-project.js";
import type { ParsedLockedPackage } from "../project/parse-locked-packages.js";

type OpaqueComponent = Extract<
  CompilerDeclarationProject["components"][number],
  { rendererSource: string }
>;
type ModuleType = "asset" | "css" | "js" | "jsx" | "json" | "ts" | "tsx";
export type LockedOpaqueBundleInput = {
  readonly entry: "__unframe__/entry.tsx";
  readonly modules: ReadonlyArray<{
    readonly moduleType: ModuleType;
    readonly path: string;
    readonly source: string | Uint8Array;
  }>;
  readonly rendererInputHash: string;
  readonly resolutions: ReadonlyArray<{
    readonly importerPath: string;
    readonly kind: "import" | "require";
    readonly specifier: string;
    readonly targetPath: string;
  }>;
  readonly stylesheets: ReadonlyArray<string>;
};

const ENTRY = "__unframe__/entry.tsx" as const;
const BOOTSTRAP = "__unframe__/bootstrap.ts";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const packageName = (specifier: string) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
const extension = (path: string) => path.slice(path.lastIndexOf(".")).toLowerCase();
const moduleType = (path: string): ModuleType => {
  const ext = extension(path);
  if (ext === ".ts") {
    return "ts";
  }
  if (ext === ".tsx") {
    return "tsx";
  }
  if (ext === ".jsx") {
    return "jsx";
  }
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return "js";
  }
  if (ext === ".json") {
    return "json";
  }
  if (ext === ".css") {
    return "css";
  }
  if ([".png", ".jpg", ".jpeg", ".webp", ".ttf", ".otf"].includes(ext)) {
    return "asset";
  }
  throw new Error(`Unsupported opaque module: ${path}`);
};
const assetMediaType = (path: string) => {
  const ext = extension(path);
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".ttf") {
    return "font/ttf";
  }
  if (ext === ".otf") {
    return "font/otf";
  }
  return undefined;
};
const decode = (encoding: "utf8" | "base64", data: string) =>
  encoding === "utf8"
    ? new TextEncoder().encode(data)
    : Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
const normalized = (from: string, specifier: string) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    throw new Error(`Not a relative specifier: ${specifier}`);
  }
  const segments = from.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (!segments.length) {
        throw new Error(`Import escapes locked root: ${specifier}`);
      }
      segments.pop();
    } else if (segment && !/[\\?#:\0]/.test(segment)) {
      segments.push(segment);
    } else {
      throw new Error(`Invalid relative specifier: ${specifier}`);
    }
  }
  return segments.join("/");
};
const candidates = (path: string) => [
  path,
  `${path}.ts`,
  `${path}.tsx`,
  `${path}.js`,
  `${path}.jsx`,
  `${path}.mjs`,
  `${path}.cjs`,
  `${path}.json`,
  `${path}.css`,
  `${path}/index.ts`,
  `${path}/index.tsx`,
  `${path}/index.js`,
  `${path}/index.mjs`,
  `${path}/index.cjs`,
  ...(path.endsWith(".js") ? [path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx")] : []),
];
const imports = (path: string, source: string) => {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<{ kind: "import" | "require"; specifier: string }> = [];
  let jsx = false;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      jsx = true;
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      !(ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly)
    ) {
      found.push({ kind: "import", specifier: node.moduleSpecifier.text });
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        throw new Error(`Dynamic import is unsupported: ${path}`);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const arg = node.arguments[0];
        if (node.arguments.length !== 1 || !arg || !ts.isStringLiteralLike(arg)) {
          throw new Error(`Dynamic require is unsupported: ${path}`);
        }
        found.push({ kind: "require", specifier: arg.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (jsx) {
    found.push({ kind: "import", specifier: "react/jsx-runtime" });
  }
  return found;
};
const cssImports = (source: string) =>
  [
    ...source.matchAll(
      /(?:@import\s+(?:url\(\s*)?["']([^"']+)["']|url\(\s*["']?([^"')\s]+)["']?\s*\))/g,
    ),
  ].map((match) => ({ kind: "import" as const, specifier: match[1] ?? match[2]! }));

export const prepareLockedOpaqueBundleInput = (
  sourceInput: unknown,
  component: OpaqueComponent,
): ValidationResult<LockedOpaqueBundleInput> => {
  const parsed = parseAuthoringProject(sourceInput);
  if (!parsed.ok) {
    return {
      diagnostics: parsed.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        path: [item.fileName],
      })),
      valid: false,
    };
  }
  try {
    const source = parsed.value;
    const packages = new Map(source.packages.map((pkg) => [pkg.key, pkg]));
    const modules = new Map<string, LockedOpaqueBundleInput["modules"][number]>();
    const resolutions = new Map<string, LockedOpaqueBundleInput["resolutions"][number]>();
    const stylesheets: Array<string> = [];
    const packageManifests = new Map<string, Record<string, unknown>>();
    const packagePrefix = (pkg: ParsedLockedPackage) => `packages/${pkg.key.slice(7)}`;
    const manifestFor = (pkg: ParsedLockedPackage) => {
      const cached = packageManifests.get(pkg.key);
      if (cached) {
        return cached;
      }
      const raw = pkg.rawFiles["package.json"];
      if (!raw) {
        return {};
      }
      if (raw.encoding !== "utf8" || raw.mediaType !== "application/json") {
        throw new Error(`Locked package manifest is invalid: ${pkg.name}`);
      }
      const parsed: unknown = JSON.parse(raw.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Locked package manifest is invalid: ${pkg.name}`);
      }
      const manifest = parsed as Record<string, unknown>;
      packageManifests.set(pkg.key, manifest);
      return manifest;
    };
    const browserPath = (pkg: ParsedLockedPackage, path: string) => {
      const browser = manifestFor(pkg).browser;
      if (!browser || typeof browser !== "object" || Array.isArray(browser)) {
        return path;
      }
      const mapped = (browser as Record<string, unknown>)[`./${path}`];
      if (mapped === undefined) {
        return path;
      }
      if (typeof mapped !== "string" || !mapped.startsWith("./")) {
        throw new Error(`Reachable browser mapping is unsupported: ${pkg.name}/${path}`);
      }
      const target = mapped.slice(2);
      if (!Object.hasOwn(pkg.rawFiles, target)) {
        throw new Error(`Browser mapping target is not locked: ${pkg.name}/${target}`);
      }
      return target;
    };
    const conditionalAlias = (
      value: unknown,
      kind: "import" | "require",
    ): string | null | undefined => {
      if (value === null) {
        return null;
      }
      if (typeof value === "string") {
        return value;
      }
      if (Array.isArray(value)) {
        for (const candidate of value) {
          const selected = conditionalAlias(candidate, kind);
          if (selected !== undefined) {
            return selected;
          }
        }
        return undefined;
      }
      if (!value || typeof value !== "object") {
        return undefined;
      }
      const active = new Set(["browser", "production", "default", kind]);
      for (const [condition, branch] of Object.entries(value)) {
        if (!active.has(condition)) {
          continue;
        }
        const selected = conditionalAlias(branch, kind);
        if (selected !== undefined) {
          return selected;
        }
      }
      return undefined;
    };
    const getPackage = (key: string) => {
      const pkg = packages.get(key);
      if (!pkg) {
        throw new Error(`Locked package is missing: ${key}`);
      }
      return pkg;
    };
    const locatePackage = (specifier: string, owner?: ParsedLockedPackage) => {
      if (specifier === "@unframe/unframe-authoring") {
        throw new Error("Public Component contract may not be bundled.");
      }
      if (
        !/^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)(?:\/[A-Za-z0-9._/-]+)?$/u.test(specifier)
      ) {
        throw new Error(`Runtime import is not a package specifier: ${specifier}`);
      }
      const name = packageName(specifier);
      const edge = (owner ? owner.dependencies : source.rootDependencies).find(
        (item) => item.specifier === name && item.usage === "runtime",
      );
      if (owner?.name !== name && !edge) {
        throw new Error(`Runtime dependency is not locked: ${specifier}`);
      }
      const pkg = owner?.name === name ? owner : getPackage(edge!.packageKey);
      const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
      const exported = pkg.exports.find((item) => item.subpath === subpath);
      if (!exported) {
        throw new Error(`Package export is not locked: ${specifier}`);
      }
      return { exported, pkg };
    };
    const resolveSource = (file: string, owner?: ParsedLockedPackage) => {
      const files = owner
        ? owner.rawFiles
        : {
            ...source.rawFiles,
            ...Object.fromEntries(
              Object.entries(source.files).map(([name, value]) => [
                name,
                {
                  data: value.text,
                  encoding: "utf8",
                  hash: "",
                  mediaType: "text/typescript",
                  path: name,
                },
              ]),
            ),
          };
      const found = candidates(file).find((name) => Object.hasOwn(files, name));
      if (!found) {
        throw new Error(`Locked module was not found: ${file}`);
      }
      return found;
    };
    const visit = (
      logicalPath: string,
      owner?: ParsedLockedPackage,
      sourceOverride?: string,
      origin?: string,
    ): string => {
      const path = owner
        ? `${packagePrefix(owner)}/${logicalPath}`
        : logicalPath === ENTRY
          ? ENTRY
          : `project/${logicalPath}`;
      if (modules.has(path)) {
        return path;
      }
      const raw = owner ? owner.rawFiles[logicalPath] : source.rawFiles[logicalPath];
      const text =
        sourceOverride ??
        (owner ? owner.files[logicalPath]?.text : source.files[logicalPath]?.text) ??
        (raw?.encoding === "utf8" ? raw.data : undefined);
      const kind = moduleType(logicalPath);
      if (text === undefined && (!raw || kind !== "asset")) {
        throw new Error(`Locked module bytes are missing: ${logicalPath}`);
      }
      if (kind === "asset" && raw?.mediaType !== assetMediaType(logicalPath)) {
        throw new Error(`Locked asset media type does not match its path: ${logicalPath}`);
      }
      if (kind === "css" && raw?.mediaType !== "text/css") {
        throw new Error(`Locked CSS media type is invalid: ${logicalPath}`);
      }
      const bytes = kind === "asset" ? decode(raw!.encoding, raw!.data) : text!;
      modules.set(path, { moduleType: kind, path, source: bytes });
      const dependencies =
        kind === "css" ? cssImports(text!) : kind === "asset" ? [] : imports(logicalPath, text!);
      for (const dependency of dependencies) {
        const specifier = dependency.specifier;
        const key = `${path}\0${specifier}\0${dependency.kind}`;
        if (resolutions.has(key)) {
          continue;
        }
        let targetPath: string;
        if (specifier.startsWith(".") || kind === "css") {
          const localSpecifier =
            kind === "css" && !specifier.startsWith(".") ? `./${specifier}` : specifier;
          const relativeTarget = normalized(origin ?? logicalPath, localSpecifier);
          const resolvedTarget = resolveSource(relativeTarget, owner);
          const logicalTarget = owner
            ? resolveSource(browserPath(owner, resolvedTarget), owner)
            : resolvedTarget;
          if (
            !owner &&
            /(?:\.component\.tsx|\.manifest\.ts|\.structure\.tsx|\.unframe\.tsx?)$/u.test(
              logicalTarget,
            )
          ) {
            throw new Error(
              `Render dependency cannot load a public contract module: ${logicalTarget}`,
            );
          }
          targetPath = visit(logicalTarget, owner);
        } else if (specifier.startsWith("#")) {
          if (!owner) {
            throw new Error(`Package alias cannot be used by a local renderer: ${specifier}`);
          }
          const aliases = manifestFor(owner).imports;
          const mapped =
            aliases && typeof aliases === "object" && !Array.isArray(aliases)
              ? conditionalAlias((aliases as Record<string, unknown>)[specifier], dependency.kind)
              : undefined;
          if (!mapped) {
            throw new Error(`Package alias has no locked browser target: ${specifier}`);
          }
          if (mapped.startsWith("./")) {
            const aliasTarget = resolveSource(normalized("package.json", mapped), owner);
            const target = resolveSource(browserPath(owner, aliasTarget), owner);
            targetPath = visit(target, owner);
          } else {
            const { exported, pkg } = locatePackage(mapped, owner);
            const target =
              dependency.kind === "require" ? exported.runtimeRequire : exported.runtimeImport;
            if (!target) {
              throw new Error(`Package alias runtime target is not locked: ${specifier}`);
            }
            targetPath = visit(target, pkg);
          }
        } else {
          const { exported, pkg } = locatePackage(specifier, owner);
          const target =
            dependency.kind === "require" ? exported.runtimeRequire : exported.runtimeImport;
          if (!target) {
            throw new Error(`Runtime ${dependency.kind} export is not locked: ${specifier}`);
          }
          targetPath = visit(target, pkg);
        }
        if (
          kind !== "css" &&
          modules.get(targetPath)?.moduleType === "css" &&
          !stylesheets.includes(targetPath)
        ) {
          stylesheets.push(targetPath);
        }
        resolutions.set(key, { importerPath: path, kind: dependency.kind, specifier, targetPath });
      }
      return path;
    };
    visit(
      ENTRY,
      undefined,
      component.rendererSource,
      component.lock.origin.kind === "local" ? component.lock.origin.entryFile : undefined,
    );
    for (const specifier of ["react", "react-dom", "react-dom/client"]) {
      const { exported, pkg } = locatePackage(specifier);
      if (!exported.runtimeImport) {
        throw new Error(`Runtime import export is not locked: ${specifier}`);
      }
      const targetPath = visit(exported.runtimeImport, pkg);
      resolutions.set(`${BOOTSTRAP}\0${specifier}\0import`, {
        importerPath: BOOTSTRAP,
        kind: "import",
        specifier,
        targetPath,
      });
    }
    return {
      diagnostics: [],
      valid: true,
      value: {
        entry: ENTRY,
        modules: [...modules.values()].sort((a, b) => compare(a.path, b.path)),
        rendererInputHash: component.lock.rendererInputHash,
        resolutions: [...resolutions.values()].sort((a, b) =>
          compare(
            `${a.importerPath}\0${a.specifier}\0${a.kind}`,
            `${b.importerPath}\0${b.specifier}\0${b.kind}`,
          ),
        ),
        stylesheets,
      },
    };
  } catch (error) {
    return {
      diagnostics: [
        {
          code: "compiler-opaque-bundle-input-invalid",
          message:
            error instanceof Error ? error.message : "Opaque bundle input could not be prepared.",
          path: [],
        },
      ],
      valid: false,
    };
  }
};
