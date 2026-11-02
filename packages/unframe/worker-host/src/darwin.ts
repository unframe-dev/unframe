import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLOSE_GRACE_MS,
  DEADLINE_MS,
  WorkerIsolationError,
  unavailable,
  type IsolatedWorkerInput,
  type IsolatedWorkerOptions,
} from "./common.js";
import { workerProtocol } from "./protocol.js";
import { prepareDarwinBrowser, type DarwinBrowserBootstrap } from "./darwin-browser.js";

const SANDBOX = "/usr/bin/sandbox-exec";
const MEMORY_MAX = 1024 * 1024 * 1024;
const PIDS_MAX = 128;
const SAMPLE_MS = 50;

export const darwinResourceContract = {
  mechanism: "seatbelt-descendant-process-group-monitor",
  memoryBytes: MEMORY_MAX,
  processes: PIDS_MAX,
  samplingIntervalMs: SAMPLE_MS,
  hardSubtreeLimits: false,
  limitations: [
    "RSS sampling can miss transient allocations and forks; scheduling and ps latency delay enforcement",
    "descendants that leave known groups and become reparented between samples can escape accounting and group cleanup",
    "PID/PGID reuse and process-group changes between inspection and signaling are not atomically fenced",
    "sandbox-exec is deprecated; policy and Chromium compatibility require native validation",
  ],
} as const;

export const darwinSandboxProfile = (
  readPaths: readonly string[],
  scratch: string,
  browserHelper?: string,
): string => {
  const literal = (path: string) => JSON.stringify(path);
  const ancestors = new Set<string>();
  for (const path of [...readPaths, scratch]) {
    for (let parent = dirname(path); parent !== "/" && parent !== "."; parent = dirname(parent)) {
      ancestors.add(parent);
    }
  }
  return [
    "(version 1)",
    "(deny default)",
    // Node initialization reads the filesystem root; descendants remain denied.
    '(allow file-read* (literal "/"))',
    // Node resolves each ancestor with lstat before loading the worker entry point.
    ...[...ancestors].map((path) => `(allow file-read-metadata (literal ${literal(path)}))`),
    "(allow process-fork)",
    ...(browserHelper
      ? [`(allow process-exec (literal ${literal(browserHelper)}) (with no-sandbox))`]
      : []),
    ...readPaths
      .filter((path) => !browserHelper?.startsWith(`${path}/`))
      .map((path) => `(allow process-exec (subpath ${literal(path)}))`),
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

export type DarwinProcessTracking = {
  rootActive: boolean;
  retiredGroups: Set<number>;
  supervisorPid: number;
};

export const parseProcessGroup = (
  output: string,
  rootPid: number,
  groups = new Set([rootPid]),
  state: DarwinProcessTracking = {
    rootActive: groups.has(rootPid),
    retiredGroups: new Set(),
    supervisorPid: process.pid,
  },
): { pids: number[]; rssBytes: number } => {
  const rows: { pid: number; ppid: number; pgid: number; rss: number }[] = [];
  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    const values = line.trim().split(/\s+/).map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isSafeInteger(value) || value < 0))
      throw unavailable("process group accounting is unavailable");
    const [pid, ppid, pgid, rss] = values as [number, number, number, number];
    if (!pid || !pgid) throw unavailable("process group accounting is unavailable");
    rows.push({ pid, ppid, pgid, rss });
  }
  const supervisorGroup = rows.find((row) => row.pid === state.supervisorPid)?.pgid;
  const root = rows.find((row) => row.pid === rootPid);
  const rootChangedGroup = state.rootActive && root && root.pgid !== rootPid;
  let unsafeKnownGroup = false;
  // Invalid samples may shrink signal authority, but cannot grant authority over a new group.
  for (const group of groups) {
    const unsafe = group <= 1 || group === supervisorGroup || state.retiredGroups.has(group);
    const present = rows.some(
      (row) => row.pgid === group && (row.pid !== rootPid || state.rootActive),
    );
    if (unsafe || !present) {
      groups.delete(group);
      state.retiredGroups.add(group);
    }
    if (unsafe) unsafeKnownGroup = true;
  }
  if (!root || rootChangedGroup || !groups.has(rootPid)) state.rootActive = false;
  if (rootChangedGroup || unsafeKnownGroup) throw unavailable("unsafe process group");
  const selected = new Set(
    rows
      .filter((row) => groups.has(row.pgid) && (row.pid !== rootPid || state.rootActive))
      .map((row) => row.pid),
  );
  const nextGroups = new Set<number>();
  let expanded = true;
  while (expanded) {
    // Resolve ancestry before validating group leaders so ps row order has no authority.
    let descendantsExpanded = true;
    while (descendantsExpanded) {
      descendantsExpanded = false;
      for (const row of rows) {
        if (selected.has(row.pid) || (row.pid === rootPid && !state.rootActive)) continue;
        if (selected.has(row.ppid)) {
          selected.add(row.pid);
          descendantsExpanded = true;
        }
      }
    }
    for (const row of rows.filter((item) => selected.has(item.pid))) {
      if (
        row.pgid <= 1 ||
        row.pgid === supervisorGroup ||
        state.retiredGroups.has(row.pgid) ||
        (!groups.has(row.pgid) &&
          !rows.some(
            (leader) =>
              selected.has(leader.pid) && leader.pid === row.pgid && leader.pgid === row.pgid,
          ))
      )
        throw unavailable("unsafe process group");
      nextGroups.add(row.pgid);
    }
    expanded = false;
    for (const row of rows) {
      if (
        !selected.has(row.pid) &&
        nextGroups.has(row.pgid) &&
        (row.pid !== rootPid || state.rootActive)
      ) {
        selected.add(row.pid);
        expanded = true;
      }
    }
  }
  const tracked = rows.filter((row) => selected.has(row.pid));
  // Grant new group authority only after every candidate is validated.
  for (const group of groups) {
    if (!nextGroups.has(group)) state.retiredGroups.add(group);
  }
  groups.clear();
  for (const group of nextGroups) groups.add(group);
  if (!root || !selected.has(rootPid)) state.rootActive = false;
  return {
    pids: tracked.map((row) => row.pid),
    rssBytes: tracked.reduce((total, row) => total + row.rss * 1024, 0),
  };
};

export const verifyDarwinGroupSample = (
  usage: ReturnType<typeof parseProcessGroup>,
  rootPid: number,
  phase: "ready" | "result" | "monitor",
): void => {
  if (phase === "ready" && !usage.pids.includes(rootPid))
    throw unavailable("sandbox worker left its process group");
  if (usage.rssBytes > MEMORY_MAX || usage.pids.length > PIDS_MAX)
    throw new WorkerIsolationError(
      "opaque-capture-resource-limit",
      "worker exceeded monitored resources",
    );
};

const groupUsage = (pid: number, groups: Set<number>, state: DarwinProcessTracking) => {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,rss="], {
    encoding: "utf8",
    timeout: 1000,
    env: {},
  });
  if (result.error || result.status !== 0) throw unavailable("process group accounting failed");
  return parseProcessGroup(result.stdout, pid, groups, state);
};

const pinnedRoot = (path: string): string => {
  const real = realpathSync(path);
  const root = /^\/nix\/store\/[^/]+/.exec(real)?.[0];
  if (!root) throw unavailable("runtime paths must be pinned Nix store roots");
  return root;
};

export const assertDarwinIsolationAvailable = (options: IsolatedWorkerOptions = {}): void => {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw unavailable("macOS isolation requires Apple Silicon");
  if (!existsSync(SANDBOX) || !existsSync("/bin/ps"))
    throw unavailable("native sandbox tools are unavailable");
  const node = options.nodePath ?? process.execPath;
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

export const runDarwinWorker = async (
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
  assertDarwinIsolationAvailable(options);
  const node = realpathSync(options.nodePath ?? process.execPath!);
  const worker = realpathSync(input.workerPath);
  const browser = input.environment?.UNFRAME_BROWSER_EXECUTABLE
    ? realpathSync(input.environment.UNFRAME_BROWSER_EXECUTABLE)
    : undefined;
  if (!worker.endsWith("/worker.mjs")) throw unavailable("worker bundle entry must be worker.mjs");
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "unframe-opaque-private-")));
  const probeRoot = realpathSync(mkdtempSync(join(tmpdir(), "unframe-opaque-deny-")));
  const deniedFile = join(probeRoot, "secret");
  let child: ChildProcess | undefined;
  let didClose = false;
  const groups = new Set<number>();
  const tracking: DarwinProcessTracking = {
    rootActive: true,
    retiredGroups: new Set(),
    supervisorPid: process.pid,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let result: unknown;
  let failure: unknown;
  let cleanupFailed = false;
  let browserBootstrap: DarwinBrowserBootstrap | undefined;
  try {
    writeFileSync(deniedFile, "must-not-read");
    const roots = [
      ...new Set([
        pinnedRoot(node),
        ...input.runtimePaths.map(pinnedRoot),
        dirname(worker),
        ...(input.mounts ?? []).map(({ source }) => realpathSync(source)),
        ...(browser ? [dirname(browser)] : []),
      ]),
    ];
    if (browser) browserBootstrap = prepareDarwinBrowser(roots, scratch, browser);
    const profile = darwinSandboxProfile(roots, scratch, browserBootstrap?.helper);
    probePolicy(profile, node, deniedFile, scratch);
    const env: Record<string, string> = {
      HOME: scratch,
      TMPDIR: scratch,
      ...input.environment,
      ...(browser ? { UNFRAME_BROWSER_EXECUTABLE: browserBootstrap?.helper ?? browser } : {}),
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
    running.once("close", () => {
      didClose = true;
      tracking.rootActive = false;
    });
    if (running.pid) groups.add(running.pid);
    const check = (phase: "ready" | "result" | "monitor" = "monitor") => {
      if (!running.pid) throw unavailable("sandbox worker did not start");
      verifyDarwinGroupSample(groupUsage(running.pid, groups, tracking), running.pid, phase);
    };
    const supervision = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new WorkerIsolationError("opaque-capture-timeout", "capture deadline exceeded")),
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
          reject(new WorkerIsolationError("opaque-capture-failed", "worker stdio failed")),
        );
    });
    result = await Promise.race([
      workerProtocol(running, check, input.input, options.signal, () => {
        if (!running.pid) throw unavailable("sandbox worker did not start");
        browserBootstrap?.registerWorker(running.pid);
      }),
      supervision,
    ]);
  } catch (error) {
    failure = error;
  } finally {
    if (timer) clearTimeout(timer);
    if (monitor) clearInterval(monitor);
    if (child?.pid) {
      const rootPid = child.pid;
      const killGroups = () => {
        for (const group of groups) {
          try {
            process.kill(-group, "SIGKILL");
          } catch (error) {
            // Darwin can return EPERM for an exiting group; the following ps/close check is authoritative.
            if (!["ESRCH", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
              cleanupFailed = true;
          }
        }
      };
      // Sample before ending stdin or killing the root so detached children still have ancestry.
      try {
        groupUsage(rootPid, groups, tracking);
      } catch {
        cleanupFailed = true;
      }
      killGroups();
      const deadline = Date.now() + CLOSE_GRACE_MS;
      while (true) {
        let empty = false;
        try {
          empty = groupUsage(rootPid, groups, tracking).pids.length === 0;
        } catch {
          cleanupFailed = true;
        }
        killGroups();
        if (empty && didClose) break;
        if (Date.now() >= deadline) {
          cleanupFailed = true;
          break;
        }
        // Yield so Node can reap the root and deliver close before the next ps sample.
        await new Promise((done) => setTimeout(done, 20));
      }
    }
    try {
      browserBootstrap?.cleanup();
    } catch {
      cleanupFailed = true;
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
    throw failure instanceof WorkerIsolationError
      ? failure
      : unavailable(failure instanceof Error ? failure.message : "native isolation failed");
  return result;
};
