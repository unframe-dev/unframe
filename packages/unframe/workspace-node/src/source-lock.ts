import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { acquireFileLease } from "./build-lock.js";
import { readDirectoryNames, readRegularFile } from "./path-policy.js";

type SourceLeaseScope = { directory: string; active: boolean; writing: boolean };
const currentSourceLease = new AsyncLocalStorage<SourceLeaseScope>();
export type SourceLease = Readonly<{
  release(): Promise<void>;
  run<T>(action: () => Promise<T>): Promise<T>;
}>;

const recoveryRequired = async (directory: string): Promise<boolean> => {
  const root = join(directory, ".unframe", "authoring", "transactions");
  const stat = await lstat(root).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (!stat) return false;
  const names = await readDirectoryNames(root);
  if (!names) return true;
  for (const name of names) {
    if (!/^[0-9a-f]{32}$/.test(name)) return true;
    const bytes = await readRegularFile(join(root, name, "journal.json"));
    if (!bytes) return true;
    try {
      const journal: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (
        !journal ||
        typeof journal !== "object" ||
        !("state" in journal) ||
        journal.state !== "committed"
      )
        return true;
    } catch {
      return true;
    }
  }
  return false;
};
export const acquireSourceLock = async (
  directory: string,
  options: { allowRecovery?: boolean; waitTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<
  | { ok: true; value: SourceLease }
  | {
      ok: false;
      code:
        | "cli-source-lock-unavailable"
        | "cli-source-lock-io"
        | "cli-source-recovery-required"
        | "cli-cancelled";
    }
> => {
  const deadline = Date.now() + (options.waitTimeoutMs ?? 0);
  let lease;
  while (true) {
    if (options.signal?.aborted) return { ok: false, code: "cli-cancelled" };
    lease = await acquireFileLease(directory, { lstat, open, unlink }, ".unframe-source.lock");
    if (lease.ok || lease.code !== "cli-build-lock-unavailable" || Date.now() >= deadline) break;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(25, Math.max(0, deadline - Date.now())));
      options.signal?.addEventListener("abort", done, { once: true });
      if (options.signal?.aborted) done();
    });
  }
  if (options.signal?.aborted) {
    if (lease.ok) await lease.value.release();
    return { ok: false, code: "cli-cancelled" };
  }
  if (!lease.ok)
    return {
      ok: false,
      code:
        lease.code === "cli-build-lock-unavailable"
          ? "cli-source-lock-unavailable"
          : "cli-source-lock-io",
    };
  try {
    if (!options.allowRecovery && (await recoveryRequired(directory))) {
      await lease.value.release();
      return { ok: false, code: "cli-source-recovery-required" };
    }
    const owned = lease.value;
    const scope: SourceLeaseScope = { directory, active: true, writing: false };
    let releaseAttempt: Promise<void> | undefined;
    return {
      ok: true,
      value: Object.freeze({
        release: async () => {
          if (scope.writing) throw new Error("Source transaction is still running.");
          scope.active = false;
          releaseAttempt ??= owned.release().catch((error: unknown) => {
            releaseAttempt = undefined;
            throw error;
          });
          await releaseAttempt;
        },
        run: async <T>(action: () => Promise<T>): Promise<T> => {
          if (!scope.active) throw new Error("Source lease has been released.");
          return currentSourceLease.run(scope, action);
        },
      }),
    };
  } catch {
    await lease.value.release();
    return { ok: false, code: "cli-source-lock-io" };
  }
};

/** Source and lock replacement, including recovery, share one writer per source lease. */
export const withSourceTransaction = async <T>(
  directory: string,
  action: () => Promise<T>,
): Promise<T> => {
  const scope = currentSourceLease.getStore();
  if (scope?.directory === directory) {
    if (!scope.active || scope.writing) throw new Error("Source transaction is unavailable.");
    scope.writing = true;
    try {
      return await action();
    } finally {
      scope.writing = false;
    }
  }
  const acquired = await acquireSourceLock(directory, { allowRecovery: true });
  if (!acquired.ok) throw new Error(`Source transaction is unavailable: ${acquired.code}`);
  try {
    return await acquired.value.run(() => withSourceTransaction(directory, action));
  } finally {
    await acquired.value.release();
  }
};
