import { expect, it, vi } from "vite-plus/test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { openOpaqueCaptureRuntime } from "../src/opaque/capture/runtime.js";

const boundary = vi.hoisted(() => ({
  resetBarrierOnExit: false,
  failStderrOnBootstrap: false,
  resets: 0,
  stderrFailures: 0,
  onBootstrap: undefined as (() => void) | undefined,
  onReady: undefined as (() => void) | undefined,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.includes('"bootstrap"')) boundary.onBootstrap?.();
        if (chunk.includes('"type":"ready"') && boundary.onReady) queueMicrotask(boundary.onReady);
      });
      if (boundary.resetBarrierOnExit)
        child.once("exit", () => {
          boundary.resets++;
          child.stdio[3]?.emit(
            "error",
            Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" }),
          );
        });
      if (boundary.failStderrOnBootstrap)
        child.stdout?.on("data", (chunk: Buffer) => {
          if (!chunk.includes('"bootstrap"')) return;
          queueMicrotask(() => {
            boundary.stderrFailures++;
            child.stderr?.emit("error", new Error("worker stderr failed"));
          });
        });
      return child;
    },
  };
});

const request = {
  javascript: "globalThis.__unframeMount=()=>{while(true){}};",
  stylesheets: [],
  assets: [],
  props: {},
  texts: {},
  expectedBindings: {},
  stateId: "default",
  logicalSize: [10, 10] as const,
  pixelTarget: [10, 10] as const,
  background: [0, 0, 0, 0] as const,
  colorScheme: "light" as const,
};

it("does not stage capture resources when only its fingerprint is used", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-lazy-runtime-"));
  vi.stubEnv("TMPDIR", directory);
  let runtime: Awaited<ReturnType<typeof openOpaqueCaptureRuntime>> | undefined;
  try {
    runtime = await openOpaqueCaptureRuntime();
    expect(runtime.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await readdir(directory)).toEqual([]);
    await runtime.close();
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await runtime?.close();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

it("rejects changed runtime bytes before executing a deferred capture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-runtime-identity-"));
  const browser = join(
    directory,
    "chromium_headless_shell-1234",
    process.platform === "darwin"
      ? "chrome-headless-shell-mac-arm64"
      : "chrome-headless-shell-linux64",
  );
  await mkdir(browser, { recursive: true });
  const executable = join(browser, "chrome-headless-shell");
  await writeFile(executable, "original runtime");
  const path = vi
    .spyOn(chromium, "executablePath")
    .mockReturnValue(join(directory, "chromium-1234", "chrome-linux64", "chrome"));
  let runtime: Awaited<ReturnType<typeof openOpaqueCaptureRuntime>> | undefined;
  try {
    runtime = await openOpaqueCaptureRuntime();
    await writeFile(executable, "modified runtime");
    await expect(runtime.capture(request)).rejects.toThrow("Opaque runtime changed");
  } finally {
    await runtime?.close();
    path.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

it("close waits for the active worker and rejects later capture as cancelled", async () => {
  const runtime = await openOpaqueCaptureRuntime();
  let settled = false;
  const active = runtime
    .capture(request)
    .finally(() => {
      settled = true;
    })
    .catch((error: unknown) => error);
  const closeStarted = performance.now();
  await runtime.close();
  expect(performance.now() - closeStarted).toBeLessThan(20_000);
  expect(settled).toBe(true);
  await active;
  expect(await runtime.capture(request)).toEqual({ ok: false, code: "opaque-capture-cancelled" });
  await runtime.close();
}, 120_000);

it("fails capture when worker stderr fails before the result", async () => {
  boundary.failStderrOnBootstrap = true;
  boundary.stderrFailures = 0;
  const runtime = await openOpaqueCaptureRuntime();
  try {
    await expect(runtime.capture(request)).rejects.toMatchObject({ code: "opaque-capture-failed" });
    expect(boundary.stderrFailures).toBeGreaterThan(0);
  } finally {
    boundary.failStderrOnBootstrap = false;
    await runtime.close();
  }
}, 120_000);

it("cancels an active Chromium worker", async () => {
  const controller = new AbortController();
  const runtime = await openOpaqueCaptureRuntime({ signal: controller.signal });
  boundary.onReady = () => controller.abort();
  try {
    await expect(runtime.capture(request)).rejects.toMatchObject({
      code: "opaque-capture-cancelled",
    });
  } finally {
    boundary.onReady = undefined;
    await runtime.close();
  }
}, 120_000);

it("handles a late barrier reset when closing an active worker", async () => {
  boundary.resetBarrierOnExit = true;
  boundary.resets = 0;
  const bootstrapped = Promise.withResolvers<void>();
  boundary.onBootstrap = () => bootstrapped.resolve();
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const active = runtime.capture(request);
    await Promise.race([bootstrapped.promise, active]);
    await runtime.close();
    await expect(active).rejects.toMatchObject({ code: "opaque-capture-cancelled" });
    expect(boundary.resets).toBeGreaterThan(0);
  } finally {
    boundary.resetBarrierOnExit = false;
    boundary.onBootstrap = undefined;
    await runtime.close();
  }
}, 120_000);
