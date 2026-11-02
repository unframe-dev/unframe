import type { ChildProcess } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

export async function stopServices(
  children: readonly Pick<ChildProcess, "pid">[],
  graceMs = 1500,
): Promise<void> {
  const groups = [...children].reverse().flatMap((child) => (child.pid ? [child.pid] : []));
  const errors = new Set<unknown>();
  const attempt = (pid: number, signal: NodeJS.Signals | 0): boolean => {
    try {
      return signalGroup(pid, signal);
    } catch (error) {
      errors.add(error);
      return true;
    }
  };
  for (const pid of groups) attempt(pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && groups.some((pid) => attempt(pid, 0))) {
    await pause(Math.max(0, Math.min(25, deadline - Date.now())));
  }
  for (const pid of groups) {
    if (attempt(pid, 0)) attempt(pid, "SIGKILL");
  }
  if (errors.size > 0) {
    throw new AggregateError([...errors], "Failed to stop all sample process groups.");
  }
}
