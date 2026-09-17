import { constants, type Stats } from "node:fs";
import { lstat, open, unlink, type FileHandle } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const LOCK_FILE_NAME = ".unframe-build.lock";

type Identity = Readonly<{ dev: number; ino: number }>;

export type BuildLockFileSystem = Readonly<{
  open: (path: string, flags: number, mode: number) => Promise<FileHandle>;
  lstat: (path: string) => Promise<Stats>;
  unlink: (path: string) => Promise<void>;
}>;

export type BuildLock = Readonly<{
  release: () => Promise<void>;
}>;

export type BuildLockResult =
  | Readonly<{ ok: true; value: BuildLock }>
  | Readonly<{ ok: false; code: "cli-build-lock-unavailable" | "cli-build-lock-io" }>;

const sameIdentity = (left: Identity, right: Identity) =>
  left.dev === right.dev && left.ino === right.ino;

const defaultFileSystem: BuildLockFileSystem = Object.freeze({ open, lstat, unlink });

const isErrorCode = (error: unknown, code: string) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

const optionalLstat = async (fileSystem: BuildLockFileSystem, path: string) => {
  try {
    return await fileSystem.lstat(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
};

/**
 * Acquires a non-recovering build lease. A lock left by a crashed process is deliberately
 * fail-closed: only an operator may inspect and remove it after confirming that no build lives.
 */
export const acquireBuildLock = async (
  projectDirectory: string,
  fileSystem: BuildLockFileSystem = defaultFileSystem,
): Promise<BuildLockResult> => {
  if (!isAbsolute(projectDirectory)) return { ok: false, code: "cli-build-lock-io" };
  const path = join(projectDirectory, LOCK_FILE_NAME);
  let handle;
  try {
    handle = await fileSystem.open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    return {
      ok: false,
      code: isErrorCode(error, "EEXIST") ? "cli-build-lock-unavailable" : "cli-build-lock-io",
    };
  }

  const opened = await handle.stat().catch(() => undefined);
  const linked = await optionalLstat(fileSystem, path).catch(() => undefined);
  if (
    !opened ||
    !linked ||
    !opened.isFile() ||
    !linked.isFile() ||
    linked.isSymbolicLink() ||
    !sameIdentity(opened, linked)
  ) {
    await handle.close().catch(() => undefined);
    if (opened) {
      const current = await optionalLstat(fileSystem, path).catch(() => undefined);
      if (current?.isFile() && !current.isSymbolicLink() && sameIdentity(opened, current))
        await fileSystem.unlink(path).catch(() => undefined);
    }
    return { ok: false, code: "cli-build-lock-io" };
  }
  const identity: Identity = { dev: opened.dev, ino: opened.ino };
  let released = false;
  let closed = false;
  const release = async () => {
    if (released) return;
    if (!closed) {
      try {
        await handle.close();
        closed = true;
      } catch {
        throw new Error("Build lock release failed.");
      }
    }
    let current;
    try {
      current = await optionalLstat(fileSystem, path);
    } catch {
      throw new Error("Build lock release failed.");
    }
    if (!current) {
      released = true;
      return;
    }
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity, current))
      throw new Error("Build lock release failed.");
    try {
      await fileSystem.unlink(path);
    } catch {
      throw new Error("Build lock release failed.");
    }
    released = true;
  };
  return { ok: true, value: Object.freeze({ release }) };
};

export const buildLockFileName = LOCK_FILE_NAME;
