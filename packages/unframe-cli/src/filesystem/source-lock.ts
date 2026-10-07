import { lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { acquireFileLease, type BuildLock } from "./build-lock.js";
import { readDirectoryNames, readRegularFile } from "./path-policy.js";

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
  options: { allowRecovery?: boolean } = {},
): Promise<
  | { ok: true; value: BuildLock }
  | {
      ok: false;
      code: "cli-source-lock-unavailable" | "cli-source-lock-io" | "cli-source-recovery-required";
    }
> => {
  const lease = await acquireFileLease(directory, { lstat, open, unlink }, ".unframe-source.lock");
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
    return lease;
  } catch {
    await lease.value.release();
    return { ok: false, code: "cli-source-lock-io" };
  }
};
