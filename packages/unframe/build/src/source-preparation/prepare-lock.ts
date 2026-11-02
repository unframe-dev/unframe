import { checkAuthoringProject } from "@unframe/source";
import {
  createProjectLock,
  refreshProjectLock,
  loadUnframeLock,
  lockSourceAssets,
  type ProjectConfig,
  type UnframeLock,
} from "@unframe/workspace";
import { checkAuthoringProjectAssembly, computeFrozenComponentInputs } from "./index.js";
import { createSourceAssetAssemblyCarrier } from "./source-assets.js";
import { authoringPackageRoots, hasPostcssConfig } from "./project-roots.js";
import {
  prepareProjectSource,
  StylePreparationError,
  type StylePreparationPort,
  type StyleDiagnostic,
} from "./prepare-project.js";

type Graph = Pick<UnframeLock, "packageManagerLockHash" | "rootDependencies" | "packages">;
type Found = {
  projectDirectory: string;
  entryFile: string;
  files: readonly { fileName: string; sourceText: string }[];
  localFiles: readonly { path: string; bytes: Uint8Array }[];
  assetSources: ProjectConfig["assets"];
  lockBytes: Uint8Array;
};
type Failure = {
  ok: false;
  code: string;
  message: string;
  diagnostics?: readonly StyleDiagnostic[];
};
export type LockRefreshPorts = {
  readTypeLibraries(): Promise<readonly { fileName: string; sourceText: string }[]>;
  styles: StylePreparationPort;
  modelTransformIdentity: `sha256:${string}`;
  videoTransformIdentity(): Promise<`sha256:${string}`>;
};
export type LockPreparationPorts = LockRefreshPorts & {
  install(): Promise<{ ok: true } | Failure>;
  snapshotInstalledPackages(rootSpecifiers?: string[]): Promise<Graph>;
};
type BaseInput = { found: Found; signal?: AbortSignal };
type UpdateInput = BaseInput & { operation: "update" | "refresh"; recreate?: boolean };
const failure = (code: string, message: string): Failure => ({ ok: false, code, message });
const cancelled = (refresh: boolean) =>
  failure("cli-cancelled", `Lock ${refresh ? "refresh" : "update"} was cancelled.`);
const diagnostics = (items: readonly { code: string; message: string }[]) =>
  items.map((item) => `${item.code}: ${item.message}`).join("\n");

async function prepare(
  input: BaseInput | UpdateInput,
  ports: LockRefreshPorts,
  localRefresh: boolean,
): Promise<{ ok: true; bytes: Uint8Array } | Failure> {
  const { found, signal } = input;
  const update = !localRefresh && (input as UpdateInput).operation === "update";
  try {
    if (signal?.aborted) return cancelled(localRefresh);
    const loaded =
      !localRefresh && (input as UpdateInput).recreate
        ? undefined
        : loadUnframeLock(found.lockBytes);
    if (loaded && !loaded.ok) return failure(loaded.diagnostic.code, loaded.diagnostic.message);
    const previous = loaded?.ok ? loaded.value.lock : undefined;
    let video: `sha256:${string}` | undefined;
    try {
      if (Object.values(found.assetSources).some((source) => source.mediaType === "video/mp4"))
        video = await ports.videoTransformIdentity();
    } catch (error) {
      if (signal?.aborted) return cancelled(localRefresh);
      if (!localRefresh) throw error;
      return failure(
        "cli-source-asset-transform-unavailable",
        "Source Assets differ from the frozen lock. Refresh the lock explicitly.",
      );
    }
    if (signal?.aborted) return cancelled(localRefresh);
    const assets = lockSourceAssets(ports, found.assetSources, found.localFiles, video);
    if (!assets.ok) return failure(assets.code, assets.message);
    if (update) {
      const installed = await (ports as LockPreparationPorts).install();
      if (signal?.aborted) return cancelled(localRefresh);
      if (!installed.ok) return installed;
    }
    const graph = update
      ? await (ports as LockPreparationPorts).snapshotInstalledPackages(
          hasPostcssConfig(found) ? authoringPackageRoots(found) : undefined,
        )
      : previous;
    if (signal?.aborted) return cancelled(localRefresh);
    if (!graph)
      return failure(
        "cli-lock-update-required",
        "A valid schema version 1 lock is required for refresh.",
      );
    const typeLibraries = await ports.readTypeLibraries();
    if (signal?.aborted) return cancelled(localRefresh);
    const prepared = await prepareProjectSource(
      found,
      graph,
      { update, refresh: true, ...(signal ? { signal } : {}) },
      { typeLibraries, styles: ports.styles },
    );
    if (signal?.aborted) return cancelled(localRefresh);
    const source = prepared.source;
    const catalog = checkAuthoringProject(source);
    if (!catalog.valid) return failure("cli-lock-source-invalid", diagnostics(catalog.diagnostics));
    const computed = computeFrozenComponentInputs(source, catalog.value);
    if (!computed.valid)
      return failure("cli-lock-input-invalid", diagnostics(computed.diagnostics));
    const inputs = {
      componentLocks: computed.value.componentLocks,
      themeHashes: computed.value.themeHashes,
      ...(prepared.styleTransform
        ? {
            styleTransform: prepared.styleTransform,
            styleSourceIdentity: prepared.styleSourceIdentity,
          }
        : {}),
    };
    const bytes = localRefresh
      ? refreshProjectLock(previous!, inputs)
      : createProjectLock(graph, { ...inputs, assets: assets.value.assets }, previous);
    const validated = loadUnframeLock(bytes);
    if (!validated.ok) return failure(validated.diagnostic.code, validated.diagnostic.message);
    const carrier = localRefresh
      ? createSourceAssetAssemblyCarrier(validated.value.assemblyCarrier, assets.value.assets)
      : validated.value.assemblyCarrier;
    const checked = checkAuthoringProjectAssembly(source, carrier, assets.value.sourceAssetBytes);
    if (!checked.valid)
      return failure("cli-lock-assembly-invalid", diagnostics(checked.diagnostics));
    return { ok: true, bytes };
  } catch (error) {
    if (signal?.aborted) return cancelled(localRefresh);
    if (error instanceof StylePreparationError)
      return { ...failure(error.code, error.message), diagnostics: error.diagnostics };
    return failure(
      localRefresh ? "cli-lock-refresh-failed" : "cli-lock-update-failed",
      localRefresh
        ? "Local lock refresh could not be completed."
        : error instanceof Error
          ? error.message
          : "Lock update failed.",
    );
  }
}
export const prepareLockUpdate = (input: UpdateInput, ports: LockPreparationPorts) =>
  prepare(input, ports, false);
export const prepareLockRefresh = (input: BaseInput, ports: LockRefreshPorts) =>
  prepare(input, ports, true);
