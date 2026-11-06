import { execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { AuthorError } from "@unframe-dev/author-service";

const run = promisify(execFile);
export const ANALYSIS_RSS_BYTES = 3 * 1024 ** 3;
const exceeded = () =>
  new AuthorError(
    422,
    "cli-analysis-resource-limit",
    "Project analysis exceeded its memory budget.",
  );
const unavailable = () =>
  new AuthorError(
    503,
    "cli-analysis-resource-monitor",
    "Project analysis memory monitoring failed.",
  );

const prepareCgroup = async (pid: number, limit: number): Promise<string | undefined> => {
  const configured = process.env.UNFRAME_OPAQUE_CGROUP_ROOT;
  if (process.platform !== "linux" || !configured) return;
  const root = await realpath(configured);
  const membership = (await readFile("/proc/self/cgroup", "utf8"))
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3);
  if (!membership) throw unavailable();
  const self = resolve("/sys/fs/cgroup", `.${membership}`);
  const rel = relative(root, self);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw unavailable();
  const controllers = (await readFile(join(root, "cgroup.subtree_control"), "utf8")).split(/\s+/);
  if (!controllers.includes("memory")) throw unavailable();
  const group = join(root, `unframe-analysis-${randomUUID()}`);
  await mkdir(group);
  try {
    await writeFile(join(group, "memory.max"), String(limit));
    await writeFile(join(group, "memory.swap.max"), "0");
    if ((await readFile(join(group, "memory.max"), "utf8")).trim() !== String(limit))
      throw unavailable();
    await writeFile(join(group, "cgroup.procs"), String(pid));
    const actual = (await readFile(`/proc/${pid}/cgroup`, "utf8")).trim();
    if (actual !== `0::/${relative("/sys/fs/cgroup", group)}`) throw unavailable();
    return group;
  } catch (error) {
    // The caller owns child termination; retain the group until that process exits.
    await writeFile(join(group, "cgroup.kill"), "1").catch(() => undefined);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await rmdir(group);
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 10));
      }
    }
    throw error;
  }
};

export const protectAnalysisProcess = async (
  child: ChildProcess,
  options: { onExceeded(error: AuthorError): void; maxRssBytes?: number },
): Promise<{ close(): Promise<void> }> => {
  const pid = child.pid;
  const limit = options.maxRssBytes ?? ANALYSIS_RSS_BYTES;
  if (!pid || !Number.isSafeInteger(limit) || limit < 1) throw unavailable();
  const group = await prepareCgroup(pid, limit);
  let closed = false;
  let reported = false;
  let checking: Promise<void> | undefined;
  const report = (error: AuthorError) => {
    if (closed || reported) return;
    reported = true;
    options.onExceeded(error);
  };
  const check = async () => {
    try {
      if (group) {
        const events = await readFile(join(group, "memory.events"), "utf8");
        if (/^oom_kill [1-9]\d*$/m.test(events)) report(exceeded());
      }
      if (closed || child.exitCode !== null || child.signalCode !== null) return;
      const bytes =
        process.platform === "linux"
          ? Number(
              /^VmRSS:\s+(\d+)\s+kB$/m.exec(await readFile(`/proc/${pid}/status`, "utf8"))?.[1],
            ) * 1024
          : Number(
              (
                await run("/bin/ps", ["-o", "rss=", "-p", String(pid)], { timeout: 1000 })
              ).stdout.trim(),
            ) * 1024;
      if (!Number.isFinite(bytes) || bytes <= 0) throw unavailable();
      if (bytes > limit) report(exceeded());
    } catch {
      if (child.exitCode === null && child.signalCode === null) report(unavailable());
    }
  };
  const poll = () => {
    if (closed || checking) return;
    checking = check().finally(() => {
      checking = undefined;
    });
  };
  const timer = setInterval(poll, 100);
  timer.unref();
  child.on("exit", poll);
  poll();
  let closing: Promise<void> | undefined;
  return {
    close: () =>
      (closing ??= (async () => {
        closed = true;
        clearInterval(timer);
        child.off("exit", poll);
        await checking;
        if (group) {
          const events = await readFile(join(group, "memory.events"), "utf8");
          await rmdir(group);
          if (/^oom_kill [1-9]\d*$/m.test(events)) throw exceeded();
        }
      })()),
  };
};
