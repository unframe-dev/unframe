import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserStatusSink } from "./browser-status.mts";
import type { BrowserStatus } from "./browser-entry";

test("an unhandled browser error remains fatal after later Runtime updates", async () => {
  const written: BrowserStatus[] = [];
  const sink = createBrowserStatusSink(async (value) => {
    written.push(value);
  });
  const ready: BrowserStatus = {
    phase: "ready",
    stepId: "start",
    paused: false,
    reliableSequence: "4",
    stateSequence: "1",
    connections: 1,
    assets: 3,
    continued: null,
    surfaceState: "default",
    opacity: 1,
    drawCalls: 3,
    texturedRenderers: 3,
    renderedOpacity: 1,
    renderedPixels: 100,
  };
  await sink.report(ready);
  const failure = sink.fail({ ...ready, phase: "error", error: "browser-page-error" });
  const update = sink.report({ ...ready, reliableSequence: "5" });
  await Promise.all([failure, update, sink.flush()]);
  assert.deepEqual(
    written.map((value) => value.phase),
    ["ready", "error", "error"],
  );
  assert.equal(written.at(-1)?.error, "browser-page-error");
  assert.equal(written.at(-1)?.reliableSequence, "4");
});
