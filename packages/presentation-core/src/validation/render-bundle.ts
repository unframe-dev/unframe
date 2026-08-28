import type { SerializedRenderBundleV1 } from "@unframe/contracts/presentation";
import type { Diagnostic, ValidationResult } from "../domain/model.js";
import {
  diagnostic,
  id,
  isRecord,
  pathSegment,
  recordEntries,
  sorted,
  structuralDiagnostic,
  validateRecordIds,
  validateReferences,
  validateTree,
  validateVector,
} from "./shared.js";
import { parseRenderBundleInput } from "./contract-input.js";
export const validateRenderBundle = (
  input: unknown,
): ValidationResult<SerializedRenderBundleV1> => {
  const parsed = parseRenderBundleInput(input);
  if (!parsed.success && parsed.snapshot === undefined)
    return {
      valid: false,
      diagnostics: sorted(
        parsed.issues.map((issue) => structuralDiagnostic("render-bundle", issue)),
      ),
    };
  input = parsed.success ? parsed.data : parsed.snapshot;
  const diagnostics: Diagnostic[] = parsed.success
    ? []
    : parsed.issues.map((issue) => structuralDiagnostic("render-bundle", issue));
  if (!isRecord(input) || !isRecord(input.surfaces))
    return {
      valid: false,
      diagnostics: [diagnostic("invalid-render-bundle", "", "RenderBundle must contain surfaces.")],
    };
  const renderSurfacePaths = new Map<string, string>();
  const artifactPaths = new Map<string, string>();
  validateRecordIds(diagnostics, input.surfaces, "/surfaces", "semanticSurfaceId");
  for (const [surfaceId, surface] of recordEntries(input.surfaces)) {
    validateVector(
      diagnostics,
      surface.logicalSize,
      2,
      `/surfaces/${pathSegment(surfaceId)}/logicalSize`,
      true,
    );
    validateVector(
      diagnostics,
      surface.physicalSizeMeters,
      2,
      `/surfaces/${pathSegment(surfaceId)}/physicalSizeMeters`,
      true,
    );
    for (const [stateId, semanticTree] of recordEntries(surface.semanticsByState))
      validateTree(
        diagnostics,
        semanticTree.nodes,
        semanticTree.rootNodeIds,
        `/surfaces/${pathSegment(surfaceId)}/semanticsByState/${pathSegment(stateId)}`,
      );
    validateRecordIds(
      diagnostics,
      surface.renderSurfaces,
      `/surfaces/${pathSegment(surfaceId)}/renderSurfaces`,
    );
    const renderSurfaceIds = new Set(recordEntries(surface.renderSurfaces).map(([key]) => key));
    const declaredRenderSurfaceIds = Array.isArray(surface.renderSurfaceIds)
      ? surface.renderSurfaceIds.filter(id)
      : [];
    validateReferences(
      diagnostics,
      declaredRenderSurfaceIds,
      renderSurfaceIds,
      `/surfaces/${pathSegment(surfaceId)}/renderSurfaceIds`,
      "missing-render-surface",
    );
    if (
      declaredRenderSurfaceIds.length !== renderSurfaceIds.size ||
      new Set(declaredRenderSurfaceIds).size !== renderSurfaceIds.size
    )
      diagnostics.push(
        diagnostic(
          "render-surface-set-mismatch",
          `/surfaces/${pathSegment(surfaceId)}/renderSurfaceIds`,
          "renderSurfaceIds must contain each render surface exactly once.",
        ),
      );
    for (const [renderSurfaceId, renderSurface] of recordEntries(surface.renderSurfaces)) {
      const renderSurfacePath = `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}`;
      const previousRenderSurfacePath = renderSurfacePaths.get(renderSurfaceId);
      if (previousRenderSurfacePath !== undefined)
        diagnostics.push(
          diagnostic(
            "duplicate-render-surface-id",
            renderSurfacePath,
            "RenderSurface IDs must be globally unique within a RenderBundle.",
            previousRenderSurfacePath,
          ),
        );
      else renderSurfacePaths.set(renderSurfaceId, renderSurfacePath);
      if (renderSurface.semanticSurfaceId !== surfaceId)
        diagnostics.push(
          diagnostic(
            "render-surface-semantic-surface-mismatch",
            `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/semanticSurfaceId`,
            "RenderSurface must belong to its enclosing SemanticSurface.",
          ),
        );
      validateRecordIds(
        diagnostics,
        renderSurface.artifacts,
        `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/artifacts`,
      );
      const artifactIds = new Set(recordEntries(renderSurface.artifacts).map(([key]) => key));
      for (const [stateId, binding] of recordEntries(renderSurface.stateBindings)) {
        if (binding.kind === "artifacts")
          validateReferences(
            diagnostics,
            Array.isArray(binding.artifactIds) ? binding.artifactIds.filter(id) : [],
            artifactIds,
            `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/stateBindings/${pathSegment(stateId)}/artifactIds`,
            "missing-artifact",
          );
      }
      for (const [artifactId, artifact] of recordEntries(renderSurface.artifacts)) {
        const artifactPath = `${renderSurfacePath}/artifacts/${pathSegment(artifactId)}`;
        const previousArtifactPath = artifactPaths.get(artifactId);
        if (previousArtifactPath !== undefined)
          diagnostics.push(
            diagnostic(
              "duplicate-renderer-artifact-id",
              artifactPath,
              "Renderer artifact IDs must be globally unique within a RenderBundle.",
              previousArtifactPath,
            ),
          );
        else artifactPaths.set(artifactId, artifactPath);
        validateRecordIds(
          diagnostics,
          artifact.states,
          `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/artifacts/${pathSegment(artifactId)}/states`,
          "stateId",
        );
        for (const [stateId, state] of recordEntries(artifact.states))
          for (const [textureIndex, texture] of (Array.isArray(state.textures)
            ? state.textures
            : []
          ).entries())
            validateVector(
              diagnostics,
              isRecord(texture) ? texture.pixelSize : undefined,
              2,
              `${artifactPath}/states/${pathSegment(stateId)}/textures/${textureIndex}/pixelSize`,
              true,
            );
      }
    }
  }
  return diagnostics.length === 0
    ? {
        valid: true,
        value: input as unknown as SerializedRenderBundleV1,
        diagnostics: [],
      }
    : { valid: false, diagnostics: sorted(diagnostics) };
};
