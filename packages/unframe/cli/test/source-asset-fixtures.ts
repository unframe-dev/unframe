import { sourceAssetPorts } from "../src/application/media-ports.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LockedSourceAsset } from "@unframe/workspace";
import { resolveLockedSourceAssets } from "@unframe/workspace";
import type { DiscoveredProjectFiles } from "@unframe/workspace-node";

export const sourceAssetBytesFor = (
  discovered: Extract<DiscoveredProjectFiles, { ok: true }>,
  locked: readonly LockedSourceAsset[],
) => {
  const result = resolveLockedSourceAssets(
    sourceAssetPorts,
    locked,
    discovered.assetSources,
    discovered.localFiles,
  );
  if (!result.ok) throw new Error(result.code);
  return result.value.sourceAssetBytes;
};

export const clearSourceAssetRegistration = async (directory: string, entryFile: string) => {
  await writeFile(
    join(directory, "unframe.config.ts"),
    `export default { entryFile: ${JSON.stringify(entryFile)}, assets: {} };\n`,
  );
};
