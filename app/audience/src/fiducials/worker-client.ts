import type { DetectorResult } from "./detector";
import { validateGrayFrame, type GrayFrame } from "./detector-frame";

export async function createDetectorWorker() {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let sequence = 0;
  let disposed = false;
  let pending:
    | {
        id: number;
        frame: GrayFrame;
        pixelOffset: number;
        pixelLength: number;
        resolve: (result: DetectorResult) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Detector initialization timed out.")),
        30_000,
      );
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(event.message || "Detector Worker failed."));
      };
      worker.onmessage = (event: MessageEvent<{ ready?: boolean; error?: string }>) => {
        clearTimeout(timer);
        if (event.data.ready) resolve();
        else reject(new Error(event.data.error ?? "Detector initialization failed."));
      };
      try {
        worker.postMessage({ type: "init" });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  } catch (error) {
    worker.terminate();
    throw error;
  }
  worker.onmessage = (
    event: MessageEvent<{
      id: number;
      result?: DetectorResult;
      error?: string;
      pixelBuffer?: ArrayBuffer;
    }>,
  ) => {
    if (!pending || pending.id !== event.data.id) return;
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    if (event.data.result) {
      const buffer = event.data.pixelBuffer;
      if (
        !(buffer instanceof ArrayBuffer) ||
        buffer.byteLength < current.pixelOffset + current.pixelLength
      ) {
        current.reject(new Error("Detector did not return the transferred pixels."));
        return;
      }
      current.frame.pixels = new Uint8Array(buffer, current.pixelOffset, current.pixelLength);
      current.resolve(event.data.result);
    } else current.reject(new Error(event.data.error ?? "Detection failed."));
  };
  worker.onerror = (event) => {
    if (disposed) return;
    disposed = true;
    worker.terminate();
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(event.message || "Detector Worker failed."));
      pending = undefined;
    }
  };
  return {
    detect(frame: GrayFrame): Promise<DetectorResult> {
      if (disposed) return Promise.reject(new Error("Detector Worker is disposed."));
      if (pending) return Promise.reject(new Error("Detector Worker already has a pending frame."));
      validateGrayFrame(frame);
      if (!(frame.pixels.buffer instanceof ArrayBuffer)) {
        return Promise.reject(new Error("Detector requires transferable pixel memory."));
      }
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending = undefined;
          disposed = true;
          worker.terminate();
          reject(new Error("Detection timed out."));
        }, 15_000);
        pending = {
          id,
          frame,
          pixelOffset: frame.pixels.byteOffset,
          pixelLength: frame.pixels.length,
          resolve,
          reject,
          timer,
        };
        const message = {
          type: "detect",
          id,
          frame: { width: frame.width, height: frame.height, pixels: frame.pixels },
        };
        try {
          worker.postMessage(message, [frame.pixels.buffer as ArrayBuffer]);
        } catch (error) {
          clearTimeout(timer);
          pending = undefined;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.terminate();
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Detector Worker stopped."));
        pending = undefined;
      }
    },
  };
}
