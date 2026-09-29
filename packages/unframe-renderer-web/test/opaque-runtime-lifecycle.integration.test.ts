import { expect, it } from "vitest";
import { openOpaqueCaptureRuntime } from "../src/opaque/capture/runtime.js";

it("close waits for the active worker and rejects later capture as cancelled", async () => {
  const runtime = await openOpaqueCaptureRuntime();
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
