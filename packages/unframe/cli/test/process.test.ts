import { describe, expect, it } from "vitest";

import { runPresentationProcess } from "../src/index.js";

const fakeProcess = (argv: readonly string[] = ["bun", "presentation", "check", "/project"]) => {
  const listeners = new Map<string, (() => void)[]>();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const process = {
    argv,
    stdout: { write: (text: string) => stdout.push(text) },
    stderr: { write: (text: string) => stderr.push(text) },
    on: (signal: string, listener: () => void) => {
      listeners.set(signal, [...(listeners.get(signal) ?? []), listener]);
    },
    off: (signal: string, listener: () => void) => {
      listeners.set(
        signal,
        (listeners.get(signal) ?? []).filter((item) => item !== listener),
      );
    },
    emit: (signal: string) => listeners.get(signal)?.forEach((listener) => listener()),
    listenerCount: (signal: string) => listeners.get(signal)?.length ?? 0,
    exitCode: undefined as number | undefined,
  };
  return { process, stdout, stderr };
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
        return { exitCode: 0, stdout: "check: ok\n", stderr: "" };
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
        return { exitCode: 0, stdout: "", stderr: "" };
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
      async () => Promise.reject(new Error("async")),
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
    process: host.process,
    author: async (directory, signal) => {
      expect(directory).toBe("/project");
      expect(signal.aborted).toBe(false);
      host.process.emit("SIGTERM");
      expect(signal.aborted).toBe(true);
    },
    run: async () => {
      throw new Error("must not use check/build parser");
    },
  });
  expect(result.exitCode).toBe(130);
  expect(host.process.listenerCount("SIGTERM")).toBe(0);
});

it("routes dev through the shared process signal and reports watched builds", async () => {
  const host = fakeProcess(["bun", "presentation", "dev", "/project"]);
  const result = await runPresentationProcess({
    process: host.process,
    dev: async (directory, signal, report) => {
      expect(directory).toBe("/project");
      expect(signal.aborted).toBe(false);
      report({ exitCode: 0, stdout: "build: ok\n", stderr: "" });
      host.process.emit("SIGINT");
    },
  });
  expect(result.exitCode).toBe(130);
  expect(host.stdout).toEqual(["build: ok\n"]);
  expect(host.process.listenerCount("SIGINT")).toBe(0);
});

it("routes preview and announces only its loopback URL", async () => {
  const host = fakeProcess(["bun", "presentation", "preview", "/project"]);
  const result = await runPresentationProcess({
    process: host.process,
    preview: async (directory, signal, announce) => {
      expect(directory).toBe("/project");
      expect(signal.aborted).toBe(false);
      announce("http://127.0.0.1:9999/");
      return { exitCode: 1, stdout: "", stderr: "build failed\n" };
    },
  });
  expect(result.exitCode).toBe(1);
  expect(host.stdout).toEqual(["Preview: http://127.0.0.1:9999/\n"]);
});

it("publishes with a process-supplied token without printing it", async () => {
  const host = fakeProcess([
    "bun",
    "presentation",
    "publish",
    "/project",
    "presentation",
    "http://127.0.0.1:8787/",
  ]);
  Object.assign(host.process, { env: { UNFRAME_ACCESS_TOKEN: "private-token" } });
  const result = await runPresentationProcess({
    process: host.process,
    publish: async (input) => {
      expect(input).toMatchObject({
        directory: "/project",
        presentationId: "presentation",
        controlPlaneUrl: "http://127.0.0.1:8787/",
        bearerToken: "private-token",
      });
      return { ok: true, buildId: "build-id", publicationEpoch: 1 };
    },
  });
  expect(result.exitCode).toBe(0);
  expect(host.stdout.join("")).toContain("epoch 1");
  expect(host.stdout.join("") + host.stderr.join("")).not.toContain("private-token");
});

it("does not overwrite a committed build receipt after a late SIGINT", async () => {
  const host = fakeProcess(["bun", "presentation", "build", "/project"]);
  const result = await runPresentationProcess({
    process: host.process,
    run: async () => {
      host.process.emit("SIGINT");
      return { exitCode: 0, stdout: "build: ok\n", stderr: "", generationId: "a".repeat(32) };
    },
  });
  expect(result.exitCode).toBe(0);
  expect(host.stdout).toEqual(["build: ok\n"]);
});

it("retains an unknown publication operation after a late SIGINT", async () => {
  const host = fakeProcess([
    "bun",
    "presentation",
    "publish",
    "/project",
    "p",
    "https://api.example",
  ]);
  Object.assign(host.process, { env: { UNFRAME_ACCESS_TOKEN: "private" } });
  const operation = {
    presentationId: "p",
    buildId: "b",
    publicationEpoch: 1,
    definitionHash: "d",
    renderBundleHash: "r",
    assetSetHash: "a",
  };
  const result = await runPresentationProcess({
    process: host.process,
    publish: async () => {
      host.process.emit("SIGINT");
      return {
        ok: false,
        code: "cli-publish-outcome-unknown",
        outcome: "outcome-unknown",
        operation,
      };
    },
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("cli-publish-outcome-unknown");
  expect(result.stderr).toContain(JSON.stringify(operation));
});

it("queries the printed publication operation without sending another publication", async () => {
  const operation = {
    presentationId: "p",
    buildId: "b",
    publicationEpoch: 1,
    definitionHash: `sha256:${"a".repeat(64)}`,
    renderBundleHash: `sha256:${"b".repeat(64)}`,
    assetSetHash: `sha256:${"c".repeat(64)}`,
  };
  const host = fakeProcess([
    "bun",
    "presentation",
    "publication-status",
    JSON.stringify(operation),
    "https://api.example",
  ]);
  Object.assign(host.process, { env: { UNFRAME_ACCESS_TOKEN: "private" } });
  const result = await runPresentationProcess({
    process: host.process,
    query: async (input) => {
      expect(input.operation).toEqual(operation);
      expect(input.controlPlaneUrl).toBe("https://api.example");
      return { ok: true, buildId: "b", publicationEpoch: 1 };
    },
    publish: async () => {
      throw new Error("Must not republish");
    },
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("publish: ok (b, epoch 1)");
});

it("keeps an acknowledged publication successful after a late SIGINT", async () => {
  const host = fakeProcess([
    "bun",
    "presentation",
    "publish",
    "/project",
    "p",
    "https://api.example",
  ]);
  Object.assign(host.process, { env: { UNFRAME_ACCESS_TOKEN: "private" } });
  const result = await runPresentationProcess({
    process: host.process,
    publish: async () => {
      host.process.emit("SIGINT");
      return { ok: true, buildId: "b", publicationEpoch: 1 };
    },
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("publish: ok");
});
