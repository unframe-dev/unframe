import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const editorOrigin = "http://127.0.0.1:5174";

const requireEditorPort = () =>
  new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error("Local Editor port 5174 is unavailable. Stop the existing server and retry."),
      ),
    );
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(5174, "127.0.0.1");
  });

const waitForEditor = async (signal: AbortSignal) => {
  const readySignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  while (!readySignal.aborted) {
    try {
      const response = await fetch(editorOrigin, {
        signal: AbortSignal.any([readySignal, AbortSignal.timeout(1_000)]),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      if (readySignal.aborted) break;
    }
    await delay(100, undefined, { signal: readySignal }).catch(() => {});
  }
  if (signal.aborted) signal.throwIfAborted();
  throw new Error("Local Editor development server did not become ready within 20 seconds.");
};

export async function runWithEditorDevServer(
  repository: string,
  signal: AbortSignal,
  runHost: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  if (signal.aborted) return;
  await requireEditorPort();
  if (signal.aborted) return;
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  signal.addEventListener("abort", abort, { once: true });
  const child = spawn(
    "pnpm",
    ["--config.verify-deps-before-run=false", "--filter", "@unframe-dev/local-editor", "dev"],
    { cwd: repository, detached: true, stdio: ["ignore", "inherit", "inherit"] },
  );
  const exited = new Promise<Error>((resolve) => {
    child.once("error", resolve);
    child.once("exit", (code, childSignal) =>
      resolve(
        new Error(`Local Editor development server stopped (${childSignal ?? code ?? "unknown"}).`),
      ),
    );
  });
  const unexpectedExit = exited.then((error) => {
    throw error;
  });
  const stopGroup = (stopSignal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, stopSignal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  let hostTask: Promise<void> | undefined;
  try {
    await Promise.race([waitForEditor(lifetime.signal), unexpectedExit]);
    lifetime.signal.throwIfAborted();
    hostTask = Promise.resolve().then(() => runHost(lifetime.signal));
    await Promise.race([hostTask, unexpectedExit]);
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    lifetime.abort();
    stopGroup("SIGTERM");
    const groupExists = () => {
      if (!child.pid) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
      }
    };
    try {
      const deadline = Date.now() + 3_000;
      while (groupExists() && Date.now() < deadline) await delay(50);
      if (groupExists()) stopGroup("SIGKILL");
    } finally {
      signal.removeEventListener("abort", abort);
      await hostTask?.catch(() => {});
    }
  }
}
