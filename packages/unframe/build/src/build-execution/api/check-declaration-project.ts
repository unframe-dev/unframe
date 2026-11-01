import { resolvePresentation } from "@unframe/compiler";
import {
  canonicalizePresentationDefinition,
  hashCanonicalJsonPayload,
  hashPresentationDefinition,
} from "@unframe/artifacts";
import type { ValidationResult } from "@unframe/presentation";
import type { CheckedDeclarationProject, CompilerSourceAssetBytes } from "./types.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { snapshotSourceAssets } from "../validation/snapshot-source-assets.js";

export const checkDeclarationProject = (
  input: unknown,
  bytes: CompilerSourceAssetBytes = {},
): ValidationResult<CheckedDeclarationProject> => {
  const snapshot = safePlainClone(input);
  if (!snapshot.valid) return snapshot;
  const resolved = resolvePresentation(snapshot.value);
  if (!resolved.valid) return resolved;
  const project = snapshot.value as { assets: unknown };
  const sourceAssets = snapshotSourceAssets(project.assets, bytes);
  if (!sourceAssets.valid) return sourceAssets;
  const canonical = canonicalizePresentationDefinition(resolved.value);
  if (!canonical.valid) return canonical;
  const definitionHash = hashPresentationDefinition(resolved.value);
  if (!definitionHash.valid) return definitionHash;
  const assets = Object.fromEntries(
    Object.entries(sourceAssets.value.descriptors).map(([id, asset]) => [
      id,
      {
        checksum: asset.checksum as `sha256:${string}`,
        mediaType: asset.mediaType,
        encodedSizeBytes: asset.encodedSizeBytes,
      },
    ]),
  );
  return {
    valid: true,
    value: {
      definition: resolved.value,
      definitionJson: canonical.value,
      definitionHash: definitionHash.value,
      sourceHash: hashCanonicalJsonPayload(snapshot.value),
      assetSet: { schemaVersion: 1, assets },
      warnings: resolved.warnings,
    },
    diagnostics: [],
  };
};
