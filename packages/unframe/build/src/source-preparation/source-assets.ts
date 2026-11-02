import type { CompilerSourceAsset } from "@unframe/compiler";
import type { DeclarationProjectAssemblyCarrier } from "./api/types.js";

export const createSourceAssetAssemblyCarrier = (
  carrier: DeclarationProjectAssemblyCarrier,
  assets: readonly {
    id: string;
    mediaType: CompilerSourceAsset["mediaType"];
    hash: string;
    size: number;
  }[],
): DeclarationProjectAssemblyCarrier => ({
  ...carrier,
  assets: Object.fromEntries(
    assets.map((asset) => [
      asset.id,
      {
        id: asset.id,
        mediaType: asset.mediaType,
        checksum: asset.hash,
        encodedSizeBytes: asset.size,
      },
    ]),
  ),
});
