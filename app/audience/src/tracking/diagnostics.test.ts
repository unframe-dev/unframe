import { describe, expect, it } from "vitest";
import { createDiagnostics } from "./diagnostics";
describe("diagnostic retention", () => {
  it("retains startup evidence even after sampled telemetry exceeds capacity", () => {
    const log = createDiagnostics(3);
    log.record(0, "sdk.started", { videoWidth: 1280 });
    for (let i = 1; i <= 5; i++) log.record(i, "fiducial.frame", { frames: i });
    const result = log.snapshot();
    expect(result.records.map((row) => row.timeMs)).toEqual([0, 3, 4, 5]);
    expect(result.droppedSamples).toBe(2);
  });
  it("snapshots mutable SDK objects at capture time", () => {
    const log = createDiagnostics();
    const detail = { position: { x: 1 } };
    log.record(1, "fiducial.frame", detail);
    detail.position.x = 99;
    expect(log.snapshot().records[0]!.detail).toEqual({ position: { x: 1 } });
  });
});

it("keeps SDK pose samples in the sampled ring without evicting transitions", () => {
  const log = createDiagnostics(2);
  log.record(0, "sdk.started", {});
  for (let i = 1; i <= 1005; i++) log.record(i, "sdk.pose", { callbackAtMs: i });
  const snapshot = log.snapshot();
  expect(snapshot.records.map((row) => row.event)).toEqual(["sdk.started", "sdk.pose", "sdk.pose"]);
  expect(snapshot.droppedSamples).toBe(1003);
  expect(snapshot.droppedTransitions).toBe(0);
});
