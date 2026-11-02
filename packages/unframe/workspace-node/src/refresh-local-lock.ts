import type { SourceAssetPorts } from "./source-assets.js";
import {
  prepareLockRefresh,
  type StylePreparationError,
  type StylePreparationPort,
} from "@unframe/build";
import { withNativeFilesystem } from "./native-filesystem.js";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { discoverPresentationProjectFiles } from "./discover-project.js";
import { createProjectRevision } from "@unframe/workspace";
import { digestBytes } from "./package-snapshot.js";
import { projectDirectory, readDirectoryNames, readRegularFile } from "./path-policy.js";
import { acquireSourceLock } from "./source-lock.js";
import { acquireBuildLock } from "./build-lock.js";
import { readTypeLibraries } from "./prepare-project.js";

type RefreshResult =
  | { ok: true; revision: string }
  | {
      ok: false;
      code: string;
      message: string;
      diagnostics?: StylePreparationError["diagnostics"];
    };

/** Refresh local closure hashes without installing or replacing the locked package snapshot. */
const refreshLocalProjectLockWithinScope = async (
  ports: SourceAssetPorts & { styles: StylePreparationPort },
  requestedDirectory: string,
  options: {
    expectedRevision?: string;
    sourceLeaseHeld?: boolean;
    signal?: AbortSignal;
    waitTimeoutMs?: number;
  } = {},
): Promise<RefreshResult> => {
  const failure = (code: string, message: string): RefreshResult => ({ ok: false, code, message });
  const directory = await projectDirectory(requestedDirectory);
  if (!directory)
    return failure("cli-project-discovery-invalid-directory", "Project directory is unsafe.");
  const buildLease = await acquireBuildLock(directory);
  if (!buildLease.ok)
    return failure(buildLease.code, "Another build or lock update owns the project.");
  const lease = options.sourceLeaseHeld
    ? undefined
    : await acquireSourceLock(directory, options).catch(async (error: unknown) => {
        await buildLease.value.release();
        throw error;
      });
  if (lease && !lease.ok) {
    await buildLease.value.release();
    return failure(lease.code, "Source is being saved or requires recovery.");
  }
  let temporary: string | undefined;
  try {
    if (options.signal?.aborted) return failure("cli-cancelled", "Lock refresh was cancelled.");
    const found = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
    if (!found.ok) return found;
    if (options.expectedRevision !== undefined && options.expectedRevision !== found.revision)
      return failure("cli-output-stale", "Project inputs changed after the build was requested.");
    const config = await readRegularFile(join(directory, "unframe.config.ts"));
    if (!config) return failure("cli-lock-refresh-failed", "Project config could not be read.");
    const prepared = await prepareLockRefresh(
      { found, ...(options.signal ? { signal: options.signal } : {}) },
      { ...ports, readTypeLibraries },
    );
    if (!prepared.ok) return prepared;
    const { bytes } = prepared;
    const latest = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
    if (!latest.ok || latest.revision !== found.revision)
      return failure("cli-output-stale", "Project inputs changed during lock refresh.");
    if (options.signal?.aborted) return failure("cli-cancelled", "Lock refresh was cancelled.");
    if (digestBytes(bytes) === digestBytes(found.lockBytes))
      return { ok: true, revision: found.revision };
    const storage = join(directory, ".unframe");
    await mkdir(storage).catch((error: unknown) => {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST")
        throw error;
    });
    if (!(await readDirectoryNames(storage)))
      return failure("cli-lock-refresh-failed", "Lock storage is unsafe.");
    temporary = join(storage, `lock-${randomUUID()}.tmp`);
    const output = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await output.writeFile(bytes);
      await output.sync();
    } finally {
      await output.close();
    }
    const beforeCommit = await discoverPresentationProjectFiles(directory, {
      sourceLeaseHeld: true,
    });
    if (!beforeCommit.ok || beforeCommit.revision !== found.revision)
      return failure("cli-output-stale", "Project inputs changed during lock refresh.");
    if (options.signal?.aborted) return failure("cli-cancelled", "Lock refresh was cancelled.");
    const expected = createProjectRevision({
      configBytes: config,
      lockBytes: bytes,
      localFiles: found.localFiles,
    });
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
    const refreshed = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
    if (!refreshed.ok) return refreshed;
    if (refreshed.revision !== expected)
      return failure("cli-output-stale", "Project inputs changed after lock refresh.");
    return { ok: true, revision: refreshed.revision };
  } catch {
    return failure("cli-lock-refresh-failed", "Local lock refresh could not be completed.");
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
    try {
      if (lease?.ok) await lease.value.release();
    } finally {
      await buildLease.value.release();
    }
  }
};

export const refreshLocalProjectLock: typeof refreshLocalProjectLockWithinScope = (...args) =>
  withNativeFilesystem(() => refreshLocalProjectLockWithinScope(...args));
