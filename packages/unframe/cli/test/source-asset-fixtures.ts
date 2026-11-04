import { sourceAssetPorts } from "../src/application/media-ports.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lockSourceAssets } from "@unframe-dev/workspace";
import type { DiscoveredProjectFiles } from "@unframe-dev/workspace-node";

export const sourceAssetBytesFor = (discovered: Extract<DiscoveredProjectFiles, { ok: true }>) => {
  const result = lockSourceAssets(sourceAssetPorts, discovered.assetSources, discovered.localFiles);
  if (!result.ok) throw new Error(result.code);
  return result.value.sourceAssetBytes;
};

export const clearSourceAssetRegistration = async (directory: string, entryFile: string) => {
  await writeFile(
    join(directory, "unframe.config.ts"),
    `export default { entryFile: ${JSON.stringify(entryFile)}, assets: {} };\n`,
  );
};
