import * as ts from "typescript";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { hashCanonicalJsonPayload, type ValidationResult } from "@unframe/unframe-core";
import type { DeclarationProjectComponentLock } from "../api/types.js";
import type { PairedAuthoringDeclarationCatalog } from "../project/pair-authoring-declarations.js";
import {
  parseAuthoringProject,
  type ParsedAuthoringProjectValue,
} from "../project/parse-authoring-project.js";
import {
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
} from "./declaration-hashes.js";

const hashText = (text: string) => `sha256:${bytesToHex(sha256(new TextEncoder().encode(text)))}`;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const packageName = (specifier: string) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
const relativePath = (from: string, specifier: string) => {
  const segments = from.split("/").slice(0, -1);
  if (!specifier.startsWith(".") || specifier.includes("\\") || specifier.includes("\0"))
    throw new Error("Only relative local imports are supported.");
  for (const segment of specifier.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new Error("Local import escapes project root.");
      segments.pop();
    } else if (segment) segments.push(segment);
    else throw new Error("Invalid local import path.");
  }
  return segments.join("/");
};
const imports = (file: ts.SourceFile, runtimeOnly: boolean): string[] => {
  const result: string[] = [];
  const checkDynamic = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    )
      throw new Error("Component input graph must use static imports.");
    ts.forEachChild(node, checkDynamic);
  };
  checkDynamic(file);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    if (
      runtimeOnly &&
      ((ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(statement) && statement.isTypeOnly))
    )
      continue;
    if (statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier))
      result.push(statement.moduleSpecifier.text);
  }
  return result;
};
const fileClosure = (
  source: Pick<ParsedAuthoringProjectValue, "files" | "rawFiles">,
  roots: readonly string[],
  runtimeOnly = false,
) => {
  const paths = new Set<string>();
  const bare = new Set<string>();
  const resolve = (from: string, specifier: string) => {
    const path = relativePath(from, specifier);
    const candidates = [
      path,
      `${path}.ts`,
      `${path}.tsx`,
      `${path}.d.ts`,
      `${path}/index.ts`,
      `${path}/index.tsx`,
      `${path}/index.d.ts`,
    ];
    if (path.endsWith(".js"))
      candidates.push(path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx"));
    const resolved = candidates.find(
      (candidate) =>
        Object.hasOwn(source.files, candidate) || Object.hasOwn(source.rawFiles, candidate),
    );
    if (resolved === undefined)
      throw new Error(`Local import must resolve exactly once: ${from}: ${specifier}`);
    return resolved;
  };
  const visit = (path: string): void => {
    if (paths.has(path)) return;
    const file = source.files[path];
    const raw = source.rawFiles[path];
    if (!file && !raw) throw new Error(`Component input is missing: ${path}`);
    paths.add(path);
    const references = file
      ? imports(file, runtimeOnly)
      : raw?.mediaType === "text/javascript" && raw.encoding === "utf8"
        ? imports(ts.createSourceFile(path, raw.data, ts.ScriptTarget.ES2022, true), runtimeOnly)
        : raw?.mediaType === "text/css" && raw.encoding === "utf8"
          ? [
              ...raw.data.matchAll(
                /(?:@import\s+["']([^"']+)["']|url\(\s*["']?([^"')\s]+)["']?\s*\))/g,
              ),
            ].map((match) => match[1] ?? match[2]!)
          : [];
    for (const specifier of references) {
      if (specifier.startsWith(".")) visit(resolve(path, specifier));
      else if (raw?.mediaType === "text/css") {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(specifier))
          throw new Error("CSS assets must use local relative references.");
        visit(resolve(path, `./${specifier}`));
      } else bare.add(specifier);
    }
  };
  roots.forEach(visit);
  return {
    files: [...paths].sort(compare).map((path) => ({
      path,
      hash: source.files[path] ? hashText(source.files[path]!.text) : source.rawFiles[path]!.hash,
    })),
    bare: [...bare].sort(compare),
  };
};
const runtimeGraph = (
  source: ParsedAuthoringProjectValue,
  specifiers: readonly string[],
  dependencies = source.rootDependencies,
) => {
  const packages = new Map(source.packages.map((pkg) => [pkg.key, pkg]));
  const reached = new Set<string>();
  const visit = (key: string): void => {
    if (reached.has(key)) return;
    const pkg = packages.get(key);
    if (!pkg) throw new Error("Runtime package is not locked.");
    reached.add(key);
    pkg.dependencies
      .filter((edge) => edge.usage === "runtime")
      .forEach((edge) => visit(edge.packageKey));
  };
  for (const specifier of specifiers) {
    const name = packageName(specifier);
    const edge = dependencies.find((edge) => edge.usage === "runtime" && edge.specifier === name);
    const pkg = edge && packages.get(edge.packageKey);
    const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
    if (!pkg?.exports.some((entry) => entry.subpath === subpath && entry.runtimeImport !== null))
      throw new Error(`Runtime import export is not locked: ${specifier}`);
  }
  const roots = [...new Set(specifiers.map(packageName))].sort(compare).map((specifier) => {
    const edge = dependencies.find(
      (edge) => edge.usage === "runtime" && edge.specifier === specifier,
    );
    if (!edge) throw new Error(`Runtime dependency is not locked: ${specifier}`);
    visit(edge.packageKey);
    return edge;
  });
  return {
    roots,
    packages: [...reached].sort(compare).map((key) => {
      const pkg = packages.get(key)!;
      return {
        key,
        locator: pkg.locator,
        contentIntegrity: pkg.contentIntegrity,
        dependencies: pkg.dependencies.filter((edge) => edge.usage === "runtime"),
      };
    }),
  };
};

/** Recomputes local closures and render inputs from an already checked, non-executed catalog. */
export const computeFrozenComponentInputs = (
  input: unknown,
  catalog: PairedAuthoringDeclarationCatalog,
): ValidationResult<{
  componentLocks: readonly DeclarationProjectComponentLock[];
  themeHashes: readonly { themeId: string; hash: string }[];
}> => {
  const parsed = parseAuthoringProject(input);
  if (!parsed.ok)
    return {
      valid: false,
      diagnostics: parsed.diagnostics.map((d) => ({
        code: d.code,
        message: d.message,
        path: [d.fileName],
      })),
    };
  try {
    const source = parsed.value;
    const componentLocks: DeclarationProjectComponentLock[] = catalog.components.map(
      (component) => {
        const manifest = component.manifest.value;
        const entryFile = component.manifest.fileName;
        const structured = "structure" in component;
        const packageOrigin = source.packages.flatMap((pkg) =>
          pkg.exports
            .filter((entry) => {
              const target = entry.runtimeImport?.endsWith(".component.tsx")
                ? entry.runtimeImport
                : (entry.types ?? entry.runtimeImport);
              return target !== null && entryFile === `${pkg.name}@${pkg.version}/${target}`;
            })
            .map((entry) => ({
              kind: "package" as const,
              packageKey: pkg.key,
              subpath: entry.subpath,
            })),
        );
        if (packageOrigin.length > 1)
          throw new Error("Component package origin must name exactly one export.");
        if (source.files[entryFile] && packageOrigin.length)
          throw new Error(
            "Component origin is ambiguous between local source and a package export.",
          );
        if (!source.files[entryFile] && packageOrigin.length === 0)
          throw new Error(
            "Component origins outside local source require an explicit package export.",
          );
        const origin =
          packageOrigin[0] ??
          (() => {
            const closure = fileClosure(
              source,
              structured ? [entryFile, component.structure.fileName] : [entryFile],
            );
            return {
              kind: "local" as const,
              entryFile,
              files: closure.files,
              sourceHash: hashCanonicalJsonPayload({ entryFile, files: closure.files }),
            };
          })();
        const originPackage =
          origin.kind === "package"
            ? source.packages.find((pkg) => pkg.key === origin.packageKey)
            : undefined;
        const common = {
          componentId: manifest.componentId,
          version: manifest.version,
          origin,
          manifestHash: hashComponentManifestDeclaration(manifest),
        };
        if (structured)
          return {
            ...common,
            mode: "structured" as const,
            structureHash: hashComponentStructureDeclaration(component.structure.value),
          };
        const renderer = (
          component as unknown as {
            renderer: {
              entrySource: string;
              localDependencies: readonly string[];
              packageImports: readonly string[];
            };
          }
        ).renderer;
        if (!renderer) throw new Error("Opaque component must carry its extracted renderer.");
        const renderClosure = originPackage
          ? fileClosure(
              originPackage,
              renderer.localDependencies.map((path) => {
                const prefix = `${originPackage.name}@${originPackage.version}/`;
                if (!path.startsWith(prefix))
                  throw new Error("Package renderer helper must remain in its origin package.");
                return path.slice(prefix.length);
              }),
              true,
            )
          : fileClosure(source, renderer.localDependencies, true);
        const rendererInputHash = hashCanonicalJsonPayload({
          extractionProfile: "react-component-v1",
          rendererAst: renderer.entrySource,
          localFiles: renderClosure.files,
          originPackageIntegrity: originPackage?.contentIntegrity ?? null,
          runtimeGraph: runtimeGraph(
            source,
            [...renderer.packageImports, ...renderClosure.bare],
            originPackage?.dependencies ?? source.rootDependencies,
          ),
          bundleTool: { name: "unframe-react-extractor", version: 1, typescript: ts.version },
        });
        return { ...common, mode: "opaque" as const, rendererInputHash };
      },
    );
    componentLocks.sort((a, b) => compare(a.componentId, b.componentId) || a.version - b.version);
    return {
      valid: true,
      value: {
        componentLocks,
        themeHashes: catalog.themes
          .map(({ value }) => ({ themeId: value.id, hash: hashThemeDeclaration(value) }))
          .sort((a, b) => compare(a.themeId, b.themeId)),
      },
      diagnostics: [],
    };
  } catch (error) {
    return {
      valid: false,
      diagnostics: [
        {
          code: "compiler-frozen-input-invalid",
          path: [],
          message:
            error instanceof Error
              ? error.message
              : "Frozen Component inputs could not be resolved.",
        },
      ],
    };
  }
};
