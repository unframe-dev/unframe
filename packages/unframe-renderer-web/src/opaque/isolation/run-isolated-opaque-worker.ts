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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MEMORY_MAX = "1073741824";
const PIDS_MAX = "128";
const DEADLINE_MS = 120_000;
const CLOSE_GRACE_MS = 2_000;
const MAX_PROTOCOL_BYTES = 128 * 1024 * 1024;

export class OpaqueIsolationError extends Error {
  constructor(
    readonly code:
      | "opaque-isolation-unavailable"
      | "opaque-capture-failed"
      | "opaque-capture-timeout"
      | "opaque-capture-cancelled"
      | "opaque-capture-resource-limit",
    message: string,
  ) {
    super(message);
    this.name = "OpaqueIsolationError";
  }
}

export type IsolatedOpaqueWorkerInput = {
  readonly workerPath: string;
  readonly browserPath: string;
  readonly runtimePaths: readonly string[];
  readonly input: unknown;
};

export type IsolatedOpaqueWorkerOptions = {
  readonly signal?: AbortSignal;
  readonly cgroupRoot?: string;
  readonly deadlineMs?: number;
};

export const assertOpaqueIsolationAvailable = (
  options: { readonly cgroupRoot?: string } = {},
): void => {
  if (process.platform !== "linux") throw unavailable("opaque capture requires Linux");
  delegatedRoot(options.cgroupRoot);
  for (const path of [
    process.env.UNFRAME_BWRAP_PATH,
    process.env.UNFRAME_BASH_PATH,
    process.env.UNFRAME_OPAQUE_NODE,
    process.env.UNFRAME_NIX_LD_SHIM,
  ]) {
    if (!path || !existsSync(path))
      throw unavailable("pinned isolation executables are unavailable");
    storeRootForExecutable(path);
  }
};

const unavailable = (message: string): OpaqueIsolationError =>
  new OpaqueIsolationError("opaque-isolation-unavailable", message);

const storeRootForExecutable = (path: string): string => {
  const real = realpathSync(path);
  const match = /^\/nix\/store\/[^/]+/.exec(real);
  if (!match) throw unavailable("isolation executable is not pinned in the Nix store");
  return match[0];
};

const cgroupFor = (pid: number): string => {
  const entry = readFileSync(`/proc/${pid}/cgroup`, "utf8")
    .split("\n")
    .find((line) => line.startsWith("0::"));
  if (!entry) throw unavailable("cgroup v2 membership is unavailable");
  return entry.slice(3);
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
  browserDirectory: string,
  browserName: string,
  runtimePaths: readonly string[],
): string[] => {
  const nodePath = realpathSync(process.env.UNFRAME_OPAQUE_NODE!);
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
    [browserDirectory, "/browser"] as const,
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
    "--setenv",
    "UNFRAME_BROWSER_EXECUTABLE",
    `/browser/${browserName}`,
    "--tmpfs",
    "/tmp",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
  ];
  for (const name of ["NIX_LD", "NIX_LD_LIBRARY_PATH", "FONTCONFIG_FILE"] as const) {
    const value = process.env[name];
    if (value) args.push("--setenv", name, value);
  }
  for (const directory of directories) args.push("--dir", directory);
  for (const [source, destination] of mounts) args.push("--ro-bind", source, destination);
  args.push("--", nodePath, "/worker/worker.mjs");
  return args;
};

const descendants = (pid: number): number[] => {
  const seen = new Set<number>();
  const pending = [pid];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    try {
      const children = readFileSync(`/proc/${current}/task/${current}/children`, "utf8")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number);
      pending.push(...children);
    } catch {
      throw unavailable("worker disappeared during cgroup verification");
    }
  }
  return [...seen];
};

const verifyMembership = (pid: number, group: string): void => {
  for (const descendant of descendants(pid)) {
    if (cgroupFor(descendant) !== group)
      throw unavailable("a browser descendant escaped the resource cgroup");
  }
};

const protocol = (
  child: ChildProcess,
  group: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<unknown> =>
  new Promise((resolveResult, rejectResult) => {
    let pendingChunks: Buffer[] = [];
    let pendingBytes = 0;
    let phase: "bootstrap" | "ready" | "result" = "bootstrap";
    let settled = false;
    const send = (value: unknown) => child.stdin?.write(`${JSON.stringify(value)}\n`);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      rejectResult(error);
    };
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolveResult(value);
    };
    const onAbort = () =>
      fail(new OpaqueIsolationError("opaque-capture-cancelled", "capture cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdin?.on("error", (error) => fail(error));
    child.stderr?.resume();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      let offset = 0;
      while (offset < chunk.length && !settled) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        const piece = chunk.subarray(offset, end);
        pendingChunks.push(piece);
        pendingBytes += piece.length;
        if (pendingBytes > MAX_PROTOCOL_BYTES) {
          fail(new OpaqueIsolationError("opaque-capture-failed", "worker output exceeds limit"));
          return;
        }
        if (newline < 0) break;
        const line = Buffer.concat(pendingChunks, pendingBytes).toString("utf8");
        pendingChunks = [];
        pendingBytes = 0;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          fail(new OpaqueIsolationError("opaque-capture-failed", "invalid worker protocol"));
          break;
        }
        try {
          if (phase === "bootstrap" && message.type === "bootstrap") {
            phase = "ready";
            send({ type: "launch" });
          } else if (phase === "ready" && message.type === "ready") {
            verifyMembership(child.pid!, group);
            phase = "result";
            send({ type: "capture", input });
          } else if (phase === "result" && message.type === "result") {
            verifyMembership(child.pid!, group);
            finish(message.value);
          } else if (message.type === "error") {
            fail(
              new OpaqueIsolationError(
                phase === "result" ? "opaque-capture-failed" : "opaque-isolation-unavailable",
                String(message.code ?? "worker error"),
              ),
            );
          } else {
            fail(
              new OpaqueIsolationError("opaque-capture-failed", "unexpected worker protocol phase"),
            );
          }
        } catch (error) {
          fail(error instanceof Error ? error : unavailable("worker verification failed"));
        }
        offset = newline + 1;
      }
    });
    child.once("error", (error) => fail(error));
    child.once("exit", () =>
      fail(
        new OpaqueIsolationError(
          phase === "result" ? "opaque-capture-failed" : "opaque-isolation-unavailable",
          "worker exited before result",
        ),
      ),
    );
  });

export const runIsolatedOpaqueWorker = async (
  input: IsolatedOpaqueWorkerInput,
  options: IsolatedOpaqueWorkerOptions = {},
): Promise<unknown> => {
  if (options.signal?.aborted)
    throw new OpaqueIsolationError("opaque-capture-cancelled", "capture cancelled");
  if (
    options.deadlineMs !== undefined &&
    (!Number.isSafeInteger(options.deadlineMs) ||
      options.deadlineMs < 1 ||
      options.deadlineMs > DEADLINE_MS)
  )
    throw unavailable("capture deadline must not exceed the isolation profile");
  assertOpaqueIsolationAvailable(options);
  const root = delegatedRoot(options.cgroupRoot);
  const bwrap = process.env.UNFRAME_BWRAP_PATH!;
  const bash = process.env.UNFRAME_BASH_PATH!;
  if (!input.workerPath.endsWith("/worker.mjs"))
    throw unavailable("worker bundle entry must be worker.mjs");
  const workerDirectory = realpathSync(dirname(input.workerPath));
  const browserDirectory = realpathSync(dirname(input.browserPath));
  const groupName = `unframe-opaque-${randomUUID()}`;
  const group = join(root, groupName);
  const groupRelative = `/${relative("/sys/fs/cgroup", group)}`;
  let child: ChildProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  let value: unknown;
  let failure: OpaqueIsolationError | undefined;
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
      browserDirectory,
      basename(input.browserPath),
      input.runtimePaths,
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
    if (!child.pid) throw unavailable("trusted bootstrap did not start");
    writeFileSync(join(group, "cgroup.procs"), String(child.pid));
    verifyMembership(child.pid, groupRelative);
    const barrier = child.stdio[3];
    if (!barrier || !("write" in barrier))
      throw unavailable("trusted bootstrap barrier is unavailable");
    barrier.write("go\n");
    barrier.end();
    const worker = child;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new OpaqueIsolationError("opaque-capture-timeout", "capture deadline exceeded")),
        options.deadlineMs ?? DEADLINE_MS,
      );
    });
    value = await Promise.race([
      protocol(worker, groupRelative, input.input, options.signal),
      deadline,
    ]);
    worker.stdin?.end();
    completed = true;
  } catch (error) {
    failure =
      error instanceof OpaqueIsolationError
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
    throw new OpaqueIsolationError(
      "opaque-capture-resource-limit",
      "worker exceeded a hard resource limit",
    );
  if (failure) throw failure;
  return value;
};
