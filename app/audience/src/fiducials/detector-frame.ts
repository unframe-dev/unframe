export const MAX_DETECTOR_PIXELS = 4096 * 4096;

export interface GrayFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export function validateGrayFrame(frame: GrayFrame): void {
  if (
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width < 1 ||
    frame.height < 1 ||
    frame.width * frame.height > MAX_DETECTOR_PIXELS ||
    frame.pixels.length !== frame.width * frame.height
  ) {
    throw new Error("Invalid grayscale frame dimensions.");
  }
}
