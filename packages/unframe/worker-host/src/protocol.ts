import type { ChildProcess } from "node:child_process";
import { WorkerIsolationError, unavailable } from "./common.js";
const MAX_PROTOCOL_BYTES = 128 * 1024 * 1024;
const MAX_STARTUP_DIAGNOSTIC_BYTES = 8192;
export const workerProtocol = (
  child: ChildProcess,
  verify: (phase: "ready" | "result") => void,
  input: unknown,
  signal?: AbortSignal,
  beforeLaunch?: () => void,
): Promise<unknown> =>
  new Promise((resolveResult, rejectResult) => {
    let pendingChunks: Buffer[] = [];
    let pendingBytes = 0;
    let phase: "bootstrap" | "ready" | "result" = "bootstrap";
    let settled = false;
    let startupDiagnostic = Buffer.alloc(0);
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
      fail(new WorkerIsolationError("opaque-capture-cancelled", "capture cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (settled || phase === "result") return;
      startupDiagnostic = Buffer.concat([
        startupDiagnostic,
        chunk.subarray(-MAX_STARTUP_DIAGNOSTIC_BYTES),
      ]).subarray(-MAX_STARTUP_DIAGNOSTIC_BYTES);
    });
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
          fail(new WorkerIsolationError("opaque-capture-failed", "worker output exceeds limit"));
          return;
        }
        if (newline < 0) break;
        const line = Buffer.concat(pendingChunks, pendingBytes).toString("utf8");
        pendingChunks = [];
        pendingBytes = 0;
        let message: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("worker message must be an object");
          message = parsed as Record<string, unknown>;
        } catch {
          fail(new WorkerIsolationError("opaque-capture-failed", "invalid worker protocol"));
          break;
        }
        try {
          if (phase === "bootstrap" && message.type === "bootstrap") {
            beforeLaunch?.();
            phase = "ready";
            send({ type: "launch" });
          } else if (phase === "ready" && message.type === "ready") {
            verify("ready");
            phase = "result";
            // Discard startup output before releasing potentially sensitive capture input.
            startupDiagnostic = Buffer.alloc(0);
            send({ type: "capture", input });
          } else if (phase === "result" && message.type === "result") {
            verify("result");
            finish(message.value);
          } else if (message.type === "error") {
            fail(
              new WorkerIsolationError(
                phase === "result" ? "opaque-capture-failed" : "opaque-isolation-unavailable",
                String(message.code ?? "worker error"),
              ),
            );
          } else {
            fail(
              new WorkerIsolationError("opaque-capture-failed", "unexpected worker protocol phase"),
            );
          }
        } catch (error) {
          fail(error instanceof Error ? error : unavailable("worker verification failed"));
        }
        offset = newline + 1;
      }
    });
    if (signal?.aborted) onAbort();
    child.once("error", (error) => fail(error));
    // Process exit can precede delivery of the final stdout messages.
    child.once("close", (code, signal) =>
      fail(
        new WorkerIsolationError(
          phase === "result" ? "opaque-capture-failed" : "opaque-isolation-unavailable",
          `worker exited before result: code=${code} signal=${signal}${
            startupDiagnostic.length ? ` stderr=${startupDiagnostic.toString("utf8")}` : ""
          }`,
        ),
      ),
    );
  });
