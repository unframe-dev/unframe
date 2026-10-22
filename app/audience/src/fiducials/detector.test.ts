import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  createAprilTagDetector,
  validateGrayFrame,
  type AprilTagFactory,
  type GrayFrame,
} from "./detector";

function raster(rows: string[], cellSize = 24): GrayFrame {
  const width = (rows[0]?.length ?? 0) * cellSize;
  const height = rows.length * cellSize;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels[y * width + x] =
        rows[Math.floor(y / cellSize)]?.[Math.floor(x / cellSize)] === "1" ? 255 : 0;
  return { width, height, pixels };
}

function rotateClockwise(frame: GrayFrame): GrayFrame {
  const pixels = new Uint8Array(frame.pixels.length);
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++)
      pixels[x * frame.height + frame.height - 1 - y] = frame.pixels[y * frame.width + x] ?? 0;
  return { width: frame.height, height: frame.width, pixels };
}

async function aprilTagDetector() {
  const source = await readFile(
    new URL("../../vendor/apriltag/apriltag_wasm.js", import.meta.url),
    "utf8",
  );
  const factory = runInNewContext(`${source}\nAprilTagWasm`, {
    console,
    importScripts() {},
    self: { location: { href: "https://example.test/apriltag_wasm.js" } },
  }) as AprilTagFactory;
  const binary = await readFile(
    new URL("../../vendor/apriltag/apriltag_wasm.wasm", import.meta.url),
  );
  const wasmBinary = Uint8Array.from(binary).buffer;
  return createAprilTagDetector(await factory({ wasmBinary }));
}

describe("dedicated fiducial detectors", () => {
  it("explicitly requests native full-resolution detection and edge refinement", () => {
    const configure = vi.fn(() => 0);
    const detector = createAprilTagDetector({
      HEAPU8: new Uint8Array(16),
      cwrap(name) {
        return name === "atagjs_set_detector_options" ? configure : () => 0;
      },
      getValue: () => 0,
    });
    expect(configure).toHaveBeenCalledWith(1, 0, 1, 1, 0, 0, 0);
    detector.dispose();
  });
  it("rejects malformed grayscale buffers before native code", () => {
    expect(() => validateGrayFrame({ width: 20, height: 20, pixels: new Uint8Array(1) })).toThrow(
      "Invalid grayscale",
    );
  });
  it.each([0, -1, 63, Number.NaN])(
    "rejects failed native image allocation (%s) without writing heap",
    (address) => {
      const heap = new Uint8Array(64).fill(77);
      const nativeDetect = vi.fn(() => 0);
      const detector = createAprilTagDetector({
        HEAPU8: heap,
        cwrap(name) {
          if (name === "atagjs_set_img_buffer") return () => address;
          if (name === "atagjs_detect") return nativeDetect;
          return () => 0;
        },
        getValue: () => 0,
      });
      expect(() => detector.detect({ width: 2, height: 2, pixels: new Uint8Array(4) })).toThrow(
        "buffer allocation failed",
      );
      expect(nativeDetect).not.toHaveBeenCalled();
      expect([...heap]).toEqual(Array(64).fill(77));
      detector.dispose();
    },
  );
  it("returns no markers for a blank frame", async () => {
    const frame = raster(["1111", "1111", "1111", "1111"]);
    const april = await aprilTagDetector();
    expect(april.detect(frame)).toEqual([]);
    april.dispose();
  });
  it("executes actual AprilTag 3 WASM on official tag36h11 marker 0", async () => {
    const frame = raster([
      "1111111111",
      "1000000001",
      "1011010101",
      "1001110101",
      "1001100001",
      "1010100001",
      "1001011001",
      "1000010001",
      "1000000001",
      "1111111111",
    ]);
    const april = await aprilTagDetector();
    const result = april.detect(frame);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      family: "tag36h11",
      id: 0,
      cornerRefinement: {
        method: "apriltag-edge",
        statuses: Array(4).fill("upstream-unreported"),
        maxDisplacementPx: null,
      },
    });
    expect(
      result[0]?.corners.some(
        (point) => point.x !== Math.round(point.x) || point.y !== Math.round(point.y),
      ),
    ).toBe(true);
    expect(result[0]?.corners[0]?.x).toBeLessThan(result[0]?.corners[1]?.x ?? 0);
    expect(result[0]?.corners[0]?.y).toBeLessThan(result[0]?.corners[3]?.y ?? 0);
    april.dispose();
    expect(() => april.detect(frame)).toThrow("disposed");
  });
  it("keeps canonical corner identity when the printed marker rotates", async () => {
    const april = await aprilTagDetector();
    const aprilFrame = rotateClockwise(
      raster([
        "1111111111",
        "1000000001",
        "1011010101",
        "1001110101",
        "1001100001",
        "1010100001",
        "1001011001",
        "1000010001",
        "1000000001",
        "1111111111",
      ]),
    );
    for (const detections of [april.detect(aprilFrame)]) {
      expect(detections).toHaveLength(1);
      const corners = detections[0]?.corners ?? [];
      expect(corners[0]?.x).toBeGreaterThan(corners[3]?.x ?? 0);
      expect(corners[0]?.y).toBeLessThan(corners[1]?.y ?? 0);
    }
    april.dispose();
  });
});
