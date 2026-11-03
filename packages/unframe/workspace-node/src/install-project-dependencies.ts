import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readRegularFile } from "./path-policy.js";
import { readPnpmProjectLock } from "./package-snapshot.js";

const execute = promisify(execFile);

/** Install only the graph already recorded by pnpm, without executing project hooks. */
export async function installProjectDependencies(directory: string, signal?: AbortSignal) {
  const failure = (code: string, message: string) => ({ ok: false as const, code, message });
  if (signal?.aborted) return failure("cli-cancelled", "Dependency synchronization was cancelled.");
  if (!(await readRegularFile(join(directory, "package.json"))))
    return failure(
      "cli-lock-package-input-missing",
      "Dependency synchronization requires package.json and pnpm-lock.yaml.",
    );
  try {
    const context = await readPnpmProjectLock(directory);
    await execute(
      "pnpm",
      [
        "install",
        "--prod=false",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        ...(context.workspaceBytes ? [] : ["--force"]),
        "--verify-store-integrity",
        ...(context.importerKey === "." ? [] : ["--filter", `./${context.importerKey}...`]),
      ],
      { cwd: context.directory, signal, timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
    return { ok: true as const };
  } catch {
    return signal?.aborted
      ? failure("cli-cancelled", "Dependency synchronization was cancelled.")
      : failure(
          "cli-lock-install-failed",
          "Frozen dependency installation failed. Ensure package.json matches pnpm-lock.yaml and dependencies are available, then retry.",
        );
  }
}
