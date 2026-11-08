import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";
import { describe, expect, expectTypeOf, it, vi } from "vite-plus/test";
import {
  PNG_ABSOLUTE_LIMITS,
  PNG_ENCODER_IDENTITY,
  encodeRgbaToPng,
  type EncodeRequest,
  type EncodedTextureArtifact,
} from "../src/index.js";

const request = {
  sourceId: "capture-title-default",
  rgba: new Uint8Array([255, 0, 0, 255]),
  pixelSize: [1, 1],
  colorSpace: "srgb",
  alphaMode: "opaque",
  limits: {
    maxWidth: 1,
    maxHeight: 1,
    maxPixels: 1,
    maxInputBytes: 4,
    maxOutputBytes: 1024,
  },
} as const satisfies EncodeRequest;

const readU32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit++)
    current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  return current >>> 0;
});

const crc32 = (bytes: Uint8Array) => {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 0xff]! ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
};

const parseChunks = (bytes: Uint8Array) => {
  const chunks: { type: string; data: Uint8Array; checksum: number }[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = readU32(bytes, offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const checksum = readU32(bytes, offset + 8 + length);
    chunks.push({ type: new TextDecoder().decode(typeBytes), data, checksum });
    expect(checksum).toBe(crc32(new Uint8Array([...typeBytes, ...data])));
    offset += 12 + length;
  }
  return chunks;
};

const diagnosticCodes = (value: unknown) => {
  const result = encodeRgbaToPng(value);
  expect(result.valid).toBe(false);
  return result.valid ? [] : result.diagnostics.map(({ code }) => code);
};

describe("deterministic PNG encoding", () => {
  it("compresses flat slide pixels within the actual encoded byte budget", () => {
    const width = 1920,
      height = 1080;
    const rgba = new Uint8Array(width * height * 4).fill(255);
    const result = encodeRgbaToPng({
      ...request,
      rgba,
      pixelSize: [width, height],
      limits: {
        maxWidth: width,
        maxHeight: height,
        maxPixels: width * height,
        maxInputBytes: rgba.length,
        maxOutputBytes: 30_000,
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.byteLength).toBeLessThan(30_000);
    const chunks = parseChunks(result.value.bytes);
    const raw = inflateSync(chunks[2]!.data);
    expect(raw).toHaveLength(height * (width * 4 + 1));
    expect([...raw.subarray(0, 5)]).toEqual([0, 255, 255, 255, 255]);
  });
  it("preserves incompressible pixels within the compiler deflate bound", () => {
    const width = 128,
      height = 128;
    const rgba = new Uint8Array(width * height * 4);
    let state = 0x12345678;
    for (let index = 0; index < rgba.length; index++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      rgba[index] = state & 255;
    }
    const scanlineBytes = rgba.length + height;
    const maxOutputBytes =
      scanlineBytes +
      Math.floor(scanlineBytes / 4096) +
      Math.floor(scanlineBytes / 16384) +
      Math.floor(scanlineBytes / 33554432) +
      83;
    const result = encodeRgbaToPng({
      ...request,
      rgba,
      pixelSize: [width, height],
      alphaMode: "straight",
      limits: {
        maxWidth: width,
        maxHeight: height,
        maxPixels: width * height,
        maxInputBytes: rgba.length,
        maxOutputBytes,
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.byteLength).toBeLessThanOrEqual(maxOutputBytes);
    const scanlines = inflateSync(parseChunks(result.value.bytes)[2]!.data);
    const restored = new Uint8Array(rgba.length);
    for (let row = 0; row < height; row++)
      restored.set(
        scanlines.subarray(row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1)),
        row * width * 4,
      );
    expect(restored).toEqual(rgba);
  });

  it("freezes the public encoder identity and uses it for each result", () => {
    expect(Object.isFrozen(PNG_ENCODER_IDENTITY)).toBe(true);
    expect(Reflect.set(PNG_ENCODER_IDENTITY, "version", "changed")).toBe(false);
    const result = encodeRgbaToPng(request);
    expect(result.valid && result.value.provenance).toEqual(PNG_ENCODER_IDENTITY);
  });
  it("emits a stable content-addressed texture and provenance", () => {
    const first = encodeRgbaToPng(request);
    const second = encodeRgbaToPng(request);
    expect(first.valid).toBe(true);
    expect(second).toEqual(first);
    if (!first.valid) return;

    expect(first.value.descriptor).toEqual({
      assetId: first.value.descriptor.checksum,
      mediaType: "image/png",
      pixelSize: [1, 1],
      checksum: first.value.descriptor.checksum,
      encodedSizeBytes: first.value.bytes.length,
      colorSpace: "srgb",
      alphaMode: "opaque",
      mipCount: 1,
      gpuBytes: 4,
    });
    expect(first.value.descriptor.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.value.byteLength).toBe(first.value.bytes.length);
    expect(first.value.sourceId).toBe(request.sourceId);
    expect(first.value.provenance).toEqual({
      encoderId: "unframe-memory-png",
      version: "2",
      fingerprint: `png-rgba8-srgb-filter0-deflate6-w15-m8-s0-v2-${process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.version}`}-zlib-${process.versions.zlib}`,
    });
  });

  it("emits valid fixed PNG chunks, CRCs, and filter-none RGBA scanlines", () => {
    const result = encodeRgbaToPng(request);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect([...result.value.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = parseChunks(result.value.bytes);
    expect(chunks.map(({ type }) => type)).toEqual(["IHDR", "sRGB", "IDAT", "IEND"]);
    expect([...chunks[0]!.data]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    expect([...chunks[1]!.data]).toEqual([0]);
    expect([...inflateSync(chunks[2]!.data)]).toEqual([0, 255, 0, 0, 255]);
    expect(chunks[3]!.data).toHaveLength(0);
  });

  it("preserves pixel order across scanline boundaries", () => {
    const rgba = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
    const result = encodeRgbaToPng({
      ...request,
      rgba,
      pixelSize: [2, 2],
      alphaMode: "straight",
      limits: {
        maxWidth: 2,
        maxHeight: 2,
        maxPixels: 4,
        maxInputBytes: rgba.length,
        maxOutputBytes: 1024,
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const idat = parseChunks(result.value.bytes).find(({ type }) => type === "IDAT")!.data;
    expect([...inflateSync(idat)]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("uses the standard CRC-32 polynomial", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("compresses large scanline data deterministically", () => {
    const width = 256;
    const height = 64;
    const rgba = new Uint8Array(width * height * 4).fill(255);
    const largeRequest = {
      ...request,
      rgba,
      pixelSize: [width, height],
      limits: {
        maxWidth: width,
        maxHeight: height,
        maxPixels: width * height,
        maxInputBytes: rgba.length,
        maxOutputBytes: 70_000,
      },
    } as const satisfies EncodeRequest;
    const result = encodeRgbaToPng(largeRequest);
    const repeated = encodeRgbaToPng(largeRequest);
    expect(result.valid).toBe(true);
    expect(repeated).toEqual(result);
    if (!result.valid) return;

    const idat = parseChunks(result.value.bytes).find(({ type }) => type === "IDAT")!.data;
    expect(idat.byteLength).toBeLessThan(rgba.length / 100);
    expect(inflateSync(idat)).toHaveLength(height * (width * 4 + 1));
  });

  it("preserves scanlines below the former stored-block boundary", () => {
    const width = 256;
    const height = 63;
    const rgba = new Uint8Array(width * height * 4).fill(255);
    const result = encodeRgbaToPng({
      ...request,
      rgba,
      pixelSize: [width, height],
      limits: {
        maxWidth: width,
        maxHeight: height,
        maxPixels: width * height,
        maxInputBytes: rgba.length,
        maxOutputBytes: 70_000,
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const idat = parseChunks(result.value.bytes).find(({ type }) => type === "IDAT")!.data;
    expect(inflateSync(idat)).toHaveLength(64_575);
  });

  it("preserves straight alpha and rejects ambiguous or false alpha metadata", () => {
    const straight = encodeRgbaToPng({
      ...request,
      rgba: new Uint8Array([10, 20, 30, 40]),
      alphaMode: "straight",
    });
    expect(straight.valid).toBe(true);
    if (straight.valid) {
      const idat = parseChunks(straight.value.bytes).find(({ type }) => type === "IDAT")!;
      expect([...inflateSync(idat.data)]).toEqual([0, 10, 20, 30, 40]);
      expect(straight.value.descriptor.alphaMode).toBe("straight");
    }

    expect(diagnosticCodes({ ...request, alphaMode: "premultiplied" })).toContain(
      "unsupported-alpha-mode",
    );
    expect(diagnosticCodes({ ...request, rgba: new Uint8Array([0, 0, 0, 0]) })).toContain(
      "opaque-alpha-mismatch",
    );
  });

  it("changes content identity when encoded pixels change without mutating input", () => {
    const original = new Uint8Array([255, 0, 0, 255]);
    const red = encodeRgbaToPng({ ...request, rgba: original });
    const blue = encodeRgbaToPng({
      ...request,
      rgba: new Uint8Array([0, 0, 255, 255]),
    });
    expect(red.valid && blue.valid).toBe(true);
    if (!red.valid || !blue.valid) return;
    expect(red.value.descriptor.assetId).not.toBe(blue.value.descriptor.assetId);
    expect(original).toEqual(new Uint8Array([255, 0, 0, 255]));
  });

  it("returns caller-owned bytes without sharing output across encode calls", () => {
    const original = new Uint8Array(request.rgba);
    const first = encodeRgbaToPng({ ...request, rgba: original });
    expect(first.valid).toBe(true);
    if (!first.valid) return;

    first.value.bytes[0] = 0;
    const repeated = encodeRgbaToPng({ ...request, rgba: original });
    expect(repeated.valid).toBe(true);
    if (!repeated.valid) return;
    expect(repeated.value.bytes[0]).toBe(137);
    expect(original).toEqual(request.rgba);
  });

  it("accepts Uint8Array input restored from another JavaScript realm", () => {
    const rgba = runInNewContext("new Uint8Array([255, 0, 0, 255])") as Uint8Array;
    expect(rgba).not.toBeInstanceOf(Uint8Array);
    expect(encodeRgbaToPng({ ...request, rgba }).valid).toBe(true);
  });
});

describe("PNG trust boundary", () => {
  it("rejects malformed source, bytes, geometry, color, and alpha fields", () => {
    expect(diagnosticCodes(null as never)).toContain("invalid-encode-request");
    expect(diagnosticCodes({ ...request, sourceId: "" })).toContain("invalid-source-id");
    expect(diagnosticCodes({ ...request, rgba: [255, 0, 0, 255] as never })).toContain(
      "invalid-rgba",
    );
    expect(diagnosticCodes({ ...request, pixelSize: [0, 1] })).toContain("invalid-pixel-size");
    expect(diagnosticCodes({ ...request, pixelSize: [1.5, 1] })).toContain("invalid-pixel-size");
    expect(diagnosticCodes({ ...request, rgba: new Uint8Array(3) })).toContain(
      "rgba-length-mismatch",
    );
    expect(diagnosticCodes({ ...request, colorSpace: "display-p3" as never })).toContain(
      "unsupported-color-space",
    );
    expect(diagnosticCodes({ ...request, alphaMode: "unknown" as never })).toContain(
      "invalid-alpha-mode",
    );
  });

  it("requires valid caller limits no larger than package hard caps", () => {
    expect(Object.isFrozen(PNG_ABSOLUTE_LIMITS)).toBe(true);
    expect(
      Reflect.set(
        PNG_ABSOLUTE_LIMITS as Record<string, number>,
        "maxWidth",
        PNG_ABSOLUTE_LIMITS.maxWidth + 1,
      ),
    ).toBe(false);
    expect(diagnosticCodes({ ...request, limits: { ...request.limits, maxWidth: 0 } })).toContain(
      "invalid-encode-limits",
    );
    expect(
      diagnosticCodes({
        ...request,
        limits: { ...request.limits, maxWidth: PNG_ABSOLUTE_LIMITS.maxWidth + 1 },
      }),
    ).toContain("encode-limit-above-hard-cap");
  });

  it("enforces caller input and actual encoded-output budgets", () => {
    expect(
      diagnosticCodes({ ...request, limits: { ...request.limits, maxInputBytes: 3 } }),
    ).toContain("encode-limit-exceeded");
    expect(
      diagnosticCodes({ ...request, limits: { ...request.limits, maxOutputBytes: 1 } }),
    ).toContain("encode-limit-exceeded");
    expect(
      diagnosticCodes({
        ...request,
        pixelSize: [PNG_ABSOLUTE_LIMITS.maxWidth + 1, 1],
        rgba: new Uint8Array(4),
        limits: {
          ...request.limits,
          maxWidth: PNG_ABSOLUTE_LIMITS.maxWidth,
          maxPixels: PNG_ABSOLUTE_LIMITS.maxPixels,
          maxInputBytes: PNG_ABSOLUTE_LIMITS.maxInputBytes,
          maxOutputBytes: PNG_ABSOLUTE_LIMITS.maxOutputBytes,
        },
      }),
    ).toContain("png-hard-cap-exceeded");
  });

  it("rejects over-cap and wrong-size RGBA before copying", () => {
    const set = vi.spyOn(Uint8Array.prototype, "set");
    try {
      expect(
        diagnosticCodes({
          ...request,
          rgba: new Uint8Array(PNG_ABSOLUTE_LIMITS.maxInputBytes + 1),
        }),
      ).toContain("png-hard-cap-exceeded");
      expect(set).not.toHaveBeenCalled();
      expect(diagnosticCodes({ ...request, rgba: new Uint8Array(1024) })).toContain(
        "rgba-length-mismatch",
      );
      expect(set).not.toHaveBeenCalled();
    } finally {
      set.mockRestore();
    }
  });

  it("converts hostile property access into stable diagnostics", () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile getter");
        },
      },
    );
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(() => encodeRgbaToPng(throwing)).not.toThrow();
    expect(diagnosticCodes(throwing)).toContain("invalid-encode-request");
    expect(() => encodeRgbaToPng(revocable.proxy)).not.toThrow();
    expect(diagnosticCodes(revocable.proxy)).toContain("invalid-encode-request");
  });

  it("rejects accessor-backed request properties without executing them", () => {
    let sourceReads = 0;
    const getterRequest = { ...request } as Record<string, unknown>;
    Object.defineProperty(getterRequest, "sourceId", {
      get() {
        sourceReads++;
        return request.sourceId;
      },
    });

    expect(encodeRgbaToPng(getterRequest).valid).toBe(false);
    expect(sourceReads).toBe(0);
  });
});

const typeContractChecks = (artifact: EncodedTextureArtifact) => {
  // @ts-expect-error RenderBundle descriptor aliases are read-only
  artifact.descriptor.assetId = "changed";
  artifact.bytes[0] = 0;
};

expectTypeOf(typeContractChecks).toBeFunction();
