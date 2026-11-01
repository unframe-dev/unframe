import { dirname, join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { z } from "zod";
import { compileStylesResultSchema, type StyleDiagnostic } from "@unframe/core/tailwind";
import type { DiscoveredProjectFiles } from "./discover-project.js";
import type { UnframeLock } from "@unframe/workspace";
import { digestBytes, lockedFile } from "@unframe/workspace-node";
import {
  snapshotNodeTransformInputs,
  withNodeTransformSources,
  type NodeTransformSnapshot,
} from "../styles/node-snapshot.js";
import { runStyleWorker } from "../styles/run-style-worker.js";

type Discovery = Extract<DiscoveredProjectFiles, { ok: true }>;
const configPattern =
  /^(?:postcss\.config\.(?:js|cjs|mjs|ts|cts|mts)|\.postcssrc(?:\.(?:json|yaml|yml|js|cjs|mjs|ts|cts|mts))?)$/;
export const hasPostcssConfig = (found: Pick<Discovery, "localFiles">): boolean => {
  if (found.localFiles.some(({ path }) => configPattern.test(path))) return true;
  const manifest = found.localFiles.find(({ path }) => path === "package.json");
  if (!manifest) return false;
  try {
    return z
      .object({ postcss: z.unknown() })
      .safeParse(JSON.parse(new TextDecoder().decode(manifest.bytes))).success;
  } catch {
    return false;
  }
};

/** Browser roots include authoring imports and the renderer bootstrap; config runs in Node. */
export const authoringPackageRoots = (
  found: Pick<Discovery, "files" | "entryFile"> & Partial<Pick<Discovery, "localFiles">>,
): string[] => {
  const files = new Map<string, string | Uint8Array>(
    found.files.map((file) => [file.fileName, file.sourceText]),
  );
  for (const file of found.localFiles ?? [])
    if (/\.(?:[cm]?js|jsx)$/.test(file.path)) files.set(file.path, file.bytes);
  const visited = new Set<string>();
  const roots = new Set(["react", "react-dom", "@types/react", "@types/react-dom"]);
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const content = files.get(name);
    if (content === undefined) return;
    const text =
      typeof content === "string"
        ? content
        : new TextDecoder("utf-8", { fatal: true }).decode(content);
    const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const collect = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        specifiers.push(node.moduleSpecifier.text);
      else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        specifiers.push(node.argument.literal.text);
      else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        specifiers.push(node.arguments[0].text);
      ts.forEachChild(node, collect);
    };
    collect(file);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) {
        const root = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]!;
        roots.add(root);
        roots.add(`@types/${root.replace(/^@/, "").replace("/", "__")}`);
        continue;
      }
      const segments = name.split("/").slice(0, -1);
      for (const part of specifier.split("/")) {
        if (part === "..") segments.pop();
        else if (part !== ".") segments.push(part);
      }
      const path = segments.join("/");
      const candidates = [
        path,
        `${path}.ts`,
        `${path}.tsx`,
        `${path}.d.ts`,
        `${path}.js`,
        `${path}.jsx`,
        `${path}.mjs`,
        `${path}.cjs`,
        `${path}/index.ts`,
        `${path}/index.tsx`,
        `${path}/index.d.ts`,
        `${path}/index.js`,
        `${path}/index.jsx`,
        `${path}/index.mjs`,
        `${path}/index.cjs`,
        path.replace(/\.js$/, ".ts"),
        path.replace(/\.js$/, ".tsx"),
      ];
      // Declarations and runtime modules can import different packages.
      const typeTarget = candidates.find((candidate) => files.has(candidate));
      const runtimeTarget = candidates.find(
        (candidate) => !candidate.endsWith(".d.ts") && files.has(candidate),
      );
      if (typeTarget) visit(typeTarget);
      if (runtimeTarget) visit(runtimeTarget);
    }
  };
  visit(found.entryFile);
  return [...roots].sort();
};
export class StylePreparationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: readonly StyleDiagnostic[] = [],
  ) {
    super(message);
  }
}
export const prepareProjectSource = async (
  found: Discovery,
  graph: Pick<
    UnframeLock,
    "rootDependencies" | "packages" | "styleTransform" | "styleSourceIdentity"
  >,
  options: { update?: boolean; refresh?: boolean; signal?: AbortSignal; replacement?: string } = {},
) => {
  const localFiles = found.localFiles.map((file) =>
    file.path === found.entryFile && options.replacement !== undefined
      ? { path: file.path, bytes: new TextEncoder().encode(options.replacement) }
      : file,
  );
  const libraryDirectory = dirname(ts.getDefaultLibFilePath({}));
  const typeLibraries = await Promise.all(
    (await readdir(libraryDirectory))
      .filter((name) => /^lib(?:\.[a-z0-9.]+)?\.d\.ts$/u.test(name))
      .sort()
      .map(async (fileName) => ({
        fileName,
        sourceText: await readFile(join(libraryDirectory, fileName), "utf8"),
      })),
  );
  const source = {
    typeLibraries,
    projectRoot: found.projectDirectory,
    entryFile: found.entryFile,
    files: found.files.map((file) =>
      file.fileName === found.entryFile && options.replacement !== undefined
        ? { ...file, sourceText: options.replacement }
        : file,
    ),
    rawFiles: localFiles
      .filter(({ path }) => !/\.(ts|tsx)$/i.test(path))
      .map(({ path, bytes }) => lockedFile(path, bytes)),
    rootDependencies: graph.rootDependencies,
    packages: graph.packages,
  };
  if (!hasPostcssConfig({ localFiles }) && !graph.styleTransform)
    return { source, diagnostics: [] };
  const files = localFiles.map(({ path, bytes }) => ({
    path,
    bytes: Buffer.from(bytes).toString("base64"),
  }));
  let snapshot: NodeTransformSnapshot;
  if (options.update)
    snapshot = await snapshotNodeTransformInputs(found.projectDirectory, {
      sourceFiles: files,
      adapterRoot: dirname(
        dirname(dirname(fileURLToPath(import.meta.resolve("@unframe/core/tailwind")))),
      ),
      adapterSubpath: "./tailwind",
      adapterDependencies: [
        "error-stack-parser",
        "jiti",
        "path-is-inside",
        "postcss-load-config",
        "semver",
        "zod",
      ],
    });
  else {
    if (!graph.styleTransform)
      throw new StylePreparationError(
        "cli-style-lock-update-required",
        "PostCSS configuration requires lock update to freeze its Node dependencies.",
      );
    snapshot = withNodeTransformSources(graph.styleTransform, files);
    if (!options.refresh && snapshot.sourceIdentity !== graph.styleSourceIdentity)
      throw new StylePreparationError(
        "cli-style-source-changed",
        "Style inputs changed. Refresh the lock explicitly.",
      );
  }
  try {
    const result = compileStylesResultSchema.parse(
      await runStyleWorker(snapshot, {
        entries: localFiles.filter(({ path }) => /\.css$/i.test(path)).map(({ path }) => path),
        ...(options.signal ? { signal: options.signal } : {}),
      }),
    );
    if (!result.ok)
      throw new StylePreparationError(
        "cli-style-transform-failed",
        result.diagnostics.map((item) => `${item.file ?? "postcss"}: ${item.message}`).join("\n"),
        result.diagnostics,
      );
    return {
      diagnostics: result.diagnostics,
      source: {
        ...source,
        preparedStyles: {
          identity: `sha256:${snapshot.identity}`,
          inputs: localFiles.map(({ path, bytes }) => ({ path, hash: digestBytes(bytes) })),
          stylesheets: result.stylesheets,
        },
      },
      styleTransform: withNodeTransformSources(snapshot, []),
      styleSourceIdentity: snapshot.sourceIdentity,
    };
  } catch (error) {
    if (error instanceof StylePreparationError) throw error;
    const cancelled = options.signal?.aborted;
    throw new StylePreparationError(
      cancelled ? "cli-cancelled" : "cli-style-worker-failed",
      error instanceof Error ? error.message : "Style worker failed.",
    );
  }
};
