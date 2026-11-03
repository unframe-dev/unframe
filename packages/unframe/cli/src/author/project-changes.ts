import { watch, type FSWatcher } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { AuthorError } from "@unframe-dev/author-service";
import { readPnpmProjectLock, PnpmProjectLockError } from "@unframe-dev/workspace-node";
import type { ProjectChange } from "@unframe-dev/contracts/author-http";

export type ProjectChanges = {
  wait(cursor?: string, signal?: AbortSignal): Promise<ProjectChange>;
  close(): void;
};
export const createProjectChanges = () => {
  let session = randomBytes(16).toString("hex");
  let sequence = 0;
  let closed = false;
  let failure: Error | undefined;
  const listeners = new Set<() => void>();
  const cursor = () => `${session}:${sequence}`;
  const requireAvailable = () => {
    if (closed || failure)
      throw new AuthorError(
        503,
        "author-watch-unavailable",
        "Project change notifications are unavailable.",
      );
  };
  return {
    notify() {
      if (closed) return;
      if (sequence === Number.MAX_SAFE_INTEGER) {
        session = randomBytes(16).toString("hex");
        sequence = 0;
      } else ++sequence;
      for (const listener of listeners) listener();
    },
    fail(error: Error) {
      failure = error;
      for (const listener of listeners) listener();
    },
    async wait(previous?: string, signal?: AbortSignal): Promise<ProjectChange> {
      requireAvailable();
      if (signal?.aborted)
        throw new AuthorError(409, "cli-cancelled", "Change observation was cancelled.");
      if (previous !== cursor()) return { cursor: cursor(), changed: true };
      return new Promise((resolve, reject) => {
        const finish = () => {
          listeners.delete(finish);
          clearTimeout(timer);
          signal?.removeEventListener("abort", finish);
          try {
            requireAvailable();
            if (signal?.aborted)
              throw new AuthorError(409, "cli-cancelled", "Change observation was cancelled.");
            resolve({ cursor: cursor(), changed: previous !== cursor() });
          } catch (error) {
            reject(error);
          }
        };
        const timer = setTimeout(finish, 20_000);
        listeners.add(finish);
        signal?.addEventListener("abort", finish, { once: true });
        if (signal?.aborted) finish();
      });
    },
    close() {
      closed = true;
      for (const listener of listeners) listener();
    },
  };
};

export const watchProjectChanges = async (
  directory: string,
  mode: "source" | "dist" = "source",
): Promise<ProjectChanges> => {
  const root = resolve(directory);
  const changes = createProjectChanges();
  const watchers = new Map<string, { watcher: FSWatcher; device: number; inode: number }>();
  const dependencyWatchers = new Map<string, { watcher: FSWatcher; names: Set<string> }>();
  let selectedLockDirectory: string | undefined;
  const excluded = new Set([".git", ".unframe", "dist", "node_modules"]);
  const ignored = (parent: string, name: string) =>
    mode === "source" &&
    (excluded.has(name) ||
      (parent === root && [".unframe-source.lock", ".unframe-build.lock"].includes(name)));
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scanning = Promise.resolve();
  const reconcileDependencies = async () => {
    if (mode !== "source") return;
    try {
      selectedLockDirectory = (await readPnpmProjectLock(root)).directory;
    } catch (error) {
      if (!(error instanceof PnpmProjectLockError)) throw error;
      selectedLockDirectory = error.directory;
    }
    const wanted = new Map<string, Set<string>>();
    const include = (directory: string, name: string) => {
      const names = wanted.get(directory) ?? new Set<string>();
      names.add(name);
      wanted.set(directory, names);
    };
    for (let directory = dirname(root); ; directory = dirname(directory)) {
      include(directory, "pnpm-workspace.yaml");
      if (dirname(directory) === directory) break;
    }
    if (selectedLockDirectory && selectedLockDirectory !== root) {
      include(selectedLockDirectory, "pnpm-lock.yaml");
      include(selectedLockDirectory, "pnpm-workspace.yaml");
    }
    if (closed) return;
    for (const [directory, existing] of dependencyWatchers) {
      const names = wanted.get(directory);
      if (names) existing.names = names;
      else {
        existing.watcher.close();
        dependencyWatchers.delete(directory);
      }
    }
    for (const [directory, names] of wanted) {
      if (dependencyWatchers.has(directory)) continue;
      const watcher = watch(directory, (_event, name) => {
        if (name !== null && dependencyWatchers.get(directory)?.names.has(name.toString()))
          schedule();
      });
      watcher.on("error", (error) => changes.fail(error));
      dependencyWatchers.set(directory, { watcher, names });
    }
  };
  const reconcile = async () => {
    const seen = new Set<string>();
    const scan = async (path: string) => {
      if (closed) return;
      const stat = await lstat(path).catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          ["ENOENT", "ENOTDIR"].includes(String(error.code))
        )
          return undefined;
        throw error;
      });
      if (closed || !stat?.isDirectory() || stat.isSymbolicLink()) return;
      seen.add(path);
      const existing = watchers.get(path);
      if (existing && (existing.device !== stat.dev || existing.inode !== stat.ino)) {
        existing.watcher.close();
        watchers.delete(path);
      }
      if (!watchers.has(path)) {
        try {
          const watcher = watch(path, (_event, name) => {
            if (name === null || !ignored(path, name.toString())) schedule();
          });
          watcher.on("error", (error) => changes.fail(error));
          watchers.set(path, { watcher, device: stat.dev, inode: stat.ino });
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            ["ENOENT", "ENOTDIR"].includes(String(error.code))
          )
            return;
          throw error;
        }
      }
      const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          ["ENOENT", "ENOTDIR"].includes(String(error.code))
        )
          return [];
        throw error;
      });
      for (const entry of entries)
        if (entry.isDirectory() && !ignored(path, entry.name)) await scan(join(path, entry.name));
    };
    await scan(root);
    await reconcileDependencies();
    if (closed) return;
    for (const [path, value] of watchers)
      if (!seen.has(path)) {
        value.watcher.close();
        watchers.delete(path);
      }
  };
  const schedule = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      scanning = scanning
        .then(reconcile)
        .then(() => changes.notify())
        .catch((error: unknown) =>
          changes.fail(error instanceof Error ? error : new Error("Project watch failed.")),
        );
    }, 100);
  };
  const parent = watch(dirname(root), (_event, name) => {
    if (name === null || name.toString() === basename(root)) schedule();
  });
  parent.on("error", (error) => changes.fail(error));
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    parent.close();
    for (const value of watchers.values()) value.watcher.close();
    watchers.clear();
    for (const value of dependencyWatchers.values()) value.watcher.close();
    dependencyWatchers.clear();
    changes.close();
  };
  try {
    await reconcile();
    return { wait: changes.wait, close };
  } catch (error) {
    close();
    throw error;
  }
};
