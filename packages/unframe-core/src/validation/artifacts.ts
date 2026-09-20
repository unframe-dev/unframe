import type { PresentationArtifacts, ValidationResult } from "../domain/model.js";
import { hashPresentationDefinition } from "../canonicalization/artifacts.js";
import { canonicalizeJsonPayload } from "../canonicalization/payload.js";
import { materializeCompletedSemanticTree } from "../semantic-tree/materialize.js";
import { diagnostic, pathSegment, sorted } from "./shared.js";
import { validatePresentationDefinition } from "./definition.js";
import { validateRenderBundle } from "./render-bundle.js";

const sameSet = (left: Iterable<string>, right: Iterable<string>) => {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((item) => b.has(item));
};

export const validatePresentationArtifacts = (
  definition: unknown,
  renderBundle: unknown,
): ValidationResult<PresentationArtifacts> => {
  const definitionResult = validatePresentationDefinition(definition);
  const bundleResult = validateRenderBundle(renderBundle);
  const diagnostics = [...definitionResult.diagnostics, ...bundleResult.diagnostics];
  if (!definitionResult.valid || !bundleResult.valid)
    return { valid: false, diagnostics: sorted(diagnostics) };

  const expectedHash = hashPresentationDefinition(definitionResult.value);
  if (!expectedHash.valid || bundleResult.value.definitionHash !== expectedHash.value)
    diagnostics.push(
      diagnostic(
        "hash.invalid",
        "/definitionHash",
        "RenderBundle definitionHash must match the canonical PresentationDefinition hash.",
      ),
    );

  const definitionSurfaces = definitionResult.value.scene.surfaces;
  const bundleSurfaces = bundleResult.value.surfaces;
  if (!sameSet(Object.keys(definitionSurfaces), Object.keys(bundleSurfaces)))
    diagnostics.push(
      diagnostic(
        "artifact.invalid",
        "/surfaces",
        "Definition and RenderBundle must contain the same SemanticSurface set.",
      ),
    );

  for (const [surfaceId, definitionSurface] of Object.entries(definitionSurfaces)) {
    const bundleSurface = bundleSurfaces[surfaceId];
    if (bundleSurface === undefined) continue;
    const path = `/surfaces/${pathSegment(surfaceId)}`;
    if (
      canonicalizeJsonPayload(bundleSurface.logicalSize) !==
        canonicalizeJsonPayload(definitionSurface.logicalSize) ||
      canonicalizeJsonPayload(bundleSurface.physicalSizeMeters) !==
        canonicalizeJsonPayload(definitionSurface.physicalSizeMeters)
    )
      diagnostics.push(
        diagnostic("artifact.invalid", path, "Compiled surface sizes must match the Definition."),
      );
    const stateIds = Object.keys(definitionSurface.states);
    if (
      !sameSet(stateIds, Object.keys(bundleSurface.semanticsByState)) ||
      !sameSet(stateIds, Object.keys(bundleSurface.interactionsByState))
    )
      diagnostics.push(
        diagnostic(
          "artifact.invalid",
          `${path}/semanticsByState`,
          "Compiled State records must exactly match the Definition State set.",
        ),
      );
    for (const stateId of stateIds) {
      const materialized = materializeCompletedSemanticTree(definitionSurface, stateId);
      const actual = bundleSurface.semanticsByState[stateId];
      if (
        !materialized.valid ||
        actual === undefined ||
        canonicalizeJsonPayload(materialized.value) !== canonicalizeJsonPayload(actual)
      )
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            `${path}/semanticsByState/${pathSegment(stateId)}`,
            "Bundle semantic tree must equal the materialized Definition State.",
          ),
        );
    }
  }

  return diagnostics.length === 0
    ? {
        valid: true,
        value: { definition: definitionResult.value, renderBundle: bundleResult.value },
        diagnostics: [],
      }
    : { valid: false, diagnostics: sorted(diagnostics) };
};
