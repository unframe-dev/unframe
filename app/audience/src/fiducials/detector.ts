import { validateGrayFrame, type GrayFrame } from "./detector-frame";
export { validateGrayFrame, type GrayFrame } from "./detector-frame";

export type MarkerFamily = "tag36h11";
export interface RawMarkerDetection {
  family: MarkerFamily;
  id: number;
  /** Canonical marker corners: top-left, top-right, bottom-right, bottom-left. */
  corners: { x: number; y: number }[];
  cornerRefinement?: {
    method: "apriltag-edge";
    statuses: "upstream-unreported"[];
    maxDisplacementPx: number | null;
  };
}
export interface DetectorResult {
  executed?: true;
  detections: RawMarkerDetection[];
  durationMs: number;
}
export interface AprilTagModule {
  HEAPU8: Uint8Array;
  cwrap(name: string, result: string | null, args: string[]): (...args: number[]) => number;
  getValue(pointer: number, type: string): number;
}
export type AprilTagFactory = (options: { wasmBinary: ArrayBuffer }) => Promise<AprilTagModule>;

export function createAprilTagDetector(module: AprilTagModule) {
  const init = module.cwrap("atagjs_init", "number", []);
  const destroy = module.cwrap("atagjs_destroy", "number", []);
  const configure = module.cwrap("atagjs_set_detector_options", "number", Array(7).fill("number"));
  const allocate = module.cwrap("atagjs_set_img_buffer", "number", Array(3).fill("number"));
  const detect = module.cwrap("atagjs_detect", "number", []);
  init();
  // ARENA's pinned C wrapper orders these as decimate, sigma, threads,
  // refine_edges, max_detections, return_pose, return_solutions.
  configure(1, 0, 1, 1, 0, 0, 0);
  let disposed = false;
  return {
    detect(frame: GrayFrame): RawMarkerDetection[] {
      if (disposed) throw new Error("AprilTag detector is disposed.");
      validateGrayFrame(frame);
      const buffer = allocate(frame.width, frame.height, frame.width);
      if (
        !Number.isInteger(buffer) ||
        buffer <= 0 ||
        buffer + frame.pixels.length > module.HEAPU8.length
      ) {
        throw new Error("AprilTag image buffer allocation failed.");
      }
      module.HEAPU8.set(frame.pixels, buffer);
      const pointer = detect();
      const length = module.getValue(pointer, "i32");
      if (length === 0) return [];
      const dataPointer = module.getValue(pointer + 4, "i32");
      const raw = JSON.parse(
        new TextDecoder().decode(module.HEAPU8.subarray(dataPointer, dataPointer + length)),
      ) as { id: number; corners: { x: number; y: number }[] }[];
      return raw.map((marker) => ({
        family: "tag36h11",
        id: marker.id,
        corners: [...marker.corners].reverse(),
        cornerRefinement: {
          method: "apriltag-edge",
          statuses: marker.corners.map(() => "upstream-unreported"),
          maxDisplacementPx: null,
        },
      }));
    },
    dispose() {
      if (!disposed) destroy();
      disposed = true;
    },
  };
}

async function loadAprilTagFactory(): Promise<AprilTagFactory> {
  // Vite adds ?import to relative dynamic imports, which cannot load public JavaScript.
  const moduleUrl = new URL("/external/detectors/apriltag.mjs", self.location.origin).href;
  return (await import(/* @vite-ignore */ moduleUrl)).default as AprilTagFactory;
}

export async function createDetector(factory?: AprilTagFactory) {
  const loadFactory = factory ?? (await loadAprilTagFactory());
  const response = await fetch("/external/detectors/apriltag_wasm.wasm");
  if (!response.ok) throw new Error(`AprilTag WASM load failed (${response.status}).`);
  const detector = createAprilTagDetector(
    await loadFactory({ wasmBinary: await response.arrayBuffer() }),
  );
  return {
    detect(frame: GrayFrame): DetectorResult {
      validateGrayFrame(frame);
      const start = performance.now();
      const detections = detector.detect(frame);
      return { executed: true, detections, durationMs: performance.now() - start };
    },
    dispose: () => detector.dispose(),
  };
}
