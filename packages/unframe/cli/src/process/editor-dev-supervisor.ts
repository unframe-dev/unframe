import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function superviseEditorHost(
  command: string,
  args: string[],
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  // The supervisor stays outside the group so cleanup survives an API host SIGKILL.
  const child = spawn(command, args, { detached: true, stdio: "inherit" });
  const stopGroup = (stopSignal: NodeJS.Signals | 0) => {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, stopSignal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const stop = () => {
    stopGroup("SIGTERM");
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  let cancellationDeadline: ReturnType<typeof setTimeout> | undefined;
  const forceStop = () => {
    cancellationDeadline = setTimeout(() => stopGroup("SIGKILL"), 3_000);
  };
  signal.addEventListener("abort", forceStop, { once: true });
  if (signal.aborted) forceStop();
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, childSignal) => resolve({ code, signal: childSignal }));
      },
    );
    if (!signal.aborted && (result.code !== 0 || result.signal)) {
      throw new Error(
        `Local Editor API host stopped (${result.signal ?? result.code ?? "unknown"}). Restart the Local Editor development command.`,
      );
    }
  } finally {
    signal.removeEventListener("abort", stop);
    signal.removeEventListener("abort", forceStop);
    clearTimeout(cancellationDeadline);
    stopGroup("SIGTERM");
    const deadline = Date.now() + 3_000;
    while (stopGroup(0) && Date.now() < deadline) await delay(50);
    if (stopGroup(0)) stopGroup("SIGKILL");
  }
}
