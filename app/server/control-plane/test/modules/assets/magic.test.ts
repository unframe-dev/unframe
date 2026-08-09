import { describe, expect, it } from "vitest";
import { matchesMagicBytes } from "../../../src/modules/assets/magic";

describe("asset magic bytes", () => {
  it.each([
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], true],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0], true],
    [
      "image/webp",
      [...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBP")],
      true,
    ],
    ["video/mp4", [0, 0, 0, 24, ...new TextEncoder().encode("ftypisom")], true],
    ["audio/mpeg", [...new TextEncoder().encode("ID3"), 4, 0, 0], true],
    ["audio/mpeg", [0xff, 0xfb, 0, 0], true],
    ["model/gltf-binary", [...new TextEncoder().encode("glTF"), 2, 0, 0, 0], true],
    ["image/png", [0xff, 0xd8, 0xff], false],
    [
      "image/webp",
      [...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WAVE")],
      false,
    ],
    ["video/mp4", [0, 0, 0, 24, ...new TextEncoder().encode("freeisom")], false],
    ["audio/mpeg", [0xff, 0xf0], false],
    ["model/gltf-binary", [...new TextEncoder().encode("glTF"), 1, 0, 0, 0], false],
  ] as const)("recognizes %s", (mediaType, bytes, expected) => {
    expect(matchesMagicBytes(mediaType, new Uint8Array(bytes))).toBe(expected);
  });
});
