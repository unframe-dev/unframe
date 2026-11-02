import { expect, it } from "vitest";
import { readCachedBuild } from "../../src/build-execution/cache/build-cache.js";

const expected = {
  environmentHash: "sha256:environment",
  compilerName: "unframe",
  compilerVersion: "1",
  locale: "ja-JP",
  timezone: "Asia/Tokyo",
  colorScheme: "dark" as const,
  themeId: "theme",
  themeHash: "sha256:theme",
  textureBuildPolicyHash: "sha256:policy",
};

it.each(["metadata", "asset-map"])(
  "treats a cache %s accessor as a miss without evaluating it",
  async (location) => {
    let reads = 0;
    const descriptor = {
      enumerable: true,
      get: () => {
        reads++;
        throw new Error("secret");
      },
    };
    const metadata = location === "metadata" ? Object.defineProperty({}, "secret", descriptor) : {};
    const bytes = Uint8Array.of(1, 2);
    const assets =
      location === "asset-map" ? Object.defineProperty({}, "asset", descriptor) : { asset: bytes };
    const result = await readCachedBuild(
      { get: () => ({ definition: metadata, assets }), set: () => {} },
      "key",
      {} as never,
      expected,
    );
    expect(result).toBeUndefined();
    expect(reads).toBe(0);
  },
);
