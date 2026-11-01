import { describe, expect, it } from "vitest";
import { checksumBytes } from "../../src/build-execution/validation/source-assets.js";
import { snapshotSourceAssets } from "../../src/build-execution/validation/snapshot-source-assets.js";

const bytes = () => Uint8Array.of(0, 1, 0, 0);
const asset = () => ({
  id: "font",
  mediaType: "font/ttf",
  checksum: "sha256:bf5e8ffa51a9e748985800c1d3d7f1a2a6ae7435136593ca8d9637e3f87c699c",
  encodedSizeBytes: 4,
});

describe("source asset byte ownership", () => {
  it.each([{}, { other: bytes() }, { font: bytes(), extra: bytes() }])(
    "rejects missing and extra byte IDs",
    (carrier) => {
      expect(snapshotSourceAssets({ font: asset() }, carrier).valid).toBe(false);
    },
  );
  it("rejects modified bytes instead of accepting a descriptor checksum", () => {
    expect(snapshotSourceAssets({ font: asset() }, { font: Uint8Array.of(0, 1, 0, 1) }).valid).toBe(
      false,
    );
  });
  it("checks signatures even when the checksum matches", () => {
    expect(
      snapshotSourceAssets({ font: { ...asset(), mediaType: "font/otf" } }, { font: bytes() })
        .valid,
    ).toBe(false);
  });
  it("does not invoke byte carrier getters", () => {
    let reads = 0;
    const carrier = Object.defineProperty({}, "font", {
      enumerable: true,
      get() {
        reads++;
        return bytes();
      },
    });
    expect(snapshotSourceAssets({ font: asset() }, carrier).valid).toBe(false);
    expect(reads).toBe(0);
  });
  it("copies intrinsic bytes without evaluating typed array properties", () => {
    const view = bytes();
    let reads = 0;
    for (const property of [
      "byteLength",
      "length",
      "buffer",
      "byteOffset",
      "slice",
      Symbol.iterator,
    ])
      Object.defineProperty(view, property, {
        get() {
          reads++;
          throw new Error("hostile getter");
        },
      });
    const result = snapshotSourceAssets({ font: asset() }, { font: view });
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("Expected an owned byte snapshot");
    view[0] = 255;
    expect(result.value.bytes.font).toEqual(bytes());
    expect(reads).toBe(0);
  });
  it("rejects shared buffers", () => {
    expect(
      snapshotSourceAssets({ font: asset() }, { font: new Uint8Array(new SharedArrayBuffer(4)) })
        .valid,
    ).toBe(false);
  });
  it("rejects oversized files before allocating an owned copy", () => {
    const view = new Uint8Array(16 * 1024 * 1024 + 1);
    expect(
      snapshotSourceAssets(
        { font: { ...asset(), mediaType: "image/png", encodedSizeBytes: view.length } },
        { font: view },
      ).valid,
    ).toBe(false);
  });
  it("rejects aggregate input over 256 MiB before copying any file", () => {
    const view = new Uint8Array(16 * 1024 * 1024);
    const descriptors = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [
        String(i),
        { ...asset(), id: String(i), mediaType: "image/png", encodedSizeBytes: view.length },
      ]),
    );
    const carrier = Object.fromEntries(Object.keys(descriptors).map((id) => [id, view]));
    const original = Uint8Array.prototype.set;
    let copies = 0;
    Uint8Array.prototype.set = function (...args) {
      copies++;
      return original.apply(this, args);
    };
    try {
      expect(snapshotSourceAssets(descriptors, carrier).valid).toBe(false);
      expect(copies).toBe(0);
    } finally {
      Uint8Array.prototype.set = original;
    }
  });
});

it("rejects an image carrier whose media type does not match its bytes", () => {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );
  const result = snapshotSourceAssets(
    {
      picture: {
        id: "picture",
        mediaType: "image/jpeg",
        checksum: checksumBytes(bytes),
        encodedSizeBytes: bytes.length,
      },
    },
    { picture: bytes },
  );
  expect(result.valid ? [] : result.diagnostics.map(({ code }) => code)).toContain(
    "compiler-invalid-asset",
  );
});
