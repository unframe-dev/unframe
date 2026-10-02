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
} from "@unframe/unframe-compiler";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { discoverPresentationProjectFiles } from "./discover-project.js";
import { loadUnframeLock } from "./load-lock.js";
import { parseStrictJson } from "./strict-json.js";
import { acquireSourceLock } from "./source-lock.js";
import { acquireBuildLock } from "./build-lock.js";
import { readRegularFile } from "./path-policy.js";
import { digestBytes, lockedFile, snapshotInstalledPackages } from "./package-snapshot.js";
import { hashDependencyGraph, type UnframeLockV2 } from "./lock-v2.js";

const execute = promisify(execFile);

export const updateProjectLock = async (
  directory: string,
  operation: "refresh" | "update",
  recreate: boolean,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> => {
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
    const graph = operation === "update" ? await snapshotInstalledPackages(directory) : previous;
    if (!graph)
      return failure("cli-lock-update-required", "A valid v2 lock is required for refresh.");
    const source = {
      projectRoot: discovered.projectDirectory,
      entryFile: discovered.entryFile,
      files: discovered.files,
      rawFiles: discovered.localFiles
        .filter(({ path }) => /\.(js|mjs|cjs|css|png|jpe?g|webp|ttf|otf)$/i.test(path))
        .map(({ path, bytes }) => lockedFile(path, bytes)),
      rootDependencies: graph.rootDependencies,
      packages: graph.packages,
    };
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
      schemaVersion: 2,
      packageSnapshotProfile: "pnpm-lock9-locator-v1",
      resolutionProfile: "browser-import-production-types-v1",
      extractionProfile: "react-component-v1",
      packageManagerLockHash: graph.packageManagerLockHash,
      rootDependencies: graph.rootDependencies,
      packages: graph.packages,
      themeHashes: computed.value.themeHashes,
      componentLocks: computed.value.componentLocks,
      assets: previous?.assets ?? [],
      rendererPlugins: previous?.rendererPlugins ?? [
        { id: "baked-web", version: "3", contractVersion: "2" },
        { id: "baked-web", version: "4", contractVersion: "2" },
      ],
    } as Omit<UnframeLockV2, "dependencyGraphHash">;
    const lock: UnframeLockV2 = { ...next, dependencyGraphHash: hashDependencyGraph(next) };
    const bytes = new TextEncoder().encode(canonicalizeJsonPayload(lock) + "\n");
    const validated = loadUnframeLock(bytes);
    if (!validated.ok) return failure(validated.diagnostic.code, validated.diagnostic.message);
    const checked = checkAuthoringProjectAssembly(source, validated.value.assemblyCarrier);
    if (!checked.valid)
      return failure(
        "cli-lock-assembly-invalid",
        checked.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
      );
    if (signal?.aborted) return failure("cli-cancelled", "Lock update was cancelled.");
    for (const file of discovered.localFiles) {
      const current = await readRegularFile(join(directory, file.path));
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
