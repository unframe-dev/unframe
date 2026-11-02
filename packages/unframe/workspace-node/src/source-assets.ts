import type { LockedSourceAsset } from "@unframe/workspace";
import type { ProjectConfig } from "@unframe/workspace";
import type { LocalFileSnapshot } from "@unframe/workspace";
import {
  lockSourceAssets,
  resolveLockedSourceAssets,
  type SourceAssetIdentities,
  type SourceAssetsResult,
} from "@unframe/workspace";

export type SourceAssetPorts = SourceAssetIdentities & {
  videoTransformIdentity: () => Promise<`sha256:${string}`>;
};

const failure = (code: string, path: string): SourceAssetsResult => ({
  ok: false,
  code,
  path,
  message: "Source Assets differ from the frozen lock. Refresh the lock explicitly.",
});

export const projectVideoTransformIdentity = async (
  ports: SourceAssetPorts,
  sources: ProjectConfig["assets"],
) =>
  Object.values(sources).some((source) => source.mediaType === "video/mp4")
    ? await ports.videoTransformIdentity()
    : undefined;

export const resolveProjectSourceAssets = async (
  ports: SourceAssetPorts,
  locked: readonly LockedSourceAsset[],
  sources: ProjectConfig["assets"],
  files: readonly LocalFileSnapshot[],
): Promise<SourceAssetsResult> => {
  try {
    return resolveLockedSourceAssets(
      ports,
      locked,
      sources,
      files,
      await projectVideoTransformIdentity(ports, sources),
    );
  } catch {
    return failure("cli-source-asset-transform-unavailable", "unframe.lock");
  }
};

export const resolveDevProjectSourceAssets = async (
  ports: SourceAssetPorts,
  sources: ProjectConfig["assets"],
  files: readonly LocalFileSnapshot[],
): Promise<SourceAssetsResult> => {
  try {
    return lockSourceAssets(
      ports,
      sources,
      files,
      await projectVideoTransformIdentity(ports, sources),
    );
  } catch {
    return failure("cli-source-asset-transform-unavailable", "unframe.config.ts");
  }
};
