import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  checkAuthoringProject,
  checkAuthoringProjectAssembly,
  computeFrozenComponentInputs,
} from "@unframe/unframe-compiler";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { discoverPresentationProjectFiles } from "./discover-project.js";
import { loadUnframeLock } from "./load-lock.js";
import { hashDependencyGraph, type UnframeLock } from "./lock.js";
import { digestBytes, lockedFile } from "./package-snapshot.js";
import { projectDirectory, readDirectoryNames, readRegularFile } from "./path-policy.js";
import { acquireSourceLock } from "./source-lock.js";
import { acquireBuildLock } from "./build-lock.js";

type RefreshResult = { ok: true; revision: string } | { ok: false; code: string; message: string };

/** Refresh local closure hashes without installing or replacing the locked package snapshot. */
export const refreshLocalProjectLock = async (
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
  const lease = options.sourceLeaseHeld ? undefined : await acquireSourceLock(directory, options);
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
    const loaded = loadUnframeLock(found.lockBytes);
    if (!loaded.ok) return failure(loaded.diagnostic.code, loaded.diagnostic.message);
    const source = {
      projectRoot: found.projectDirectory,
      entryFile: found.entryFile,
      files: found.files,
      rawFiles: found.localFiles
        .filter(({ path }) => /\.(js|mjs|cjs|css|png|jpe?g|webp|ttf|otf)$/i.test(path))
        .map(({ path, bytes }) => lockedFile(path, bytes)),
      ...loaded.value.virtualSource,
    };
    const catalog = checkAuthoringProject(source);
    if (!catalog.valid)
      return failure(
        "cli-lock-source-invalid",
        catalog.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
      );
    const computed = computeFrozenComponentInputs(source, catalog.value);
    if (!computed.valid)
      return failure(
        "cli-lock-input-invalid",
        computed.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
      );
    const next = {
      ...loaded.value.lock,
      componentLocks: computed.value.componentLocks,
      themeHashes: computed.value.themeHashes,
    } as UnframeLock;
    next.dependencyGraphHash = hashDependencyGraph(next);
    const bytes = new TextEncoder().encode(canonicalizeJsonPayload(next) + "\n");
    const validated = loadUnframeLock(bytes);
    if (!validated.ok) return failure(validated.diagnostic.code, validated.diagnostic.message);
    const checked = checkAuthoringProjectAssembly(source, validated.value.assemblyCarrier);
    if (!checked.valid)
      return failure(
        "cli-lock-assembly-invalid",
        checked.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
      );
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
    const inputs = [
      { path: "unframe.config.ts", bytes: config },
      { path: "unframe.lock", bytes },
      ...found.localFiles,
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const expected = digestBytes(
      new TextEncoder().encode(
        JSON.stringify(inputs.map(({ path, bytes }) => [path, digestBytes(bytes).slice(7)])),
      ),
    );
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
