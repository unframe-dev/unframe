import { describe, expect, it } from "vitest";
import { AuthorArtifactCache } from "@unframe/build";

const assets = (size = 1) =>
  new Map([["image", { bytes: new Uint8Array(size), mediaType: "image/png" }]]);

describe("Author artifact retention", () => {
  it("evicts older image generations while preserving current Dev and Dist", () => {
    const cache = new AuthorArtifactCache(2, 10);
    cache.put("dist", "fixed", assets());
    cache.put("dev", "old", assets());
    cache.put("dev", "current", assets());
    expect(cache.get("dev", "old", "image")).toBeUndefined();
    expect(cache.get("dev", "current", "image")?.bytes).toEqual(new Uint8Array(1));
    expect(cache.get("dist", "fixed", "image")?.bytes).toEqual(new Uint8Array(1));
  });
  it("keeps current images when a replacement exceeds the byte budget", () => {
    const cache = new AuthorArtifactCache(2, 4);
    cache.put("dist", "fixed", assets(2));
    cache.put("dev", "old", assets(2));
    expect(() => cache.put("dev", "oversized", assets(3))).toThrow(RangeError);
    expect(cache.get("dev", "old", "image")?.bytes.byteLength).toBe(2);
    expect(cache.get("dist", "fixed", "image")?.bytes.byteLength).toBe(2);
    expect(cache.get("dev", "oversized", "image")).toBeUndefined();
  });
  it("releases cached bytes on close", () => {
    const cache = new AuthorArtifactCache();
    cache.put("dev", "current", assets());
    cache.clear();
    expect(cache.get("dev", "current", "image")).toBeUndefined();
  });
});
