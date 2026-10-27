import { createDetector, type GrayFrame } from "./detector";

type WorkerRequest = { type: "init" } | { type: "detect"; id: number; frame: GrayFrame };

let detector: ReturnType<typeof createDetector> | undefined;
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      if (detector) throw new Error("Detector is already initialized.");
      detector = createDetector();
      await detector;
      self.postMessage({ ready: true });
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type !== "detect") return;
  try {
    if (!detector) throw new Error("Detector is not initialized.");
    const result = (await detector).detect(message.frame);
    const pixelBuffer = message.frame.pixels.buffer as ArrayBuffer;
    self.postMessage({ id: message.id, result, pixelBuffer }, { transfer: [pixelBuffer] });
  } catch (error) {
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
