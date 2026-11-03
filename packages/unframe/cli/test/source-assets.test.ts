import { createSourceAssetAssemblyCarrier } from "@unframe-dev/build";
import { lockSourceAssets } from "@unframe-dev/workspace";
import { sourceAssetPorts } from "../src/application/media-ports.js";
import { assert, expect, it } from "vite-plus/test";
import { resolveDevProjectSourceAssets } from "@unframe-dev/workspace-node";

const sources = { font: { path: "assets/font.ttf", mediaType: "font/ttf" as const } };
const assetPorts = {
  ...sourceAssetPorts,
  videoTransformIdentity: async () => `sha256:${"a".repeat(64)}` as const,
};
const sourceBytes = Uint8Array.of(0, 1, 0, 0);
const files = [{ path: sources.font.path, bytes: sourceBytes }];

it("captures changed asset bytes and transform identities into fresh inputs", () => {
  const before = lockSourceAssets(sourceAssetPorts, sources, files);
  const after = lockSourceAssets(sourceAssetPorts, sources, [
    { ...files[0]!, bytes: Uint8Array.of(0, 1, 0, 1) },
  ]);
  assert(before.ok);
  assert(after.ok);
  expect(after.value.assets[0]?.hash).not.toBe(before.value.assets[0]?.hash);
  expect(after.value.sourceAssetBytes.font).toEqual(Uint8Array.of(0, 1, 0, 1));
});
it("rejects a registered asset absent from the captured files", () => {
  expect(lockSourceAssets(sourceAssetPorts, sources, [])).toMatchObject({
    ok: false,
    code: "cli-source-asset-missing",
  });
});

it.each([
  "font/ttf",
  "font/otf",
  "image/png",
  "image/jpeg",
  "model/gltf-binary",
  "video/mp4",
] as const)(
  "assembles current Dev %s metadata without replacing frozen package inputs",
  async (mediaType) => {
    const resolved = await resolveDevProjectSourceAssets(
      assetPorts,
      { current: { path: "assets/current", mediaType } },
      [{ path: "assets/current", bytes: sourceBytes }],
    );
    assert(resolved.ok);
    expect(resolved.value.assets).toEqual([
      expect.objectContaining({
        id: "current",
        mediaType,
        size: 4,
        hash: "sha256:bf5e8ffa51a9e748985800c1d3d7f1a2a6ae7435136593ca8d9637e3f87c699c",
      }),
    ]);
    expect(resolved.value.sourceAssetBytes.current).toEqual(sourceBytes);
    const frozen = { themeHashes: [], componentLocks: [], assets: {} };
    const carrier = createSourceAssetAssemblyCarrier(frozen, resolved.value.assets);
    expect(carrier.assets.current).toEqual({
      id: "current",
      mediaType,
      encodedSizeBytes: 4,
      checksum: "sha256:bf5e8ffa51a9e748985800c1d3d7f1a2a6ae7435136593ca8d9637e3f87c699c",
    });
    expect(carrier.componentLocks).toBe(frozen.componentLocks);
    expect(carrier.themeHashes).toBe(frozen.themeHashes);
    expect(frozen.assets).toEqual({});
  },
);

it.each(["model/gltf-binary", "video/mp4"] as const)(
  "captures the current %s transform identity for Dev",
  async (mediaType) => {
    const resolved = await resolveDevProjectSourceAssets(
      assetPorts,
      { current: { path: "assets/current", mediaType } },
      [{ path: "assets/current", bytes: sourceBytes }],
    );
    assert(resolved.ok);
    expect(resolved.value.assets[0]?.transformIdentity).toMatch(/^sha256:[0-9a-f]{64}$/u);
  },
);
