import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const unzip = process.platform === "darwin" ? "/usr/bin/unzip" : "unzip";
const archiveLimit = 100 * 1024 * 1024;
const binaryLimit = 200 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function command(args, maxBuffer = 1024 * 1024) {
  try {
    return (
      await execute(args[0], args.slice(1), {
        encoding: "buffer",
        timeout: 120_000,
        killSignal: "SIGKILL",
        maxBuffer,
      })
    ).stdout;
  } catch {
    // Child output can contain credentials from GitHub or local environment configuration.
    throw new Error("External command failed or timed out.");
  }
}

async function jsonCommand(args) {
  try {
    return JSON.parse(await command(args));
  } catch {
    throw new Error("External command failed or returned invalid JSON.");
  }
}

async function prepareActivity(config, force) {
  try {
    const activity = await jsonCommand([...config.activityCommand, "prepare"]);
    if (!Number.isSafeInteger(activity.activeSessions) || activity.activeSessions < 0)
      throw new Error("Invalid session activity response.");
    return activity;
  } catch (error) {
    if (!force) throw error;
    return { activeSessions: 0 };
  }
}

function validateConfig(config) {
  if (config.repository !== "unframe-dev/unframe" || config.workflow !== "ci.yml")
    throw new Error("Unexpected repository or workflow.");
  for (const key of ["directory", "deploymentDirectory", "gh", "node"]) {
    if (typeof config[key] !== "string" || !isAbsolute(config[key]))
      throw new Error(`Configuration ${key} must be absolute.`);
  }
  if (resolve(config.directory) === resolve(config.deploymentDirectory))
    throw new Error("Updater and deployment directories must differ.");
  for (const key of [
    "activityCommand",
    "restartCommand",
    "healthCommand",
    "rollbackHealthCommand",
  ]) {
    if (
      !Array.isArray(config[key]) ||
      !config[key].length ||
      !isAbsolute(config[key][0]) ||
      !config[key].every((part) => typeof part === "string")
    )
      throw new Error(`Invalid ${key}.`);
  }
}

async function syncPath(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flush: true });
  await rename(temporary, path);
  await syncPath(dirname(path));
}

async function lock(directory, name = "lock", depth = 0) {
  if (depth > 16) throw new Error("Too many interrupted lock recoveries.");
  const path = join(directory, name);
  const prepared = join(directory, `lock-${randomUUID()}`);
  await mkdir(prepared, { mode: 0o700 });
  await writeFile(join(prepared, "owner.json"), JSON.stringify({ pid: process.pid }));
  const acquire = async () => {
    try {
      await rename(prepared, path);
      return true;
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      return false;
    }
  };
  const deadOwner = async () => {
    let owner;
    try {
      owner = JSON.parse(await readFile(join(path, "owner.json")));
    } catch {
      return false;
    }
    if (!Number.isInteger(owner.pid) || owner.pid < 1) return false;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      return error.code === "ESRCH";
    }
  };
  let releaseRecovery;
  try {
    if (!(await acquire())) {
      if (!(await deadOwner())) return null;
      // Recovery itself is a PID-owned lock, allowing recovery after an interrupted recovery.
      releaseRecovery = await lock(directory, `${name}.reclaim`, depth + 1);
      if (!releaseRecovery || !(await deadOwner())) return null;
      await rm(path, { recursive: true });
      if (!(await acquire())) return null;
    }
    return () => rm(path, { recursive: true, force: true });
  } finally {
    await rm(prepared, { recursive: true, force: true });
    if (releaseRecovery) await releaseRecovery();
  }
}

function validateArchive(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (
    end < 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== 2 ||
    bytes.readUInt16LE(end + 10) !== 2
  )
    throw new Error("Invalid artifact ZIP directory.");
  let offset = bytes.readUInt32LE(end + 16);
  const directoryEnd = offset + bytes.readUInt32LE(end + 12);
  const names = new Set();
  for (let n = 0; n < 2; n++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid artifact ZIP entry.");
    const length = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString("utf8");
    const size = bytes.readUInt32LE(offset + 24);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16;
    if (
      !["runtime-host", "manifest.json"].includes(name) ||
      names.has(name) ||
      bytes.readUInt16LE(offset + 8) & 1 ||
      (mode & 0xf000) === 0xa000 ||
      size > (name === "manifest.json" ? 16384 : binaryLimit)
    )
      throw new Error("Unsafe artifact ZIP entry.");
    names.add(name);
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  if (offset !== directoryEnd || directoryEnd !== end)
    throw new Error("Invalid artifact ZIP layout.");
}

async function findRun(config) {
  // The newest repository artifacts bound discovery work even before the first release exists.
  const response = await jsonCommand([
    config.gh,
    "api",
    `repos/${config.repository}/actions/artifacts?per_page=100`,
  ]);
  if (!Array.isArray(response.artifacts)) throw new Error("Invalid artifact response.");
  const artifacts = response.artifacts.filter(
    (artifact) =>
      !artifact.expired &&
      /^runtime-host-darwin-arm64-[0-9a-f]{40}$/.test(artifact.name) &&
      Number.isSafeInteger(artifact.workflow_run?.id) &&
      artifact.workflow_run.id > 0,
  );
  if (!artifacts.length) return null;
  const oldestRun = Math.min(...artifacts.map((artifact) => artifact.workflow_run.id));
  for (let page = 1; ; page++) {
    const response = await jsonCommand([
      config.gh,
      "api",
      `repos/${config.repository}/actions/workflows/${config.workflow}/runs?branch=main&event=push&status=success&per_page=100&page=${page}`,
    ]);
    if (!Array.isArray(response.workflow_runs)) throw new Error("Invalid workflow response.");
    const runs = response.workflow_runs.filter(
      (item) =>
        Number.isSafeInteger(item.id) &&
        item.id > 0 &&
        item.status === "completed" &&
        item.conclusion === "success" &&
        item.event === "push" &&
        item.head_branch === "main" &&
        item.head_repository?.full_name === config.repository &&
        /^[0-9a-f]{40}$/.test(item.head_sha),
    );
    for (const run of runs) {
      const matches = artifacts.filter(
        (artifact) =>
          artifact.workflow_run.id === run.id &&
          artifact.name === `runtime-host-darwin-arm64-${run.head_sha}`,
      );
      if (matches.length > 1) throw new Error("Ambiguous deployment artifacts.");
      if (matches.length === 1) {
        const artifact = matches[0];
        if (
          !Number.isSafeInteger(artifact.id) ||
          artifact.id < 1 ||
          !/^sha256:[0-9a-f]{64}$/.test(artifact.digest)
        )
          throw new Error("Artifact digest is missing or invalid.");
        return { ...run, artifact };
      }
    }
    if (
      response.workflow_runs.length < 100 ||
      response.workflow_runs.every((run) => run.id < oldestRun)
    )
      return null;
  }
}

async function getArtifact(config, run) {
  const bytes = await command(
    [config.gh, "api", `repos/${config.repository}/actions/artifacts/${run.artifact.id}/zip`],
    archiveLimit,
  );
  if (`sha256:${hash(bytes)}` !== run.artifact.digest) throw new Error("Artifact digest mismatch.");
  validateArchive(bytes);
  return bytes;
}

export async function update(config, { force = false, check = false } = {}) {
  validateConfig(config);
  // Check mode avoids creating state, locks, or downloaded files.
  if (check) {
    const run = await findRun(config);
    return run
      ? { status: "available", sha: run.head_sha, runId: run.id }
      : { status: "unavailable" };
  }
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(config.directory);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.uid !== process.getuid() ||
    (directoryInfo.mode & 0o077) !== 0
  )
    throw new Error("Updater directory must be private and owned by the current user.");
  const unlock = await lock(config.directory);
  if (!unlock) return { status: "locked" };
  let result;
  const outcome = (value) => {
    result = value;
    return value;
  };
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  const statePath = join(config.directory, "state.json");
  const pendingPath = join(config.directory, "pending.json");
  let recovering = false;
  let state = {};
  let target;
  let swapped = false;
  const drainAttempted = true;
  const release = join(config.deploymentDirectory, "release");
  const binary = join(release, "runtime-host");
  const backup = join(release, "runtime-host.previous");
  const candidate = join(release, `.runtime-host-${randomUUID()}`);
  const archive = join(config.directory, `artifact-${randomUUID()}.zip`);
  try {
    try {
      state = JSON.parse(await readFile(statePath));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Invalid updater state.");
    }
    let pending;
    try {
      pending = JSON.parse(await readFile(pendingPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Invalid pending update state.");
    }
    if (pending) {
      if (
        !/^[0-9a-f]{40}$/.test(pending.sha) ||
        !Number.isSafeInteger(pending.runId) ||
        !pending.previousState ||
        typeof pending.previousState !== "object"
      )
        throw new Error("Invalid pending update state.");
      target = { head_sha: pending.sha, id: pending.runId };
      const activity = await prepareActivity(config, force);
      if (!force && activity.activeSessions > 0)
        return outcome({
          status: "deferred",
          sha: pending.sha,
          runId: pending.runId,
          activeSessions: activity.activeSessions,
        });
      if (interrupted) throw new Error("Update interrupted before recovery.");
      recovering = true;
      await copyFile(backup, candidate);
      await chmod(candidate, 0o755);
      await rename(candidate, binary);
      await command(config.restartCommand);
      await command(config.rollbackHealthCommand);
      state = {
        ...pending.previousState,
        failedSha: pending.sha,
        failedRunId: pending.runId,
        rollback: "succeeded",
        failedAt: new Date().toISOString(),
      };
      await atomicJson(statePath, state);
      await rm(pendingPath);
      recovering = false;
    }
    target = await findRun(config);
    if (!target) return outcome({ status: "unavailable" });
    const identity = { sha: target.head_sha, runId: target.id };
    if (
      (state.sha === target.head_sha && state.failedSha !== target.head_sha) ||
      (!force && Number.isSafeInteger(state.runId) && state.runId > target.id)
    )
      return outcome({ status: "current", sha: state.sha, runId: state.runId });
    if (!force && state.failedSha === target.head_sha)
      return outcome({ status: "failed-previously", ...identity });
    const activity = await prepareActivity(config, force);
    if (!force && activity.activeSessions > 0)
      return outcome({ status: "deferred", ...identity, activeSessions: activity.activeSessions });
    await writeFile(archive, await getArtifact(config, target), { mode: 0o600 });
    let manifest;
    try {
      manifest = JSON.parse(await command([unzip, "-p", archive, "manifest.json"], 16384));
    } catch {
      throw new Error("Artifact manifest is invalid.");
    }
    const bytes = await command([unzip, "-p", archive, "runtime-host"], binaryLimit);
    if (
      !manifest ||
      manifest.schemaVersion !== 1 ||
      manifest.repository !== config.repository ||
      manifest.sha !== target.head_sha ||
      manifest.platform !== "darwin" ||
      manifest.arch !== "arm64" ||
      manifest.sha256 !== hash(bytes)
    )
      throw new Error("Artifact manifest mismatch.");
    if (interrupted) throw new Error("Update interrupted before activation.");
    if (!(await lstat(binary)).isFile())
      throw new Error("Installed runtime-host must be a regular file.");
    await writeFile(candidate, bytes, { mode: 0o755, flush: true });
    await chmod(candidate, 0o755);
    await copyFile(binary, `${backup}.tmp`);
    await syncPath(`${backup}.tmp`);
    await rename(`${backup}.tmp`, backup);
    await syncPath(release);
    await atomicJson(pendingPath, { ...identity, previousState: state });
    await rename(candidate, binary);
    swapped = true;
    await syncPath(release);
    await command(config.restartCommand);
    await command(config.healthCommand);
    if (interrupted) throw new Error("Update interrupted during activation.");
    await atomicJson(statePath, { ...identity, updatedAt: new Date().toISOString() });
    await rm(pendingPath);
    return outcome({ status: "updated", ...identity });
  } catch (error) {
    let rollback = recovering ? "failed" : "not-needed";
    if (swapped) {
      try {
        await copyFile(backup, candidate);
        await chmod(candidate, 0o755);
        await rename(candidate, binary);
        await command(config.restartCommand);
        await command(config.rollbackHealthCommand);
        rollback = "succeeded";
      } catch {
        rollback = "failed";
      }
    }
    if (target && (swapped || /Artifact|ZIP/.test(error.message)))
      await atomicJson(statePath, {
        ...state,
        failedSha: target.head_sha,
        failedRunId: target.id,
        rollback,
        failedAt: new Date().toISOString(),
      });
    if (swapped && rollback === "succeeded") await rm(pendingPath, { force: true });
    return outcome({
      status: "failed",
      ...(target ? { sha: target.head_sha, runId: target.id } : {}),
      rollback,
      message: error instanceof Error ? error.message : "Update failed.",
    });
  } finally {
    await rm(archive, { force: true });
    await rm(candidate, { force: true });
    let releaseFailed = false;
    if (drainAttempted) {
      try {
        await command([...config.activityCommand, "release"]);
      } catch {
        releaseFailed = true;
      }
    }
    await unlock();
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
    if (releaseFailed && result) {
      result.status = "failed";
      result.drainRelease = "failed";
      result.message = `${result.message ? `${result.message} ` : ""}Could not release deployment drain reservation.`;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (
      args[0] !== "--config" ||
      !args[1] ||
      !isAbsolute(args[1]) ||
      args.length > 3 ||
      (args[2] && !["--force", "--check"].includes(args[2]))
    )
      throw new Error("Usage: pull-update.mjs --config /absolute/config.json [--force|--check]");
    const config = JSON.parse(await readFile(args[1]));
    const result = await update(config, {
      force: args[2] === "--force",
      check: args[2] === "--check",
    });
    console.log(JSON.stringify(result));
    if (result.status === "failed") process.exitCode = 1;
  } catch {
    console.error("Realtime update failed: invalid configuration or unavailable local files.");
    process.exitCode = 1;
  }
}
