import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DETECTOR_PIXELS, validateGrayFrame } from "../detector-frame";
import { createDetectorWorker } from "../worker-client";

class FakeWorker {
  static instance: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instance = this;
    queueMicrotask(() => this.onmessage?.({ data: { ready: true } }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("detector Worker client", () => {
  it("bounds pending work and correlates results to the submitted frame", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = await createDetectorWorker();
    const frame = { width: 2, height: 2, pixels: new Uint8Array(4) };
    const result = client.detect(frame);
    await expect(client.detect(frame)).rejects.toThrow("pending");
    const detection = { detections: [], durationMs: 1 };
    FakeWorker.instance.onmessage?.({
      data: { id: 1, result: detection, pixelBuffer: frame.pixels.buffer },
    });
    expect(await result).toEqual(detection);
    expect(frame.pixels.byteLength).toBe(4);
    client.dispose();
    expect(FakeWorker.instance.terminate).toHaveBeenCalledOnce();
    await expect(client.detect(frame)).rejects.toThrow("disposed");
  });
  it("rejects pending work when stopped", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = await createDetectorWorker();
    const result = client.detect({ width: 1, height: 1, pixels: new Uint8Array(1) });
    client.dispose();
    await expect(result).rejects.toThrow("stopped");
  });
  it("reports detector errors without leaving work pending", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = await createDetectorWorker();
    const result = client.detect({ width: 1, height: 1, pixels: new Uint8Array(1) });
    FakeWorker.instance.onmessage?.({ data: { id: 1, error: "bad frame" } });
    await expect(result).rejects.toThrow("bad frame");
    client.dispose();
  });
  it("terminates stalled native detection instead of queueing more frames", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = await createDetectorWorker();
    vi.useFakeTimers();
    const frame = { width: 1, height: 1, pixels: new Uint8Array(1) };
    const result = client.detect(frame);
    const assertion = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(FakeWorker.instance.terminate).toHaveBeenCalledOnce();
    await expect(client.detect(frame)).rejects.toThrow("disposed");
  });
  it("terminates a failed Worker and rejects subsequent frames immediately", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = await createDetectorWorker();
    const frame = { width: 1, height: 1, pixels: new Uint8Array(1) };
    const result = client.detect(frame);
    FakeWorker.instance.onerror?.({ message: "native failure" });
    await expect(result).rejects.toThrow("native failure");
    expect(FakeWorker.instance.terminate).toHaveBeenCalledOnce();
    await expect(client.detect(frame)).rejects.toThrow("disposed");
  });
  it("terminates a Worker that fails between frames", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = await createDetectorWorker();
    FakeWorker.instance.onerror?.({ message: "idle failure" });
    expect(FakeWorker.instance.terminate).toHaveBeenCalledOnce();
    await expect(client.detect({ width: 1, height: 1, pixels: new Uint8Array(1) })).rejects.toThrow(
      "disposed",
    );
  });
});

describe("native frame pixel budget", () => {
  it("accepts a 4K frame intact and rejects oversized images rather than silently resizing", () => {
    const frame = { width: 3840, height: 2160, pixels: new Uint8Array(3840 * 2160) };
    expect(() => validateGrayFrame(frame)).not.toThrow();
    expect(MAX_DETECTOR_PIXELS).toBe(4096 * 4096);
    expect(() =>
      validateGrayFrame({ width: 4097, height: 4097, pixels: new Uint8Array(0) }),
    ).toThrow();
  });
});
