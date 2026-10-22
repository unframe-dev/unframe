import type { DetectorResult } from "../fiducials/detector";
import type { FiducialFrame } from "../fiducials/frame-source";
import { validateGrayFrame } from "../fiducials/detector-frame";

export interface DetectorInputCapture {
  frame: FiducialFrame;
  result: DetectorResult;
  localization: unknown;
  receivedAtMs: number;
}
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export function serializeDetectorInput(capture: DetectorInputCapture) {
  const { frame } = capture;
  validateGrayFrame(frame);
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("検出画像の保存用canvasを作成できません。");
  const image = context.createImageData(frame.width, frame.height);
  for (let i = 0; i < frame.pixels.length; i++) {
    const value = frame.pixels[i]!;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const pngDataUrl = canvas.toDataURL("image/png");
  if (!pngDataUrl.startsWith("data:image/png;base64,"))
    throw new Error("PNGの生成に失敗しました。");
  return {
    captureVersion: 1,
    frameId: frame.id,
    captureSessionId: frame.captureSessionId ?? null,
    capturedAtMs: frame.timestampMs,
    sourceVideoTime: frame.sourceVideoTime,
    receivedAtMs: capture.receivedAtMs,
    ageAtExportMs: performance.now() - frame.timestampMs,
    width: frame.width,
    height: frame.height,
    intrinsics: frame.intrinsics,
    sdkFromCamera: frame.worldFromCamera,
    captureMetadata: frame.metadata ?? null,
    pixelFormat: "gray8-top-left-row-major",
    grayPixelsBase64: base64(frame.pixels),
    pngDataUrl,
    overlaysIncluded: false,
    result: capture.result,
    localization: capture.localization,
  };
}
