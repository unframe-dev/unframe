import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RESIZE_IDENTITY, resizeRgba, type ResizeRequest } from "../src/index.js";
import { INTERNAL_PNG_HARD_CAPS } from "../src/png/constants.js";

const request = {
  sourceId: "image-1",
  rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]),
  pixelSize: [2, 1],
  targetPixelSize: [1, 1],
  colorSpace: "srgb",
  alphaMode: "straight",
  limits: {
    maxWidth: 4,
    maxHeight: 4,
    maxPixels: 16,
    maxInputBytes: 64,
    maxOutputBytes: 64,
  },
} as const satisfies ResizeRequest;

const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("memory RGBA resize", () => {
  it("resamples straight alpha without bleeding hidden RGB and owns output bytes", () => {
    const result = resizeRgba(request);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect([...result.value.rgba]).toEqual([255, 0, 0, 128]);
    expect(result.value.pixelSize).toEqual([1, 1]);
    expect(result.value.sourceChecksum).toBe(checksum(request.rgba));
    expect(result.value.checksum).toBe(checksum(result.value.rgba));
    expect(result.value.provenance).toEqual(RESIZE_IDENTITY);
    expect(result.value.rgba.buffer).not.toBe(request.rgba.buffer);
  });

  it("averages opaque sRGB in linear light", () => {
    const result = resizeRgba({
      ...request,
      rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]),
      alphaMode: "opaque",
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect([...result.value.rgba]).toEqual([188, 0, 188, 255]);
  });

  it("uses center-aligned linear interpolation when enlarging", () => {
    const result = resizeRgba({
      ...request,
      rgba: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
      targetPixelSize: [4, 1],
      alphaMode: "opaque",
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect([...result.value.rgba]).toEqual([
      0, 0, 0, 255, 137, 137, 137, 255, 225, 225, 225, 255, 255, 255, 255, 255,
    ]);
  });

  it("zeroes RGB when averaged alpha rounds to zero", () => {
    const pixels = new Uint8Array(256 * 4);
    pixels.set([255, 0, 0, 1]);
    const result = resizeRgba({
      ...request,
      rgba: pixels,
      pixelSize: [256, 1],
      limits: {
        maxWidth: 256,
        maxHeight: 1,
        maxPixels: 256,
        maxInputBytes: 1024,
        maxOutputBytes: 4,
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect([...result.value.rgba]).toEqual([0, 0, 0, 0]);
  });

  it("rejects premultiplied, invalid opaque alpha and invalid dimensions", () => {
    for (const [input, code] of [
      [{ ...request, alphaMode: "premultiplied" }, "unsupported-alpha-mode"],
      [{ ...request, alphaMode: "opaque" }, "opaque-alpha-mismatch"],
      [{ ...request, targetPixelSize: [0, 1] }, "invalid-target-pixel-size"],
    ] as const) {
      const result = resizeRgba(input);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.diagnostics.map((d) => d.code)).toContain(code);
    }
  });

  it("rejects requests above caller limits and hostile accessors without running them", () => {
    const exceeded = resizeRgba({ ...request, limits: { ...request.limits, maxOutputBytes: 3 } });
    expect(exceeded.valid).toBe(false);
    if (!exceeded.valid) expect(exceeded.diagnostics[0]?.code).toBe("resize-limit-exceeded");
    let reads = 0;
    const hostile = { ...request } as Record<string, unknown>;
    Object.defineProperty(hostile, "sourceId", {
      get() {
        reads++;
        return "x";
      },
    });
    expect(resizeRgba(hostile).valid).toBe(false);
    expect(reads).toBe(0);
  });

  it("rejects bytes above the hard cap before copying them", () => {
    const oversized = new Uint8Array(INTERNAL_PNG_HARD_CAPS.maxInputBytes + 1);
    const set = vi.spyOn(Uint8Array.prototype, "set");
    try {
      const result = resizeRgba({ ...request, rgba: oversized });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.diagnostics[0]?.code).toBe("invalid-rgba");
      expect(set).not.toHaveBeenCalled();

      const wrongDeclaredSize = resizeRgba({ ...request, rgba: new Uint8Array(1024) });
      expect(wrongDeclaredSize.valid).toBe(false);
      expect(set).not.toHaveBeenCalled();
    } finally {
      set.mockRestore();
    }
  });
});
