import { readFileSync } from "node:fs";
import { unavailable } from "./common.js";
export const cgroupFor = (pid: number): string => {
  const entry = readFileSync(`/proc/${pid}/cgroup`, "utf8")
    .split("\n")
    .find((line) => line.startsWith("0::"));
  if (!entry) throw unavailable("cgroup v2 membership is unavailable");
  return entry.slice(3);
};

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

const exited = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return hasCode(error, "ESRCH");
  }
};

const processIds = (contents: string): number[] => {
  const entries = contents.trim().split(/\s+/).filter(Boolean);
  if (entries.some((entry) => !/^[1-9][0-9]*$/.test(entry) || !Number.isSafeInteger(Number(entry))))
    throw unavailable("worker process identifiers are unavailable");
  return entries.map(Number);
};

export const verifyMembership = (pid: number, group: string, phase: "ready" | "result"): void => {
  const seen = new Set<number>();
  const pending = [pid];
  // Orphaned descendants remain in the cgroup after the root's proc entries disappear.
  if (phase === "result")
    pending.push(...processIds(readFileSync(`/sys/fs/cgroup${group}/cgroup.procs`, "utf8")));
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    try {
      if (cgroupFor(current) !== group)
        throw unavailable("a browser descendant escaped the resource cgroup");
      pending.push(
        ...processIds(readFileSync(`/proc/${current}/task/${current}/children`, "utf8")),
      );
    } catch (error) {
      // Proc entries can disappear after enumeration. A missing task alone does not prove exit.
      if ((current !== pid || phase === "result") && hasCode(error, "ENOENT") && exited(current))
        continue;
      throw error;
    }
  }
};
