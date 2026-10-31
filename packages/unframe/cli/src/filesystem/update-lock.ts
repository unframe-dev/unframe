import { withNativeFilesystem } from "./native-filesystem.js";
import {
  authoringPackageRoots,
  hasPostcssConfig,
  prepareProjectSource,
  StylePreparationError,
} from "./prepare-project.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  checkAuthoringProject,
  checkAuthoringProjectAssembly,
  computeFrozenComponentInputs,
} from "@unframe/core/compiler";
import { canonicalizeJsonPayload } from "@unframe/core";
import type { StyleDiagnostic } from "@unframe/core/tailwind";
import { discoverPresentationProjectFiles } from "./discover-project.js";
import { loadUnframeLock } from "./load-lock.js";
import { parseStrictJson } from "@unframe/core/strict-json";
import { acquireSourceLock } from "./source-lock.js";
import { acquireBuildLock } from "./build-lock.js";
import { readRegularFile, readBoundedRegularFile } from "./path-policy.js";
import { lockSourceAssets, projectVideoTransformIdentity } from "./source-assets.js";
import { digestBytes, snapshotInstalledPackages } from "./package-snapshot.js";
import { hashDependencyGraph, type UnframeLock } from "./lock.js";

const execute = promisify(execFile);

const updateProjectLockWithinScope = async (
  directory: string,
  operation: "refresh" | "update",
  recreate: boolean,
  signal?: AbortSignal,
): Promise<
  | { ok: true }
  | { ok: false; code: string; message: string; diagnostics?: readonly StyleDiagnostic[] }
> => {
  const failure = (code: string, message: string) => ({ ok: false as const, code, message });
  let discovered = await discoverPresentationProjectFiles(directory);
  if (!discovered.ok) return discovered;
  const acquired = await acquireBuildLock(discovered.projectDirectory);
  if (!acquired.ok) return failure(acquired.code, "Another build or lock update owns the project.");
  const sourceLease = await acquireSourceLock(discovered.projectDirectory);
  if (!sourceLease.ok) {
    await acquired.value.release();
    return failure(sourceLease.code, "Source is being saved or requires recovery.");
  }
  let temporary: string | undefined;
  try {
    discovered = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
    if (!discovered.ok) return discovered;
    if (signal?.aborted) return failure("cli-cancelled", "Lock update was cancelled.");
    let loaded = recreate ? undefined : loadUnframeLock(discovered.lockBytes);
    if (
      loaded &&
      !loaded.ok &&
      loaded.diagnostic.code === "cli-lock-renderer-plugins-refresh-required"
    ) {
      const old = parseStrictJson(discovered.lockBytes);
      if (
        old.ok &&
        old.value !== null &&
        typeof old.value === "object" &&
        !Array.isArray(old.value)
      ) {
        const migrated = {
          ...old.value,
          rendererPlugins: [
            { id: "baked-web", version: "3", contractVersion: "2" },
            { id: "baked-web", version: "4", contractVersion: "2" },
          ],
        };
        loaded = loadUnframeLock(
          new TextEncoder().encode(canonicalizeJsonPayload(migrated) + "\n"),
        );
      }
    }
    if (loaded && !loaded.ok) return failure(loaded.diagnostic.code, loaded.diagnostic.message);
    const previous = loaded?.ok ? loaded.value.lock : undefined;
    const sourceAssets = lockSourceAssets(
      discovered.assetSources,
      discovered.localFiles,
      await projectVideoTransformIdentity(discovered.assetSources),
    );
    if (!sourceAssets.ok) return failure(sourceAssets.code, sourceAssets.message);
    if (operation === "update") {
      if (
        !(await readRegularFile(join(directory, "package.json"))) ||
        !(await readRegularFile(join(directory, "pnpm-lock.yaml")))
      )
        return failure(
          "cli-lock-package-input-missing",
          "Lock update requires regular package.json and pnpm-lock.yaml inputs.",
        );
      await execute(
        "pnpm",
        [
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--ignore-pnpmfile",
          "--force",
          "--verify-store-integrity",
        ],
        {
          cwd: directory,
          signal,
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        },
      );
    }
    const graph =
      operation === "update"
        ? await snapshotInstalledPackages(
            directory,
            hasPostcssConfig(discovered)
              ? { rootSpecifiers: authoringPackageRoots(discovered) }
              : {},
          )
        : previous;
    if (!graph)
      return failure("cli-lock-update-required", "A valid v3 lock is required for refresh.");
    const prepared = await prepareProjectSource(discovered, graph, {
      update: operation === "update",
      refresh: true,
      ...(signal ? { signal } : {}),
    });
    const source = prepared.source;
    const catalog = checkAuthoringProject(source);
    if (!catalog.valid)
      return failure(
        "cli-lock-source-invalid",
        catalog.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
      );
    const computed = computeFrozenComponentInputs(source, catalog.value);
    if (!computed.valid)
      return failure(
        "cli-lock-input-invalid",
        computed.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
      );
    const next = {
      ...(prepared.styleTransform
        ? {
            styleTransform: prepared.styleTransform,
            styleSourceIdentity: prepared.styleSourceIdentity,
          }
        : {}),
      schemaVersion: 3,
      packageSnapshotProfile: "pnpm-lock9-locator-v1",
      resolutionProfile: "browser-import-production-types-v1",
      extractionProfile: "react-component-v1",
      packageManagerLockHash: graph.packageManagerLockHash,
      rootDependencies: graph.rootDependencies,
      packages: graph.packages,
      themeHashes: computed.value.themeHashes,
      componentLocks: computed.value.componentLocks,
      assets: sourceAssets.value.assets,
      rendererPlugins: previous?.rendererPlugins ?? [
        { id: "baked-web", version: "3", contractVersion: "2" },
        { id: "baked-web", version: "4", contractVersion: "2" },
      ],
    } as Omit<UnframeLock, "dependencyGraphHash">;
    const lock: UnframeLock = { ...next, dependencyGraphHash: hashDependencyGraph(next) };
    const bytes = new TextEncoder().encode(canonicalizeJsonPayload(lock) + "\n");
    const validated = loadUnframeLock(bytes);
    if (!validated.ok) return failure(validated.diagnostic.code, validated.diagnostic.message);
    const checked = checkAuthoringProjectAssembly(
      source,
      validated.value.assemblyCarrier,
      sourceAssets.value.sourceAssetBytes,
    );
    if (!checked.valid)
      return failure(
        "cli-lock-assembly-invalid",
        checked.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
      );
    if (signal?.aborted) return failure("cli-cancelled", "Lock update was cancelled.");
    const current = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
    if (!current.ok || current.revision !== discovered.revision)
      return failure("cli-lock-source-changed", "Source changed during lock update.");
    for (const file of discovered.localFiles) {
      const current = await readBoundedRegularFile(
        join(directory, file.path),
        file.bytes.byteLength,
        file.bytes.byteLength,
      );
      if (!current || digestBytes(current) !== digestBytes(file.bytes))
        return failure("cli-lock-source-changed", "Source changed during lock update.");
    }
    const currentLock = await readRegularFile(join(directory, "unframe.lock"));
    if (!currentLock || digestBytes(currentLock) !== digestBytes(discovered.lockBytes))
      return failure("cli-lock-source-changed", "Lock changed during update.");
    temporary = join(directory, `.unframe-lock-${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, join(directory, "unframe.lock"));
    temporary = undefined;
    const parent = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof StylePreparationError)
      return {
        ...failure(error.code, error.message),
        diagnostics: error.diagnostics,
      };
    return failure(
      "cli-lock-update-failed",
      error instanceof Error ? error.message : "Lock update failed.",
    );
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
    try {
      await sourceLease.value.release();
    } finally {
      await acquired.value.release();
    }
  }
};

export const updateProjectLock: typeof updateProjectLockWithinScope = (...args) =>
  withNativeFilesystem(() => updateProjectLockWithinScope(...args));
