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

export const verifyMembership = (pid: number, group: string): void => {
  const seen = new Set<number>();
  const pending = [pid];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    try {
      if (cgroupFor(current) !== group)
        throw unavailable("a browser descendant escaped the resource cgroup");
      const children = readFileSync(`/proc/${current}/task/${current}/children`, "utf8")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (
        children.some(
          (child) => !/^[1-9][0-9]*$/.test(child) || !Number.isSafeInteger(Number(child)),
        )
      )
        throw unavailable("worker descendants are unavailable");
      pending.push(...children.map(Number));
    } catch (error) {
      // Proc entries can disappear after enumeration. A missing task alone does not prove exit.
      if (current !== pid && hasCode(error, "ENOENT") && exited(current)) continue;
      throw error;
    }
  }
};
