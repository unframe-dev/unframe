import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLOSE_GRACE_MS,
  DEADLINE_MS,
  OpaqueIsolationError,
  unavailable,
  type IsolatedOpaqueWorkerInput,
  type IsolatedOpaqueWorkerOptions,
} from "./common.js";
import { workerProtocol } from "./protocol.js";

const SANDBOX = "/usr/bin/sandbox-exec";
const MEMORY_MAX = 1024 * 1024 * 1024;
const PIDS_MAX = 128;
const SAMPLE_MS = 50;

export const darwinResourceContract = {
  mechanism: "seatbelt-process-group-monitor",
  memoryBytes: MEMORY_MAX,
  processes: PIDS_MAX,
  samplingIntervalMs: SAMPLE_MS,
  hardSubtreeLimits: false,
  limitations: [
    "RSS sampling can miss transient allocations and forks; scheduling and ps latency delay enforcement",
    "processes that leave the process group cannot be accounted for or recovered by group kill",
    "sandbox-exec is deprecated; policy and Chromium compatibility require native validation",
  ],
} as const;

export const darwinSandboxProfile = (readPaths: readonly string[], scratch: string): string => {
  const literal = (path: string) => JSON.stringify(path);
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    ...readPaths.map((path) => `(allow process-exec (subpath ${literal(path)}))`),
    ...readPaths.map((path) => `(allow file-read* (subpath ${literal(path)}))`),
    '(allow file-read* (subpath "/System/Library") (subpath "/usr/lib") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))',
    '(allow file-write* (literal "/dev/null"))',
    `(allow file-read* (subpath ${literal(scratch)}))`,
    `(allow file-write* (subpath ${literal(scratch)}))`,
    "(allow sysctl-read)",
    // Node and Chromium use these host services; other Mach lookups remain denied.
    '(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.system.notification_center"))',
  ].join("\n");
};

export const parseProcessGroup = (
  output: string,
  group: number,
): { pids: number[]; rssBytes: number } => {
  const pids: number[] = [];
  let rssBytes = 0;
  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    const values = line.trim().split(/\s+/).map(Number);
    if (values.length !== 3 || values.some((value) => !Number.isSafeInteger(value) || value < 0))
      throw unavailable("process group accounting is unavailable");
    const [pid, pgid, rss] = values as [number, number, number];
    if (pgid === group) {
      pids.push(pid);
      rssBytes += rss * 1024;
    }
  }
  return { pids, rssBytes };
};

export const verifyDarwinGroupSample = (
  usage: ReturnType<typeof parseProcessGroup>,
  rootPid: number,
  phase: "ready" | "result" | "monitor",
): void => {
  if (phase === "ready" && !usage.pids.includes(rootPid))
    throw unavailable("sandbox worker left its process group");
  if (usage.rssBytes > MEMORY_MAX || usage.pids.length > PIDS_MAX)
    throw new OpaqueIsolationError(
      "opaque-capture-resource-limit",
      "worker exceeded monitored resources",
    );
};

const groupUsage = (pid: number) => {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,pgid=,rss="], {
    encoding: "utf8",
    timeout: 1000,
    env: {},
  });
  if (result.error || result.status !== 0) throw unavailable("process group accounting failed");
  return parseProcessGroup(result.stdout, pid);
};

const pinnedRoot = (path: string): string => {
  const real = realpathSync(path);
  const root = /^\/nix\/store\/[^/]+/.exec(real)?.[0];
  if (!root) throw unavailable("runtime paths must be pinned Nix store roots");
  return root;
};

export const assertDarwinIsolationAvailable = (options: IsolatedOpaqueWorkerOptions = {}): void => {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw unavailable("macOS isolation requires Apple Silicon");
  if (!existsSync(SANDBOX) || !existsSync("/bin/ps"))
    throw unavailable("native sandbox tools are unavailable");
  const node = options.nodePath ?? process.env.UNFRAME_OPAQUE_NODE;
  if (!node) throw unavailable("pinned Node executable is unavailable");
  pinnedRoot(node);
};

// Exercise the exact capture policy before starting any worker or releasing input.
const probePolicy = (profile: string, node: string, deniedFile: string, scratch: string): void => {
  const script = `
    const fs=require('node:fs'); const net=require('node:net');
    let failures=0;
    try { fs.readFileSync(${JSON.stringify(deniedFile)}); failures++; } catch(e) { if(!['EPERM','EACCES'].includes(e.code)) failures++; }
    try { fs.writeFileSync(${JSON.stringify(deniedFile)},'escape'); failures++; } catch(e) { if(!['EPERM','EACCES'].includes(e.code)) failures++; }
    try { fs.writeFileSync(${JSON.stringify(join(scratch, "probe"))},'allowed'); } catch { failures++; }
    const socket=net.connect({host:'127.0.0.1',port:9});
    const timer=setTimeout(()=>process.exit(1),1000);
    socket.on('connect',()=>process.exit(1));
    socket.on('error',e=>{clearTimeout(timer);process.exit(failures===0&&['EPERM','EACCES'].includes(e.code)?0:1)});
  `;
  const probe = spawnSync(SANDBOX, ["-p", profile, node, "-e", script], {
    env: {},
    encoding: "utf8",
    timeout: 3000,
  });
  if (probe.error || probe.status !== 0)
    throw unavailable("Seatbelt filesystem/network deny probe failed");
};

export const runDarwinOpaqueWorker = async (
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
  assertDarwinIsolationAvailable(options);
  const node = realpathSync(options.nodePath ?? process.env.UNFRAME_OPAQUE_NODE!);
  const worker = realpathSync(input.workerPath);
  const browser = realpathSync(input.browserPath);
  if (!worker.endsWith("/worker.mjs")) throw unavailable("worker bundle entry must be worker.mjs");
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "unframe-opaque-private-")));
  const probeRoot = realpathSync(mkdtempSync(join(tmpdir(), "unframe-opaque-deny-")));
  const deniedFile = join(probeRoot, "secret");
  let child: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let result: unknown;
  let failure: unknown;
  let cleanupFailed = false;
  try {
    writeFileSync(deniedFile, "must-not-read");
    const roots = [
      ...new Set([
        pinnedRoot(node),
        ...input.runtimePaths.map(pinnedRoot),
        dirname(worker),
        dirname(browser),
      ]),
    ];
    const profile = darwinSandboxProfile(roots, scratch);
    probePolicy(profile, node, deniedFile, scratch);
    const env: Record<string, string> = {
      HOME: scratch,
      TMPDIR: scratch,
      UNFRAME_BROWSER_EXECUTABLE: browser,
    };
    const fontconfig = options.runtimeEnvironment?.FONTCONFIG_FILE;
    if (fontconfig) env.FONTCONFIG_FILE = fontconfig;
    child = spawn(SANDBOX, ["-p", profile, node, worker], {
      env,
      cwd: scratch,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const running = child;
    closed = new Promise((done) => running.once("close", done));
    const check = (phase: "ready" | "result" | "monitor" = "monitor") => {
      if (!running.pid) throw unavailable("sandbox worker did not start");
      verifyDarwinGroupSample(groupUsage(running.pid), running.pid, phase);
    };
    const supervision = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new OpaqueIsolationError("opaque-capture-timeout", "capture deadline exceeded")),
        options.deadlineMs ?? DEADLINE_MS,
      );
      monitor = setInterval(() => {
        try {
          check();
        } catch (error) {
          reject(error);
        }
      }, SAMPLE_MS);
      for (const stream of [running.stdin, running.stdout, running.stderr])
        stream?.on("error", () =>
          reject(new OpaqueIsolationError("opaque-capture-failed", "worker stdio failed")),
        );
    });
    result = await Promise.race([
      workerProtocol(running, check, input.input, options.signal),
      supervision,
    ]);
    running.stdin?.end();
  } catch (error) {
    failure = error;
  } finally {
    if (timer) clearTimeout(timer);
    if (monitor) clearInterval(monitor);
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") cleanupFailed = true;
      }
      const deadline = Date.now() + CLOSE_GRACE_MS;
      try {
        while (groupUsage(child.pid).pids.length && Date.now() < deadline)
          await new Promise((done) => setTimeout(done, 20));
        if (groupUsage(child.pid).pids.length) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
      if (closed) {
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        const didClose = await Promise.race([
          closed.then(() => true),
          new Promise<false>((done) => {
            closeTimer = setTimeout(() => done(false), CLOSE_GRACE_MS);
          }),
        ]);
        if (closeTimer) clearTimeout(closeTimer);
        if (!didClose) cleanupFailed = true;
      }
    }
    for (const path of [scratch, probeRoot]) {
      try {
        rmSync(path, { recursive: true });
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) throw unavailable("native isolate cleanup failed");
  if (failure)
    throw failure instanceof OpaqueIsolationError
      ? failure
      : unavailable(failure instanceof Error ? failure.message : "native isolation failed");
  return result;
};
