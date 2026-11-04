import { createHash } from "node:crypto";
import {
  mediaTypeFor,
  type NodeTransformSnapshot,
  type NodeSnapshotFile,
  type InstalledDependencyGraph,
} from "@unframe-dev/workspace";
import { hasPostcssConfig } from "./project-roots.js";

export type StyleDiagnostic = {
  phase: "config" | "resolve" | "transform";
  severity: "warning" | "error";
  message: string;
  file?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  plugin?: string | undefined;
};
export type StylePreparationPort = {
  snapshot(projectRoot: string, files: readonly NodeSnapshotFile[]): Promise<NodeTransformSnapshot>;
  withSources(
    snapshot: NodeTransformSnapshot,
    files: readonly NodeSnapshotFile[],
  ): NodeTransformSnapshot;
  compile(
    snapshot: NodeTransformSnapshot,
    entries: readonly string[],
    signal?: AbortSignal,
  ): Promise<
    | {
        ok: true;
        diagnostics: StyleDiagnostic[];
        stylesheets: { entry: string; css: string; sourceMap?: string | undefined }[];
      }
    | { ok: false; diagnostics: StyleDiagnostic[] }
  >;
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
type Project = {
  projectDirectory: string;
  entryFile: string;
  files: readonly { fileName: string; sourceText: string }[];
  localFiles: readonly { path: string; bytes: Uint8Array }[];
};
const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const lockedFile = (path: string, bytes: Uint8Array) => {
  const mediaType = mediaTypeFor(path);
  const hash = digest(bytes);
  if (mediaType.startsWith("text/") || mediaType === "application/json")
    return {
      path,
      mediaType,
      hash,
      encoding: "utf8" as const,
      data: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    };
  return {
    path,
    mediaType,
    hash,
    encoding: "base64" as const,
    data: Buffer.from(bytes).toString("base64"),
  };
};
export const prepareProjectSource = async (
  found: Project,
  graph: InstalledDependencyGraph,
  options: { signal?: AbortSignal; replacement?: string },
  ports: {
    typeLibraries: readonly { fileName: string; sourceText: string }[];
    styles: StylePreparationPort;
  },
) => {
  const localFiles = found.localFiles.map((file) =>
    file.path === found.entryFile && options.replacement !== undefined
      ? { path: file.path, bytes: new TextEncoder().encode(options.replacement) }
      : file,
  );
  const source = {
    typeLibraries: ports.typeLibraries,
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
  if (!hasPostcssConfig({ localFiles }))
    return {
      source,
      diagnostics: [] as StyleDiagnostic[],
      styleTransform: undefined,
      styleSourceIdentity: undefined,
    };
  const files = localFiles.map(({ path, bytes }) => ({
    path,
    bytes: Buffer.from(bytes).toString("base64"),
  }));
  const snapshot = await ports.styles.snapshot(found.projectDirectory, files);
  try {
    const result = await ports.styles.compile(
      snapshot,
      localFiles.filter(({ path }) => /\.css$/i.test(path)).map(({ path }) => path),
      options.signal,
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
          inputs: localFiles.map(({ path, bytes }) => ({ path, hash: digest(bytes) })),
          stylesheets: result.stylesheets,
        },
      },
      styleTransform: ports.styles.withSources(snapshot, []),
      styleSourceIdentity: snapshot.sourceIdentity,
    };
  } catch (error) {
    if (error instanceof StylePreparationError) throw error;
    throw new StylePreparationError(
      options.signal?.aborted ? "cli-cancelled" : "cli-style-worker-failed",
      error instanceof Error ? error.message : "Style worker failed.",
    );
  }
};
