import { createHash } from "node:crypto";
import type { ProjectConfig } from "./load-config.js";
import type { LocalFileSnapshot } from "./frozen-local-files.js";
import type { LockedSourceAsset } from "./project-inputs.js";

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
  message: "Source Asset bytes or transform identity are unavailable.",
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
