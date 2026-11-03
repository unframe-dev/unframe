import type { PresentationDeclaration } from "@unframe-dev/authoring";
import type { BuildArtifacts } from "@unframe-dev/artifacts";
import type { Diagnostic, PresentationDefinition } from "@unframe-dev/presentation";
import { diagnostic } from "../diagnostics/diagnostics.js";
import { isRecord } from "../lowering/support.js";
import type { CompilerDeclarationProject } from "../api/types.js";

export const checkProjectAssetReferences = (
  assetReferences: PresentationDeclaration["assets"],
  assets: CompilerDeclarationProject["assets"],
  surfaces: PresentationDefinition["scene"]["surfaces"],
  nodes: PresentationDefinition["scene"]["nodes"] = {},
): { assetSetAssets: BuildArtifacts["assetSet"]["assets"]; diagnostics: Diagnostic[] } => {
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
  const referencedImageIds = new Set<string>();
  const referencedVideoIds = new Set<string>();
  const referencedModelIds = new Set(
    Object.values(nodes).flatMap((node) => (node.kind === "model" ? [node.assetId] : [])),
  );
  for (const id of referencedModelIds)
    if (!referencedAssetIds.has(id))
      diagnostics.push(
        diagnostic(
          "compiler-model-asset-not-declared",
          ["presentation", "assets", id],
          "Every Model source must be declared by the Presentation.",
        ),
      );
  for (const surface of Object.values(surfaces))
    for (const node of Object.values(
      surface.content.kind === "structured" ? surface.content.nodes : {},
    ))
      if (node.kind === "text") {
        referencedFontIds.add(node.style.fontAssetId);
        for (const fontAssetId of node.style.fallbackFontAssetIds)
          referencedFontIds.add(fontAssetId);
      } else if (node.kind === "image") referencedImageIds.add(node.assetId);
      else if (node.kind === "video") referencedVideoIds.add(node.assetId);
  for (const surface of Object.values(surfaces))
    for (const state of Object.values(surface.states))
      for (const override of Object.values(state.contentOverrides))
        if (override.kind === "text" && override.style) {
          referencedFontIds.add(override.style.fontAssetId);
          for (const fontAssetId of override.style.fallbackFontAssetIds)
            referencedFontIds.add(fontAssetId);
        } else if (override.kind === "image" && override.assetId)
          referencedImageIds.add(override.assetId);
  for (const id of referencedVideoIds)
    if (!referencedAssetIds.has(id))
      diagnostics.push(
        diagnostic(
          "compiler-video-asset-not-declared",
          ["presentation", "assets", id],
          "Every Video source must be declared.",
        ),
      );
  for (const fontAssetId of referencedFontIds)
    if (!referencedAssetIds.has(fontAssetId))
      diagnostics.push(
        diagnostic(
          "compiler-font-asset-not-declared",
          ["presentation", "assets"],
          "Every resolved Text font must be declared by the Presentation.",
        ),
      );
  for (const imageAssetId of referencedImageIds)
    if (!referencedAssetIds.has(imageAssetId))
      diagnostics.push(
        diagnostic(
          "compiler-image-asset-not-declared",
          ["presentation", "assets"],
          "Every resolved Image source must be declared by the Presentation.",
        ),
      );
  for (const assetId of referencedAssetIds)
    if (
      !referencedFontIds.has(assetId) &&
      !referencedImageIds.has(assetId) &&
      !referencedModelIds.has(assetId) &&
      !referencedVideoIds.has(assetId)
    )
      diagnostics.push(
        diagnostic(
          "compiler-asset-unreferenced",
          ["presentation", "assets", assetId],
          `Asset '${assetId}' is declared in presentation.assets but no resolved content uses it. Reference it from a Text, Image, Video or Model, or remove it from presentation.assets and the asset catalog.`,
        ),
      );
  const assetSetAssets: BuildArtifacts["assetSet"]["assets"] = {};
  for (const [assetId, asset] of Object.entries(assets)) {
    assetSetAssets[assetId] = {
      checksum: asset.checksum as `sha256:${string}`,
      mediaType: asset.mediaType,
      encodedSizeBytes: asset.encodedSizeBytes,
    };
    if (!referencedAssetIds.has(assetId))
      diagnostics.push(
        diagnostic(
          "compiler-asset-unreferenced",
          ["assets", assetId],
          `Asset '${assetId}' is in the asset catalog but is not declared in presentation.assets. Add its assetRef to presentation.assets and reference it from content, or remove it from the asset catalog.`,
        ),
      );
    if (
      isRecord(asset) &&
      ((referencedFontIds.has(assetId) &&
        asset.mediaType !== "font/ttf" &&
        asset.mediaType !== "font/otf") ||
        (referencedModelIds.has(assetId) && asset.mediaType !== "model/gltf-binary") ||
        (referencedVideoIds.has(assetId) && asset.mediaType !== "video/mp4") ||
        (referencedImageIds.has(assetId) &&
          asset.mediaType !== "image/png" &&
          asset.mediaType !== "image/jpeg"))
    )
      diagnostics.push(
        diagnostic(
          "compiler-asset-media-type-mismatch",
          ["assets", assetId, "mediaType"],
          "Asset media type must match its resolved content use.",
        ),
      );
  }
  return { assetSetAssets, diagnostics };
};
