import { checkAuthoringProject } from "@unframe-dev/source";
import {
  lockSourceAssets,
  validateDependencyGraph,
  type InstalledDependencyGraph,
  type ProjectConfig,
} from "@unframe-dev/workspace";
import { checkAuthoringProjectAssembly, computeFrozenComponentInputs } from "./index.js";
import { createSourceAssetAssemblyCarrier } from "./source-assets.js";
import {
  prepareProjectSource,
  StylePreparationError,
  type StylePreparationPort,
} from "./prepare-project.js";

export type ProjectInputPreparationPorts = {
  checkSource?: typeof checkAuthoringProject;
  readTypeLibraries(): Promise<readonly { fileName: string; sourceText: string }[]>;
  styles: StylePreparationPort;
  modelTransformIdentity: `sha256:${string}`;
  videoTransformIdentity(): Promise<`sha256:${string}`>;
};
type ProjectInput = {
  projectDirectory: string;
  entryFile: string;
  files: readonly { fileName: string; sourceText: string }[];
  localFiles: readonly { path: string; bytes: Uint8Array }[];
  assetSources: ProjectConfig["assets"];
};
const failure = (code: string, message: string) => ({ ok: false as const, code, message });
const cancelled = () => failure("cli-cancelled", "Project input preparation was cancelled.");
const diagnostics = (items: readonly { code: string; message: string }[]) =>
  items.map((item) => `${item.code}: ${item.message}`).join("\n");

export type ProjectInputPreparationResult = Awaited<ReturnType<typeof prepareProjectInputs>>;

export const prepareProjectInputs = async (
  input: { found: ProjectInput; graph: InstalledDependencyGraph; signal?: AbortSignal },
  ports: ProjectInputPreparationPorts,
) => {
  const { signal } = input;
  const found = {
    ...input.found,
    files: input.found.files.map((file) => ({ ...file })),
    localFiles: input.found.localFiles.map((file) => ({
      path: file.path,
      bytes: file.bytes.slice(),
    })),
    assetSources: Object.fromEntries(
      Object.entries(input.found.assetSources).map(([id, source]) => [id, { ...source }]),
    ),
  };
  try {
    if (signal?.aborted) return cancelled();
    const localFiles = new Map(found.localFiles.map((file) => [file.path, file.bytes]));
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    try {
      if (
        localFiles.size !== found.localFiles.length ||
        new Set(found.files.map((file) => file.fileName)).size !== found.files.length ||
        found.files.some((file) => {
          const bytes = localFiles.get(file.fileName);
          return !bytes || decoder.decode(bytes) !== file.sourceText;
        })
      )
        return failure(
          "cli-source-snapshot-invalid",
          "Source text must match its captured local bytes.",
        );
    } catch {
      return failure(
        "cli-source-snapshot-invalid",
        "Source text must match its captured local bytes.",
      );
    }
    let graph: InstalledDependencyGraph;
    try {
      graph = validateDependencyGraph({
        rootDependencies: input.graph.rootDependencies,
        packages: input.graph.packages,
      });
    } catch (error) {
      return failure(
        "cli-dependency-snapshot-invalid",
        error instanceof Error ? error.message : "Dependency snapshot is invalid.",
      );
    }
    const video = Object.values(found.assetSources).some(
      (source) => source.mediaType === "video/mp4",
    )
      ? await ports.videoTransformIdentity()
      : undefined;
    if (signal?.aborted) return cancelled();
    const assets = lockSourceAssets(ports, found.assetSources, found.localFiles, video);
    if (!assets.ok) return failure(assets.code, assets.message);
    const typeLibraries = await ports.readTypeLibraries();
    if (signal?.aborted) return cancelled();
    const prepared = await prepareProjectSource(found, graph, signal ? { signal } : {}, {
      typeLibraries,
      styles: ports.styles,
    });
    if (signal?.aborted) return cancelled();
    const catalog = (ports.checkSource ?? checkAuthoringProject)(prepared.source);
    if (!catalog.valid)
      return {
        ...failure("cli-source-invalid", diagnostics(catalog.diagnostics)),
        analysisFailure: { ...catalog, phase: "source" as const },
        prepared,
      };
    const computed = computeFrozenComponentInputs(prepared.source, catalog.value);
    if (!computed.valid)
      return {
        ...failure("cli-input-invalid", diagnostics(computed.diagnostics)),
        analysisFailure: { ...computed, phase: "assembly" as const },
        prepared,
      };
    const assemblyCarrier = createSourceAssetAssemblyCarrier(
      { ...computed.value, assets: {} },
      assets.value.assets,
    );
    const checked = checkAuthoringProjectAssembly(
      prepared.source,
      assemblyCarrier,
      assets.value.sourceAssetBytes,
      ports.checkSource,
    );
    if (!checked.valid)
      return {
        ...failure("cli-assembly-invalid", diagnostics(checked.diagnostics)),
        analysisFailure: checked,
        prepared,
        assemblyCarrier,
        sourceAssetBytes: assets.value.sourceAssetBytes,
        assets: assets.value.assets,
      };
    return {
      ok: true as const,
      value: {
        ...prepared,
        assemblyCarrier,
        sourceAssetBytes: assets.value.sourceAssetBytes,
        assets: assets.value.assets,
      },
    };
  } catch (error) {
    if (signal?.aborted) return cancelled();
    if (error instanceof StylePreparationError)
      return { ...failure(error.code, error.message), diagnostics: error.diagnostics };
    return failure(
      "cli-input-preparation-failed",
      error instanceof Error ? error.message : "Project input preparation failed.",
    );
  }
};
