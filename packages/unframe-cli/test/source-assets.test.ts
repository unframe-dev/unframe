import { expect, it } from "vitest";
import { lockSourceAssets, resolveLockedSourceAssets } from "../src/filesystem/source-assets.js";

const sources = { font: { path: "assets/font.ttf", mediaType: "font/ttf" as const } };
const sourceBytes = Uint8Array.of(0, 1, 0, 0);
const files = [{ path: sources.font.path, bytes: sourceBytes }];

it("freezes Model transform identity and refuses a different transformer without refresh", () => {
  const models = { model: { path: "model.glb", mediaType: "model/gltf-binary" as const } };
  const input = [{ path: "model.glb", bytes: Uint8Array.of(103, 108, 84, 70) }];
  const locked = lockSourceAssets(models, input);
  if (!locked.ok) throw new Error("Expected Model metadata");
  expect(locked.value.assets[0]).toHaveProperty(
    "transformIdentity",
    expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
  );
  const changed = locked.value.assets.map((asset) => ({
    ...asset,
    transformIdentity: `sha256:${"0".repeat(64)}` as const,
  }));
  expect(resolveLockedSourceAssets(changed, models, input)).toMatchObject({
    ok: false,
    code: "cli-source-asset-transform-mismatch",
  });
});

it("locks source metadata and keeps bytes outside the serialized lock", () => {
  const locked = lockSourceAssets(sources, files);
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
  expect(resolveLockedSourceAssets(locked.value.assets, sources, files)).toEqual(locked);
  expect(JSON.stringify(locked.value.assets)).not.toContain("dataBase64");
});

it("requires explicit refresh for changed, missing, or remapped source assets", () => {
  const locked = lockSourceAssets(sources, files);
  if (!locked.ok) throw new Error("fixture could not be locked");
  const resolve = (nextSources = sources, nextFiles = files) =>
    resolveLockedSourceAssets(locked.value.assets, nextSources, nextFiles);
  expect(resolve(sources, [{ ...files[0]!, bytes: Uint8Array.of(0, 1, 0, 1) }])).toMatchObject({
    ok: false,
    code: "cli-source-asset-hash-mismatch",
  });
  expect(resolve(sources, [])).toMatchObject({ ok: false, code: "cli-source-asset-missing" });
  expect(resolve({ font: { ...sources.font, path: "other.ttf" } })).toMatchObject({
    ok: false,
    code: "cli-source-asset-lock-mismatch",
  });
  expect(resolveLockedSourceAssets(locked.value.assets, {}, files)).toMatchObject({
    ok: false,
    code: "cli-source-asset-lock-mismatch",
  });
  expect(resolveLockedSourceAssets([], sources, files)).toMatchObject({
    ok: false,
    code: "cli-source-asset-lock-mismatch",
  });
  expect(
    lockSourceAssets(sources, [{ ...files[0]!, bytes: Uint8Array.of(0, 1, 0, 1) }]),
  ).not.toEqual(locked);
});
