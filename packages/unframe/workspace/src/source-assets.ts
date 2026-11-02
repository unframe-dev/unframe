import { createHash } from "node:crypto";
import type { ProjectConfig } from "./load-config.js";
import type { LocalFileSnapshot } from "./frozen-local-files.js";
import type { LockedSourceAsset } from "./lock.js";

export type SourceAssetIdentities = { modelTransformIdentity: `sha256:${string}` };

export type SourceAssetsResult =
  | {
      ok: true;
      value: {
        assets: LockedSourceAsset[];
        sourceAssetBytes: Readonly<Record<string, Uint8Array>>;
      };
    }
  | { ok: false; code: string; message: string; path: string };
const failure = (code: string, path: string): SourceAssetsResult => ({
  ok: false,
  code,
  path,
  message: "Source Assets differ from the frozen lock. Refresh the lock explicitly.",
});

export const lockSourceAssets = (
  identities: SourceAssetIdentities,
  sources: ProjectConfig["assets"],
  files: readonly LocalFileSnapshot[],
  videoTransformIdentity?: `sha256:${string}`,
): SourceAssetsResult => {
  const byPath = new Map(files.map((file) => [file.path, file.bytes]));
  const assets: LockedSourceAsset[] = [];
  const entries: [string, Uint8Array][] = [];
  for (const [id, source] of Object.entries(sources).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const bytes = byPath.get(source.path);
    if (!bytes) return failure("cli-source-asset-missing", source.path);
    const transformIdentity =
      source.mediaType === "model/gltf-binary"
        ? identities.modelTransformIdentity
        : source.mediaType === "video/mp4"
          ? videoTransformIdentity
          : undefined;
    if (source.mediaType === "video/mp4" && !transformIdentity)
      return failure("cli-source-asset-transform-unavailable", source.path);
    assets.push({
      id,
      ...source,
      hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      size: bytes.byteLength,
      ...(transformIdentity ? { transformIdentity } : {}),
    });
    entries.push([id, bytes]);
  }
  return { ok: true, value: { assets, sourceAssetBytes: Object.fromEntries(entries) } };
};

export const resolveLockedSourceAssets = (
  identities: SourceAssetIdentities,
  locked: readonly LockedSourceAsset[],
  sources: ProjectConfig["assets"],
  files: readonly LocalFileSnapshot[],
  videoTransformIdentity?: `sha256:${string}`,
): SourceAssetsResult => {
  if (locked.length !== Object.keys(sources).length)
    return failure("cli-source-asset-lock-mismatch", "unframe.config.ts");
  for (const asset of locked) {
    const source = Object.hasOwn(sources, asset.id) ? sources[asset.id] : undefined;
    if (!source || source.path !== asset.path || source.mediaType !== asset.mediaType)
      return failure("cli-source-asset-lock-mismatch", "unframe.config.ts");
  }
  const resolved = lockSourceAssets(identities, sources, files, videoTransformIdentity);
  if (!resolved.ok) return resolved;
  const expected = new Map(locked.map((asset) => [asset.id, asset]));
  for (const actual of resolved.value.assets) {
    const previous = expected.get(actual.id);
    if (actual.hash !== previous?.hash || actual.size !== previous?.size)
      return failure("cli-source-asset-hash-mismatch", actual.path);
    if (actual.transformIdentity !== previous.transformIdentity)
      return failure("cli-source-asset-transform-mismatch", actual.path);
  }
  return resolved;
};
