import { createSourceAssetAssemblyCarrier } from "@unframe/build";
import { lockSourceAssets, resolveLockedSourceAssets } from "@unframe/workspace";
import { sourceAssetPorts } from "../src/application/media-ports.js";
import { assert, expect, it } from "vitest";
import { resolveDevProjectSourceAssets } from "@unframe/workspace-node";

const sources = { font: { path: "assets/font.ttf", mediaType: "font/ttf" as const } };
const sourceBytes = Uint8Array.of(0, 1, 0, 0);
const files = [{ path: sources.font.path, bytes: sourceBytes }];

it("freezes Model transform identity and refuses a different transformer without refresh", () => {
  const models = { model: { path: "model.glb", mediaType: "model/gltf-binary" as const } };
  const input = [{ path: "model.glb", bytes: Uint8Array.of(103, 108, 84, 70) }];
  const locked = lockSourceAssets(sourceAssetPorts, models, input);
  if (!locked.ok) throw new Error("Expected Model metadata");
  expect(locked.value.assets[0]).toHaveProperty(
    "transformIdentity",
    expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
  );
  const changed = locked.value.assets.map((asset) => ({
    ...asset,
    transformIdentity: `sha256:${"0".repeat(64)}` as const,
  }));
  expect(resolveLockedSourceAssets(sourceAssetPorts, changed, models, input)).toMatchObject({
    ok: false,
    code: "cli-source-asset-transform-mismatch",
  });
});

it("locks source metadata and keeps bytes outside the serialized lock", () => {
  const locked = lockSourceAssets(sourceAssetPorts, sources, files);
  expect(locked.ok).toBe(true);
  if (!locked.ok) return;
  expect(locked.value.assets).toEqual([
    {
      id: "font",
      path: "assets/font.ttf",
      mediaType: "font/ttf",
      size: 4,
      hash: "sha256:bf5e8ffa51a9e748985800c1d3d7f1a2a6ae7435136593ca8d9637e3f87c699c",
    },
  ]);
  expect(locked.value.sourceAssetBytes.font).toEqual(sourceBytes);
  expect(resolveLockedSourceAssets(sourceAssetPorts, locked.value.assets, sources, files)).toEqual(
    locked,
  );
  expect(JSON.stringify(locked.value.assets)).not.toContain("dataBase64");
});

it("requires explicit refresh for changed, missing, or remapped source assets", () => {
  const locked = lockSourceAssets(sourceAssetPorts, sources, files);
  if (!locked.ok) throw new Error("fixture could not be locked");
  const resolve = (nextSources = sources, nextFiles = files) =>
    resolveLockedSourceAssets(sourceAssetPorts, locked.value.assets, nextSources, nextFiles);
  expect(resolve(sources, [{ ...files[0]!, bytes: Uint8Array.of(0, 1, 0, 1) }])).toMatchObject({
    ok: false,
    code: "cli-source-asset-hash-mismatch",
  });
  expect(resolve(sources, [])).toMatchObject({ ok: false, code: "cli-source-asset-missing" });
  expect(resolve({ font: { ...sources.font, path: "other.ttf" } })).toMatchObject({
    ok: false,
    code: "cli-source-asset-lock-mismatch",
  });
  expect(resolveLockedSourceAssets(sourceAssetPorts, locked.value.assets, {}, files)).toMatchObject(
    {
      ok: false,
      code: "cli-source-asset-lock-mismatch",
    },
  );
  expect(resolveLockedSourceAssets(sourceAssetPorts, [], sources, files)).toMatchObject({
    ok: false,
    code: "cli-source-asset-lock-mismatch",
  });
  expect(
    lockSourceAssets(sourceAssetPorts, sources, [
      { ...files[0]!, bytes: Uint8Array.of(0, 1, 0, 1) },
    ]),
  ).not.toEqual(locked);
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
      sourceAssetPorts,
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
      sourceAssetPorts,
      { current: { path: "assets/current", mediaType } },
      [{ path: "assets/current", bytes: sourceBytes }],
    );
    assert(resolved.ok);
    expect(resolved.value.assets[0]?.transformIdentity).toMatch(/^sha256:[0-9a-f]{64}$/u);
  },
);
