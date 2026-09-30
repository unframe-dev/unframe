import { expect, it, vi } from "vitest";
import { openOpaqueCaptureRuntime } from "../src/opaque/capture/runtime.js";

const boundary = vi.hoisted(() => ({
  failStderrOnBootstrap: false,
  resetBarrierOnExit: false,
  resets: 0,
  stderrFailures: 0,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      if (boundary.resetBarrierOnExit) {
        child.once("exit", () => {
          boundary.resets++;
          child.stdio[3]?.emit(
            "error",
            Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" }),
          );
        });
      }
      if (boundary.failStderrOnBootstrap) {
        child.stdout?.on("data", (chunk: Buffer) => {
          if (!chunk.includes('"bootstrap"')) {
            return;
          }
          queueMicrotask(() => {
            boundary.stderrFailures++;
            child.stderr?.emit("error", new Error("worker stderr failed"));
          });
        });
      }
      return child;
    },
  };
});

const request = {
  assets: [],
  background: [0, 0, 0, 0] as const,
  colorScheme: "light" as const,
  expectedBindings: {},
  javascript: "globalThis.__unframeMount=()=>{while(true){}};",
  logicalSize: [10, 10] as const,
  pixelTarget: [10, 10] as const,
  props: {},
  stateId: "default",
  stylesheets: [],
  texts: {},
};

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
  expect(await runtime.capture(request)).toEqual({ code: "opaque-capture-cancelled", ok: false });
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

it("handles a late barrier reset when closing an active worker", async () => {
  boundary.resetBarrierOnExit = true;
  boundary.resets = 0;
  const runtime = await openOpaqueCaptureRuntime();
  try {
    const active = runtime.capture(request);
    await runtime.close();
    await expect(active).rejects.toMatchObject({ code: "opaque-capture-cancelled" });
    expect(boundary.resets).toBeGreaterThan(0);
  } finally {
    boundary.resetBarrierOnExit = false;
    await runtime.close();
  }
}, 120_000);
