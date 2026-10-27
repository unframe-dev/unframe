import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createAprilTagDetector,
  type AprilTagFactory,
  type GrayFrame,
  type MarkerFamily,
  type RawMarkerDetection,
} from "./detector";

interface TestDetector {
  detect(frame: GrayFrame): RawMarkerDetection[];
  dispose?: () => void;
}
interface MarkerDefinition {
  id: number;
  rows: string[];
}
interface ProductionDefinitions {
  families: Record<MarkerFamily, MarkerDefinition[]>;
}
const definitions = JSON.parse(
  await readFile(new URL("../../public/markers/definitions.json", import.meta.url), "utf8"),
) as ProductionDefinitions;

function raster(markers: MarkerDefinition[]): GrayFrame {
  const width = 240;
  const height = markers.length * 240;
  const pixels = new Uint8Array(width * height).fill(255);
  markers.forEach(({ rows }, index) => {
    const size = rows.length;
    const cellSize = 192 / size;
    for (let y = 0; y < 192; y++) {
      for (let x = 0; x < 192; x++) {
        pixels[(index * 240 + y + 24) * width + x + 24] =
          rows[Math.floor(y / cellSize)]?.[Math.floor(x / cellSize)] === "1" ? 255 : 0;
      }
    }
  });
  return { width, height, pixels };
}

async function actualAprilTag() {
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
  return createAprilTagDetector(await factory({ wasmBinary: Uint8Array.from(binary).buffer }));
}

describe("published AprilTag definition", () => {
  for (const family of ["tag36h11"] as const) {
    for (const id of [0]) {
      it(`detects the actual published ${family} marker ${id}`, async () => {
        const marker = definitions.families[family].find((entry) => entry.id === id);
        expect(marker).toBeDefined();
        const frame = raster([marker!]);
        const detector: TestDetector = await actualAprilTag();
        try {
          const detections = detector.detect(frame);
          expect(detections).toHaveLength(1);
          expect(detections[0]).toMatchObject({ family, id });
          const corners = detections[0]!.corners;
          expect(corners[0]!.x).toBeCloseTo(24, -1);
          expect(corners[0]!.y).toBeCloseTo(24, -1);
          expect(corners[2]!.x).toBeCloseTo(216, -1);
          expect(corners[2]!.y).toBeCloseTo(216, -1);
        } finally {
          detector.dispose?.();
        }
      });
    }
  }
});
