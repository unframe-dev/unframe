import type { PresentationArtifacts, ValidationResult } from "../domain/model.js";
import { hashPresentationDefinition } from "../canonicalization/artifacts.js";
import { materializeSemanticTree } from "../semantic-tree/materialize.js";
import { normalizedJson } from "../canonicalization/canonical-json.js";
import {
  diagnostic,
  finite,
  id,
  isRecord,
  pathSegment,
  positive,
  recordEntries,
  recordKeys,
  sorted,
} from "./shared.js";
import { validatePresentationDefinition } from "./definition.js";
import { validateRenderBundle } from "./render-bundle.js";
export const validatePresentationArtifacts = (
  definition: unknown,
  renderBundle: unknown,
): ValidationResult<PresentationArtifacts> => {
  const definitionResult = validatePresentationDefinition(definition);
  const bundleResult = validateRenderBundle(renderBundle);
  const diagnostics = [...definitionResult.diagnostics, ...bundleResult.diagnostics];
  if (definitionResult.valid && bundleResult.valid) {
    const expectedHash = hashPresentationDefinition(definitionResult.value);
    if (!expectedHash.valid || bundleResult.value.definitionHash !== expectedHash.value)
      diagnostics.push(
        diagnostic(
          "definition-hash-mismatch",
          "/definitionHash",
          "RenderBundle definitionHash must match the canonical PresentationDefinition hash.",
        ),
      );
    const definitionSurfaces = recordEntries(definitionResult.value.scene.surfaces);
    const definitionSurfaceMap = new Map(definitionSurfaces);
    const bundleSurfaceIds = new Set(
      recordEntries(bundleResult.value.surfaces).map(([key]) => key),
    );
    for (const [surfaceId] of definitionSurfaces)
      if (!bundleSurfaceIds.has(surfaceId))
        diagnostics.push(
          diagnostic(
            "missing-bundle-surface",
            `/scene/surfaces/${pathSegment(surfaceId)}`,
            "Definition surface must have a RenderBundle surface.",
          ),
        );
    for (const [surfaceId, bundleSurface] of recordEntries(bundleResult.value.surfaces)) {
      const definitionSurface = definitionSurfaceMap.get(surfaceId);
      if (definitionSurface === undefined) {
        diagnostics.push(
          diagnostic(
            "missing-definition-surface",
            `/surfaces/${pathSegment(surfaceId)}`,
            "RenderBundle surface does not exist in PresentationDefinition.",
          ),
        );
        continue;
      }
      if (
        JSON.stringify(bundleSurface.logicalSize) !==
          JSON.stringify(definitionSurface.logicalSize) ||
        JSON.stringify(bundleSurface.physicalSizeMeters) !==
          JSON.stringify(definitionSurface.physicalSizeMeters)
      )
        diagnostics.push(
          diagnostic(
            "compiled-surface-size-mismatch",
            `/surfaces/${pathSegment(surfaceId)}`,
            "Compiled surface sizes must match the Definition.",
          ),
        );
      const definitionStates = new Set(recordEntries(definitionSurface.states).map(([key]) => key));
      const requireExactStateSet = (record: unknown, path: string) => {
        const actual = new Set(recordKeys(record));
        if (
          actual.size !== definitionStates.size ||
          [...definitionStates].some((stateId) => !actual.has(stateId))
        )
          diagnostics.push(
            diagnostic(
              "surface-state-set-mismatch",
              path,
              "State records must exactly match the Definition states.",
            ),
          );
      };
      requireExactStateSet(
        bundleSurface.semanticsByState,
        `/surfaces/${pathSegment(surfaceId)}/semanticsByState`,
      );
      requireExactStateSet(
        bundleSurface.interactionsByState,
        `/surfaces/${pathSegment(surfaceId)}/interactionsByState`,
      );
      const interactionIds = new Set(
        recordEntries(definitionSurface.interactions).map(([key]) => key),
      );
      const interactionMap = new Map(recordEntries(definitionSurface.interactions));
      for (const stateId of definitionStates) {
        const state = isRecord(definitionSurface.states)
          ? definitionSurface.states[stateId]
          : undefined;
        const enabledInteractionIds =
          isRecord(state) && Array.isArray(state.enabledInteractionIds)
            ? new Set(state.enabledInteractionIds.filter(id))
            : new Set<string>();
        const semanticTree = isRecord(bundleSurface.semanticsByState)
          ? bundleSurface.semanticsByState[stateId]
          : undefined;
        if (
          isRecord(state) &&
          isRecord(semanticTree) &&
          normalizedJson(materializeSemanticTree(definitionSurface, state)) !==
            normalizedJson(semanticTree)
        )
          diagnostics.push(
            diagnostic(
              "materialized-semantic-tree-mismatch",
              `/surfaces/${pathSegment(surfaceId)}/semanticsByState/${pathSegment(stateId)}`,
              "Bundle semantic tree must equal the Definition state materialization.",
            ),
          );
        const semanticNodes = new Map(
          recordEntries(isRecord(semanticTree) ? semanticTree.nodes : undefined),
        );
        const regions = isRecord(bundleSurface.interactionsByState)
          ? bundleSurface.interactionsByState[stateId]
          : undefined;
        if (!Array.isArray(regions)) continue;
        const coveredInteractionIds = new Set<string>();
        for (const [regionIndex, region] of regions.entries()) {
          if (!isRecord(region)) continue;
          if (
            !id(region.interactionId) ||
            !interactionIds.has(region.interactionId) ||
            !enabledInteractionIds.has(region.interactionId)
          )
            diagnostics.push(
              diagnostic(
                "invalid-hit-region-interaction",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}/${regionIndex}/interactionId`,
                "Hit region must reference an enabled Definition interaction.",
              ),
            );
          if (id(region.interactionId)) coveredInteractionIds.add(region.interactionId);
          const interaction = id(region.interactionId)
            ? interactionMap.get(region.interactionId)
            : undefined;
          if (interaction !== undefined && region.event !== interaction.event)
            diagnostics.push(
              diagnostic(
                "hit-region-event-mismatch",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}/${regionIndex}/event`,
                "Hit region event must match the Definition interaction event.",
              ),
            );
          const semanticNode = id(region.semanticNodeId)
            ? semanticNodes.get(region.semanticNodeId)
            : undefined;
          if (semanticNode === undefined || semanticNode.interactionId !== region.interactionId)
            diagnostics.push(
              diagnostic(
                "invalid-hit-region-semantic-node",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}/${regionIndex}/semanticNodeId`,
                "Hit region must reference its interactive semantic node.",
              ),
            );
          const bounds = region.bounds;
          if (
            !isRecord(bounds) ||
            !finite(bounds.x) ||
            !finite(bounds.y) ||
            !positive(bounds.width) ||
            !positive(bounds.height) ||
            (bounds.x as number) < 0 ||
            (bounds.y as number) < 0 ||
            (bounds.x as number) + (bounds.width as number) > 1 ||
            (bounds.y as number) + (bounds.height as number) > 1
          )
            diagnostics.push(
              diagnostic(
                "invalid-hit-region-bounds",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}/${regionIndex}/bounds`,
                "Normalized hit region bounds must be finite and within [0, 1].",
              ),
            );
        }
        for (const interactionId of [...enabledInteractionIds].sort())
          if (!coveredInteractionIds.has(interactionId))
            diagnostics.push(
              diagnostic(
                "missing-enabled-interaction-region",
                `/surfaces/${pathSegment(surfaceId)}/interactionsByState/${pathSegment(stateId)}`,
                "Every enabled interaction must have at least one hit region.",
              ),
            );
      }
      for (const [renderSurfaceId, renderSurface] of recordEntries(bundleSurface.renderSurfaces)) {
        const bounds = isRecord(renderSurface.logicalBounds)
          ? renderSurface.logicalBounds
          : undefined;
        const logicalSize = Array.isArray(bundleSurface.logicalSize)
          ? bundleSurface.logicalSize
          : [];
        if (
          !finite(bounds?.x) ||
          !finite(bounds?.y) ||
          !positive(bounds?.width) ||
          !positive(bounds?.height) ||
          (bounds.x as number) < 0 ||
          (bounds.y as number) < 0 ||
          !positive(logicalSize[0]) ||
          !positive(logicalSize[1]) ||
          (bounds.x as number) + (bounds.width as number) > logicalSize[0] ||
          (bounds.y as number) + (bounds.height as number) > logicalSize[1]
        )
          diagnostics.push(
            diagnostic(
              "invalid-render-surface-bounds",
              `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/logicalBounds`,
              "RenderSurface bounds must be finite, positive, and inside the SemanticSurface.",
            ),
          );
        requireExactStateSet(
          renderSurface.stateBindings,
          `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/stateBindings`,
        );
        for (const [artifactId, artifact] of recordEntries(renderSurface.artifacts))
          requireExactStateSet(
            artifact.states,
            `/surfaces/${pathSegment(surfaceId)}/renderSurfaces/${pathSegment(renderSurfaceId)}/artifacts/${pathSegment(artifactId)}/states`,
          );
      }
    }
  }
  return diagnostics.length === 0 && definitionResult.valid && bundleResult.valid
    ? {
        valid: true,
        value: {
          definition: definitionResult.value,
          renderBundle: bundleResult.value,
        },
        diagnostics: [],
      }
    : { valid: false, diagnostics: sorted(diagnostics) };
};
