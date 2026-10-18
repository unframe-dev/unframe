import type { ChildProcess } from "node:child_process";
import { OpaqueIsolationError, unavailable } from "./common.js";
const MAX_PROTOCOL_BYTES = 128 * 1024 * 1024;
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
          const parsed: unknown = JSON.parse(line);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("worker message must be an object");
          message = parsed as Record<string, unknown>;
        } catch {
          fail(new OpaqueIsolationError("opaque-capture-failed", "invalid worker protocol"));
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
            send({ type: "capture", input });
          } else if (phase === "result" && message.type === "result") {
            verify("result");
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
    if (signal?.aborted) onAbort();
    child.once("error", (error) => fail(error));
    child.once("exit", (code, signal) =>
      fail(
        new OpaqueIsolationError(
          phase === "result" ? "opaque-capture-failed" : "opaque-isolation-unavailable",
          `worker exited before result: code=${code} signal=${signal}`,
        ),
      ),
    );
  });
