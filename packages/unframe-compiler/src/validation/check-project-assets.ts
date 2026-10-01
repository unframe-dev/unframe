import type { PresentationDeclaration } from "@unframe/unframe-authoring";
import type { BuildArtifactsV2, Diagnostic, PresentationDefinition } from "@unframe/unframe-core";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { isRecord, nonEmptyString } from "../lowering/support.js";
import { checksumBytes, decodeCanonicalBase64, hasValidFontSignature } from "./source-assets.js";
import type { CompilerDeclarationProject } from "../api/types.js";

export const checkProjectAssets = (
  assetReferences: PresentationDeclaration["assets"],
  assets: CompilerDeclarationProject["assets"],
  surfaces: PresentationDefinition["scene"]["surfaces"],
): { assetSetAssets: BuildArtifactsV2["assetSet"]["assets"]; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  if (assetReferences.some((asset) => !Object.hasOwn(assets, asset.assetId)))
    diagnostics.push(
      diagnostic(
        "compiler-asset-not-found",
        ["presentation", "assets"],
        "Asset references must resolve.",
      ),
    );
  const referencedAssetIds = new Set(assetReferences.map((asset) => asset.assetId));
  const referencedFontIds = new Set<string>();
  for (const surface of Object.values(surfaces))
    for (const node of Object.values(
      surface.content.kind === "structured" ? surface.content.nodes : {},
    ))
      if (node.kind === "text") {
        referencedFontIds.add(node.style.fontAssetId);
        for (const fontAssetId of node.style.fallbackFontAssetIds)
          referencedFontIds.add(fontAssetId);
      }
  for (const surface of Object.values(surfaces))
    for (const state of Object.values(surface.states))
      for (const override of Object.values(state.contentOverrides))
        if (override.kind === "text" && override.style) {
          referencedFontIds.add(override.style.fontAssetId);
          for (const fontAssetId of override.style.fallbackFontAssetIds)
            referencedFontIds.add(fontAssetId);
        }
  for (const fontAssetId of referencedFontIds)
    if (!referencedAssetIds.has(fontAssetId))
      diagnostics.push(
        diagnostic(
          "compiler-font-asset-not-declared",
          ["presentation", "assets"],
          "Every resolved Text font must be declared by the Presentation.",
        ),
      );
  for (const assetId of referencedAssetIds)
    if (!referencedFontIds.has(assetId))
      diagnostics.push(
        diagnostic(
          "compiler-asset-unreferenced",
          ["presentation", "assets", assetId],
          "Every declared source Asset must be referenced by resolved content.",
        ),
      );
  const assetSetAssets: BuildArtifactsV2["assetSet"]["assets"] = {};
  for (const [assetId, asset] of Object.entries(assets)) {
    const validShape =
      isRecord(asset) &&
      Object.keys(asset).every((key) =>
        ["id", "mediaType", "checksum", "encodedSizeBytes", "dataBase64"].includes(key),
      ) &&
      Object.keys(asset).length === 5 &&
      asset.id === assetId &&
      (asset.mediaType === "font/ttf" || asset.mediaType === "font/otf") &&
      nonEmptyString(asset.checksum) &&
      Number.isSafeInteger(asset.encodedSizeBytes) &&
      (asset.encodedSizeBytes as number) >= 0 &&
      typeof asset.dataBase64 === "string";
    const bytes = validShape ? decodeCanonicalBase64(asset.dataBase64 as string) : undefined;
    if (
      !validShape ||
      bytes === undefined ||
      bytes.length !== asset.encodedSizeBytes ||
      checksumBytes(bytes) !== asset.checksum ||
      !hasValidFontSignature(bytes, asset.mediaType as string)
    )
      diagnostics.push(
        diagnostic(
          "compiler-invalid-asset",
          ["assets", assetId],
          "Asset descriptors must match their key and portable contract shape.",
        ),
      );
    else
      assetSetAssets[assetId] = {
        checksum: asset.checksum as `sha256:${string}`,
        mediaType: asset.mediaType as "font/ttf" | "font/otf",
        encodedSizeBytes: asset.encodedSizeBytes as number,
      };
    if (!referencedAssetIds.has(assetId))
      diagnostics.push(
        diagnostic(
          "compiler-asset-unreferenced",
          ["assets", assetId],
          "Asset carrier entries must be referenced by the presentation.",
        ),
      );
  }
  return { assetSetAssets, diagnostics };
};
