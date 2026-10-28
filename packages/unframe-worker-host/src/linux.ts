import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  mkdirSync,
  rmdirSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  WorkerIsolationError,
  unavailable,
  DEADLINE_MS,
  CLOSE_GRACE_MS,
  type IsolatedWorkerInput,
  type IsolatedWorkerOptions,
} from "./common.js";
import { cgroupFor, verifyMembership } from "./linux-processes.js";
import { workerProtocol } from "./protocol.js";
const MEMORY_MAX = "1073741824";
const PIDS_MAX = "128";
export const assertLinuxIsolationAvailable = (
  options: { readonly cgroupRoot?: string; readonly nodePath?: string } = {},
): void => {
  if (process.platform !== "linux") throw unavailable("opaque capture requires Linux");
  delegatedRoot(options.cgroupRoot);
  for (const path of [
    process.env.UNFRAME_BWRAP_PATH,
    process.env.UNFRAME_BASH_PATH,
    options.nodePath ?? process.execPath,
    process.env.UNFRAME_NIX_LD_SHIM,
  ]) {
    if (!path || !existsSync(path))
      throw unavailable("pinned isolation executables are unavailable");
    storeRootForExecutable(path);
  }
};

const storeRootForExecutable = (path: string): string => {
  const real = realpathSync(path);
  const match = /^\/nix\/store\/[^/]+/.exec(real);
  if (!match) throw unavailable("isolation executable is not pinned in the Nix store");
  return match[0];
};

const readWordSet = (path: string): Set<string> =>
  new Set(readFileSync(path, "utf8").trim().split(/\s+/));

const eventCount = (path: string, name: string): number => {
  const entry = readFileSync(path, "utf8")
    .split("\n")
    .find((line) => line.startsWith(`${name} `));
  return entry ? Number(entry.slice(name.length + 1)) : 0;
};

const waitForEmptyGroup = async (group: string): Promise<boolean> => {
  const deadline = Date.now() + CLOSE_GRACE_MS;
  while (Date.now() < deadline) {
    if (eventCount(join(group, "cgroup.events"), "populated") === 0) return true;
    await new Promise((done) => setTimeout(done, 20));
  }
  return eventCount(join(group, "cgroup.events"), "populated") === 0;
};

const requireContained = (path: string, root: string): void => {
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw unavailable("cgroup root is outside the process delegation");
};

const delegatedRoot = (configured?: string): string => {
  const self = resolve("/sys/fs/cgroup", `.${cgroupFor(process.pid)}`);
  const requested = configured ?? process.env.UNFRAME_OPAQUE_CGROUP_ROOT;
  const root = requested ? realpathSync(requested) : dirname(self);
  requireContained(self, root);
  if (root === self) throw unavailable("capture host must run in a child of a delegated cgroup");
  const enabled = readWordSet(join(root, "cgroup.subtree_control"));
  if (!enabled.has("memory") || !enabled.has("pids"))
    throw unavailable("memory and pids controllers are not delegated");
  if (!existsSync(join(root, "cgroup.kill"))) throw unavailable("cgroup kill is unavailable");
  return root;
};

const runtimeRoot = (path: string): string => {
  const real = realpathSync(path);
  const match = /^\/nix\/store\/[^/]+/.exec(real);
  if (!match) throw unavailable("runtime paths must be pinned Nix store roots");
  return match[0];
};

const mountDirectories = (path: string): string[] => {
  const parts = dirname(path).split(sep).filter(Boolean);
  const directories: string[] = [];
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    directories.push(current);
  }
  return directories;
};

const sandboxArguments = (
  workerDirectory: string,
  additionalMounts: IsolatedWorkerInput["mounts"],
  workerEnvironment: IsolatedWorkerInput["environment"],
  runtimePaths: readonly string[],
  configuredNode?: string,
  runtimeEnvironment?: Readonly<Record<string, string>>,
): string[] => {
  const nodePath = realpathSync(configuredNode ?? process.execPath);
  const storePaths = [
    ...new Set([
      runtimeRoot(nodePath),
      runtimeRoot(process.env.UNFRAME_NIX_LD_SHIM!),
      ...runtimePaths.map(runtimeRoot),
    ]),
  ].sort();
  const mounts = [
    ...storePaths.map((path) => [path, path] as const),
    [workerDirectory, "/worker"] as const,
    ...(additionalMounts ?? []).map(
      ({ source, destination }) => [realpathSync(source), destination] as const,
    ),
    [realpathSync(process.env.UNFRAME_NIX_LD_SHIM!), "/lib64/ld-linux-x86-64.so.2"] as const,
  ];
  const directories = [
    ...new Set(mounts.flatMap(([, destination]) => mountDirectories(destination))),
  ];
  const args = [
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-net",
    "--unshare-uts",
    "--new-session",
    "--die-with-parent",
    "--clearenv",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--tmpfs",
    "/tmp",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
  ];
  for (const [name, value] of Object.entries(workerEnvironment ?? {}))
    args.push("--setenv", name, value);
  const environment = runtimeEnvironment ?? process.env;
  for (const name of ["NIX_LD", "NIX_LD_LIBRARY_PATH", "FONTCONFIG_FILE"] as const) {
    const value = environment[name];
    if (value) args.push("--setenv", name, value);
  }
  for (const directory of directories) args.push("--dir", directory);
  for (const [source, destination] of mounts) args.push("--ro-bind", source, destination);
  args.push("--", nodePath, "/worker/worker.mjs");
  return args;
};

export const runLinuxWorker = async (
  input: IsolatedWorkerInput,
  options: IsolatedWorkerOptions = {},
): Promise<unknown> => {
  if (options.signal?.aborted)
    throw new WorkerIsolationError("opaque-capture-cancelled", "capture cancelled");
  if (
    options.deadlineMs !== undefined &&
    (!Number.isSafeInteger(options.deadlineMs) ||
      options.deadlineMs < 1 ||
      options.deadlineMs > DEADLINE_MS)
  )
    throw unavailable("capture deadline must not exceed the isolation profile");
  assertLinuxIsolationAvailable(options);
  const root = delegatedRoot(options.cgroupRoot);
  const bwrap = process.env.UNFRAME_BWRAP_PATH!;
  const bash = process.env.UNFRAME_BASH_PATH!;
  if (!input.workerPath.endsWith("/worker.mjs"))
    throw unavailable("worker bundle entry must be worker.mjs");
  const workerDirectory = realpathSync(dirname(input.workerPath));
  const groupName = `unframe-worker-${randomUUID()}`;
  const group = join(root, groupName);
  const groupRelative = `/${relative("/sys/fs/cgroup", group)}`;
  let child: ChildProcess | undefined;
  let childClosed: Promise<void> | undefined;
  let stdioFailure: Promise<never> | undefined;
  let stdioError: WorkerIsolationError | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  let value: unknown;
  let failure: WorkerIsolationError | undefined;
  let cleanupFailure = false;
  let resourceLimitHit = false;
  mkdirSync(group);
  try {
    writeFileSync(join(group, "memory.max"), MEMORY_MAX);
    writeFileSync(join(group, "pids.max"), PIDS_MAX);
    if (
      readFileSync(join(group, "memory.max"), "utf8").trim() !== MEMORY_MAX ||
      readFileSync(join(group, "pids.max"), "utf8").trim() !== PIDS_MAX
    )
      throw unavailable("resource limits were not applied");
    const args = sandboxArguments(
      workerDirectory,
      input.mounts,
      input.environment,
      input.runtimePaths,
      options.nodePath,
      options.runtimeEnvironment,
    );
    child = spawn(
      bash,
      [
        "-c",
        'IFS= read -r permit <&3 || exit 77; [ "$permit" = go ] || exit 77; exec 3<&-; exec "$@"',
        "unframe-bootstrap",
        bwrap,
        ...args,
      ],
      { stdio: ["pipe", "pipe", "pipe", "pipe"], env: {}, detached: true },
    );
    const worker = child;
    childClosed = new Promise<void>((done) => worker.once("close", () => done()));
    stdioFailure = new Promise<never>((_, reject) => {
      const failStdio = () => {
        stdioError ??= new WorkerIsolationError("opaque-capture-failed", "worker stdio failed");
        reject(stdioError);
      };
      worker.stdin?.on("error", failStdio);
      worker.stdout?.on("error", failStdio);
      worker.stderr?.on("error", failStdio);
    });
    void stdioFailure.catch(() => undefined);
    const barrier = worker.stdio[3];
    if (!barrier || !("write" in barrier))
      throw unavailable("trusted bootstrap barrier is unavailable");
    // The barrier has no response; bootstrap and ready messages confirm that the permit arrived.
    barrier.on("error", () => undefined);
    if (!child.pid) throw unavailable("trusted bootstrap did not start");
    writeFileSync(join(group, "cgroup.procs"), String(child.pid));
    verifyMembership(child.pid, groupRelative, "ready");
    barrier.write("go\n");
    barrier.end();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new WorkerIsolationError("opaque-capture-timeout", "capture deadline exceeded")),
        options.deadlineMs ?? DEADLINE_MS,
      );
    });
    value = await Promise.race([
      workerProtocol(
        worker,
        (phase) => verifyMembership(worker.pid!, groupRelative, phase),
        input.input,
        options.signal,
      ),
      deadline,
      stdioFailure,
    ]);
    worker.stdin?.end();
    completed = true;
  } catch (error) {
    failure =
      error === stdioError && options.signal?.aborted
        ? new WorkerIsolationError("opaque-capture-cancelled", "capture cancelled")
        : error instanceof WorkerIsolationError
          ? error
          : unavailable(error instanceof Error ? error.message : "isolation setup failed");
  } finally {
    if (timer) clearTimeout(timer);
    if (child) {
      if (!completed) child.kill("SIGTERM");
      await new Promise<void>((done) => {
        if (child!.exitCode !== null || child!.signalCode !== null) return done();
        const closeTimer = setTimeout(done, CLOSE_GRACE_MS);
        child!.once("exit", () => {
          clearTimeout(closeTimer);
          done();
        });
      });
      try {
        writeFileSync(join(group, "cgroup.kill"), "1");
      } catch {
        /* cgroup cleanup is verified below */
      }
      if (!(await waitForEmptyGroup(group))) cleanupFailure = true;
      if (childClosed) {
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        const closed = await Promise.race([
          childClosed.then(() => true),
          new Promise<false>((done) => {
            closeTimer = setTimeout(() => done(false), CLOSE_GRACE_MS);
          }),
        ]);
        if (closeTimer) clearTimeout(closeTimer);
        if (!closed) cleanupFailure = true;
      }
    }
    try {
      resourceLimitHit =
        eventCount(join(group, "memory.events"), "oom_kill") > 0 ||
        eventCount(join(group, "pids.events"), "max") > 0;
    } catch {
      cleanupFailure = true;
    }
    try {
      rmdirSync(group);
    } catch {
      cleanupFailure = true;
    }
  }
  if (cleanupFailure) throw unavailable("resource cgroup cleanup failed");
  if (resourceLimitHit)
    throw new WorkerIsolationError(
      "opaque-capture-resource-limit",
      "worker exceeded a hard resource limit",
    );
  if (!failure && stdioError && !options.signal?.aborted) throw stdioError;
  if (failure) throw failure;
  return value;
};
