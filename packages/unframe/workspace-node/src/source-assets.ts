import type { ProjectConfig } from "@unframe-dev/workspace";
import type { LocalFileSnapshot } from "@unframe-dev/workspace";
import {
  lockSourceAssets,
  type SourceAssetIdentities,
  type SourceAssetsResult,
} from "@unframe-dev/workspace";

export type SourceAssetPorts = SourceAssetIdentities & {
  videoTransformIdentity: () => Promise<`sha256:${string}`>;
};

const failure = (code: string, path: string): SourceAssetsResult => ({
  ok: false,
  code,
  path,
  message: "Source Assets could not be prepared.",
});

export const projectVideoTransformIdentity = async (
  ports: SourceAssetPorts,
  sources: ProjectConfig["assets"],
) =>
  Object.values(sources).some((source) => source.mediaType === "video/mp4")
    ? await ports.videoTransformIdentity()
    : undefined;

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
