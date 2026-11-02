import type { SourceAssetPorts } from "./source-assets.js";
import {
  prepareLockUpdate,
  type StylePreparationError,
  type StylePreparationPort,
} from "@unframe/build";
import { withNativeFilesystem } from "./native-filesystem.js";
import { readTypeLibraries } from "./prepare-project.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { discoverPresentationProjectFiles } from "./discover-project.js";
import { acquireSourceLock } from "./source-lock.js";
import { acquireBuildLock } from "./build-lock.js";
import { readRegularFile, readBoundedRegularFile } from "./path-policy.js";
import { digestBytes, snapshotInstalledPackages } from "./package-snapshot.js";

const execute = promisify(execFile);

const updateProjectLockWithinScope = async (
  ports: SourceAssetPorts & { styles: StylePreparationPort },
  directory: string,
  operation: "refresh" | "update",
  recreate: boolean,
  signal?: AbortSignal,
): Promise<
  | { ok: true }
  | { ok: false; code: string; message: string; diagnostics?: StylePreparationError["diagnostics"] }
> => {
  const failure = (code: string, message: string) => ({ ok: false as const, code, message });
  let discovered = await discoverPresentationProjectFiles(directory);
  if (!discovered.ok) return discovered;
  const acquired = await acquireBuildLock(discovered.projectDirectory);
  if (!acquired.ok) return failure(acquired.code, "Another build or lock update owns the project.");
  const sourceLease = await acquireSourceLock(discovered.projectDirectory).catch(
    async (error: unknown) => {
      await acquired.value.release();
      throw error;
    },
  );
  if (!sourceLease.ok) {
    await acquired.value.release();
    return failure(sourceLease.code, "Source is being saved or requires recovery.");
  }
  let temporary: string | undefined;
  try {
    discovered = await discoverPresentationProjectFiles(directory, { sourceLeaseHeld: true });
    if (!discovered.ok) return discovered;
    if (signal?.aborted) return failure("cli-cancelled", "Lock update was cancelled.");
    const prepared = await prepareLockUpdate(
      { found: discovered, operation, recreate, ...(signal ? { signal } : {}) },
      {
        ...ports,
        readTypeLibraries,
        install: async () => {
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
            { cwd: directory, signal, timeout: 120_000, maxBuffer: 1024 * 1024 },
          );
          return { ok: true as const };
        },
        snapshotInstalledPackages: (rootSpecifiers) =>
          snapshotInstalledPackages(directory, rootSpecifiers ? { rootSpecifiers } : {}),
      },
    );
    if (!prepared.ok) return prepared;
    const { bytes } = prepared;
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
