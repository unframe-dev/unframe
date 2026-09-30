import { describe, expect, it } from "vitest";

import { runPresentationProcess } from "../src/index.js";

const fakeProcess = (
  argv: ReadonlyArray<string> = ["bun", "presentation", "check", "/project"],
) => {
  const listeners = new Map<string, Array<() => void>>();
  const stdout: Array<string> = [];
  const stderr: Array<string> = [];
  const process = {
    argv,
    emit: (signal: string) => listeners.get(signal)?.forEach((listener) => listener()),
    exitCode: undefined as number | undefined,
    listenerCount: (signal: string) => listeners.get(signal)?.length ?? 0,
    off: (signal: string, listener: () => void) => {
      listeners.set(
        signal,
        (listeners.get(signal) ?? []).filter((item) => item !== listener),
      );
    },
    on: (signal: string, listener: () => void) => {
      listeners.set(signal, [...(listeners.get(signal) ?? []), listener]);
    },
    stderr: { write: (text: string) => stderr.push(text) },
    stdout: { write: (text: string) => stdout.push(text) },
  };
  return { process, stderr, stdout };
};

describe("presentation process entry", () => {
  it("owns listeners once, forwards its signal, writes output, and cleans up", async () => {
    const host = fakeProcess();
    let signal: AbortSignal | undefined;
    const result = await runPresentationProcess({
      process: host.process,
      run: async (input) => {
        signal = input.host.signal;
        expect(host.process.listenerCount("SIGINT")).toBe(1);
        expect(host.process.listenerCount("SIGTERM")).toBe(1);
        return { exitCode: 0, stderr: "", stdout: "check: ok\n" };
      },
    });
    expect(result.exitCode).toBe(0);
    expect(signal?.aborted).toBe(false);
    expect(host.stdout).toEqual(["check: ok\n"]);
    expect(host.stderr).toEqual([]);
    expect(host.process.exitCode).toBe(0);
    expect(host.process.listenerCount("SIGINT")).toBe(0);
    expect(host.process.listenerCount("SIGTERM")).toBe(0);
  });

  it("turns SIGINT into a shared cancellation and exit 130", async () => {
    const host = fakeProcess();
    const result = await runPresentationProcess({
      process: host.process,
      run: async ({ host: inputHost }) => {
        host.process.emit("SIGINT");
        expect(inputHost.signal.aborted).toBe(true);
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    });
    expect(result.exitCode).toBe(130);
    expect(host.process.exitCode).toBe(130);
    expect(host.stderr.join("")).toContain("cancel/cli-cancelled");
    expect(host.process.listenerCount("SIGINT")).toBe(0);
    expect(host.process.listenerCount("SIGTERM")).toBe(0);
  });

  it("converts synchronous and asynchronous runner failures to stable I/O", async () => {
    for (const run of [
      () => {
        throw new Error("sync");
      },
      async () => {
        throw new Error("async");
      },
    ]) {
      const host = fakeProcess();
      const result = await runPresentationProcess({ process: host.process, run });
      expect(result).toMatchObject({ exitCode: 3, stdout: "" });
      expect(host.stderr.join("")).toContain("io/cli-process-io");
      expect(host.process.listenerCount("SIGINT")).toBe(0);
      expect(host.process.listenerCount("SIGTERM")).toBe(0);
    }
  });
});

it("routes author startup through the local host and shares process cancellation", async () => {
  const host = fakeProcess(["bun", "presentation", "author", "/project"]);
  const result = await runPresentationProcess({
    author: async (directory, signal) => {
      expect(directory).toBe("/project");
      expect(signal.aborted).toBe(false);
      host.process.emit("SIGTERM");
      expect(signal.aborted).toBe(true);
    },
    process: host.process,
    run: async () => {
      throw new Error("must not use check/build parser");
    },
  });
  expect(result.exitCode).toBe(130);
  expect(host.process.listenerCount("SIGTERM")).toBe(0);
});
