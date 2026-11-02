import { expect, it } from "vitest";
import { admitPngMemory } from "../png-memory";

const image = { pixelSize: [1024, 1024] as const, encodedSizeBytes: 1024 };
it("includes the old scene's retained bitmap while admitting replacement decode", () => {
  const budget = 12 * 1024 * 1024;
  expect(admitPngMemory([image], 0, budget)).toBe(4 * 1024 * 1024);
  expect(() => admitPngMemory([image], 8 * 1024 * 1024, budget)).toThrow("CPU");
});
it("keeps an in-budget replacement and charges earlier images in its serial peak", () => {
  expect(admitPngMemory([image], 4 * 1024 * 1024, 13 * 1024 * 1024)).toBe(4 * 1024 * 1024);
  expect(() => admitPngMemory([image, image], 4 * 1024 * 1024, 13 * 1024 * 1024)).toThrow("CPU");
});

it("rejects resident memory above budget even when all textures are already loaded", () => {
  expect(() => admitPngMemory([], 101, 100)).toThrow("budget");
  expect(admitPngMemory([], 100, 100)).toBe(0);
});
