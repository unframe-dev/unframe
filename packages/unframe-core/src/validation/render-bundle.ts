import type { RenderBundleV2 } from "@unframe/contracts/presentation/v2";

import type { Diagnostic, ValidationResult } from "../domain/model.js";
import { hashCanonicalJsonPayload } from "../canonicalization/payload.js";
import { parseRenderBundleInput } from "./contract-input.js";
import {
  diagnostic,
  pathSegment,
  sorted,
  structuralDiagnostic,
  validateRecordIds,
  validateTree,
} from "./shared.js";

const equalSet = (left: Iterable<string>, right: Iterable<string>) => {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((item) => b.has(item));
};

export const validateRenderBundle = (input: unknown): ValidationResult<RenderBundleV2> => {
  const parsed = parseRenderBundleInput(input);
  if (!parsed.success)
    return {
      valid: false,
      diagnostics: sorted(
        parsed.issues.map((issue) => structuralDiagnostic("render-bundle", issue)),
      ),
    };

  const bundle = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const policy = bundle.buildContext.textureBuildPolicy;
  const { policyHash, ...policyPayload } = policy;
  if (hashCanonicalJsonPayload(policyPayload) !== policyHash)
    diagnostics.push(
      diagnostic(
        "hash.invalid",
        "/buildContext/textureBuildPolicy/policyHash",
        "Texture policy hash must match its JCS payload excluding policyHash.",
      ),
    );
  validateRecordIds(diagnostics, bundle.surfaces, "/surfaces", "semanticSurfaceId");
  validateRecordIds(diagnostics, bundle.models, "/models", "assetId");
  if (Object.keys(bundle.models).length > 0)
    diagnostics.push(
      diagnostic("feature.unsupported", "/models", "Native 3D artifacts are deferred beyond M3A."),
    );

  const globalRenderSurfaceIds = new Map<string, string>();
  const globalArtifactIds = new Map<string, string>();
  for (const [surfaceId, surface] of Object.entries(bundle.surfaces)) {
    const path = `/surfaces/${pathSegment(surfaceId)}`;
    validateRecordIds(diagnostics, surface.renderSurfaces, `${path}/renderSurfaces`);
    if (
      !equalSet(surface.renderSurfaceIds, Object.keys(surface.renderSurfaces)) ||
      new Set(surface.renderSurfaceIds).size !== surface.renderSurfaceIds.length
    )
      diagnostics.push(
        diagnostic(
          "identity.invalid",
          `${path}/renderSurfaceIds`,
          "renderSurfaceIds must list every RenderSurface exactly once.",
        ),
      );
    if (surface.renderSurfaceIds.length !== 1)
      diagnostics.push(
        diagnostic(
          "feature.unsupported",
          `${path}/renderSurfaceIds`,
          "M3A accepts one full-size RenderSurface per SemanticSurface.",
        ),
      );

    const stateIds = Object.keys(surface.semanticsByState);
    if (!equalSet(stateIds, Object.keys(surface.interactionsByState)))
      diagnostics.push(
        diagnostic(
          "artifact.invalid",
          `${path}/interactionsByState`,
          "Semantic and interaction State sets must match.",
        ),
      );
    for (const [stateId, tree] of Object.entries(surface.semanticsByState))
      validateTree(
        diagnostics,
        tree.nodes,
        tree.rootNodeIds,
        `${path}/semanticsByState/${pathSegment(stateId)}`,
      );
    for (const [stateId, regions] of Object.entries(surface.interactionsByState))
      if (regions.length > 0)
        diagnostics.push(
          diagnostic(
            "feature.unsupported",
            `${path}/interactionsByState/${pathSegment(stateId)}`,
            "Hit Regions are deferred to M3B.",
          ),
        );

    for (const [renderSurfaceId, renderSurface] of Object.entries(surface.renderSurfaces)) {
      const renderPath = `${path}/renderSurfaces/${pathSegment(renderSurfaceId)}`;
      const previousRender = globalRenderSurfaceIds.get(renderSurfaceId);
      if (previousRender !== undefined)
        diagnostics.push(
          diagnostic(
            "identity.invalid",
            renderPath,
            "RenderSurface IDs must be globally unique within a bundle.",
            previousRender,
          ),
        );
      else globalRenderSurfaceIds.set(renderSurfaceId, renderPath);
      if (renderSurface.semanticSurfaceId !== surfaceId)
        diagnostics.push(
          diagnostic(
            "identity.invalid",
            `${renderPath}/semanticSurfaceId`,
            "RenderSurface must name its enclosing SemanticSurface.",
          ),
        );
      if (
        renderSurface.logicalBounds.x !== 0 ||
        renderSurface.logicalBounds.y !== 0 ||
        renderSurface.logicalBounds.width !== surface.logicalSize[0] ||
        renderSurface.logicalBounds.height !== surface.logicalSize[1] ||
        renderSurface.layer !== 0
      )
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            `${renderPath}/logicalBounds`,
            "M3A RenderSurface must cover the complete logical surface at layer zero.",
          ),
        );
      if (!equalSet(stateIds, Object.keys(renderSurface.stateBindings)))
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            `${renderPath}/stateBindings`,
            "RenderSurface bindings must cover every State exactly once.",
          ),
        );
      validateRecordIds(diagnostics, renderSurface.artifacts, `${renderPath}/artifacts`);
      const artifacts = renderSurface.artifacts;
      for (const [artifactId, artifact] of Object.entries(artifacts)) {
        const artifactPath = `${renderPath}/artifacts/${pathSegment(artifactId)}`;
        const previousArtifact = globalArtifactIds.get(artifactId);
        if (previousArtifact !== undefined)
          diagnostics.push(
            diagnostic(
              "identity.invalid",
              artifactPath,
              "Renderer artifact IDs must be globally unique within a bundle.",
              previousArtifact,
            ),
          );
        else globalArtifactIds.set(artifactId, artifactPath);
        if (artifact.kind !== "baked-web") {
          diagnostics.push(
            diagnostic(
              "feature.unsupported",
              `${artifactPath}/kind`,
              "M3A accepts baked-web artifacts only.",
            ),
          );
          continue;
        }
        if (!equalSet(stateIds, Object.keys(artifact.states)))
          diagnostics.push(
            diagnostic(
              "artifact.invalid",
              `${artifactPath}/states`,
              "A baked-web artifact must contain one texture for every State.",
            ),
          );
        for (const [stateId, state] of Object.entries(artifact.states)) {
          const statePath = `${artifactPath}/states/${pathSegment(stateId)}`;
          if (state.stateId !== stateId)
            diagnostics.push(
              diagnostic(
                "identity.invalid",
                `${statePath}/stateId`,
                "State key must match stateId.",
              ),
            );
          const expectedFeatures = new Set([`alpha-${state.texture.alphaMode}`, "png", "srgb"]);
          if (
            !equalSet(artifact.requiredFeatures, expectedFeatures) ||
            new Set(artifact.requiredFeatures).size !== artifact.requiredFeatures.length
          )
            diagnostics.push(
              diagnostic(
                "artifact.invalid",
                `${artifactPath}/requiredFeatures`,
                "Baked feature declarations must exactly describe the texture.",
              ),
            );
          const expectedGpuBytes = state.texture.pixelSize[0] * state.texture.pixelSize[1] * 4;
          if (state.texture.gpuBytes !== expectedGpuBytes)
            diagnostics.push(
              diagnostic(
                "artifact.invalid",
                `${statePath}/texture/gpuBytes`,
                "RGBA8 texture GPU bytes must equal width times height times four.",
              ),
            );
        }
      }
      for (const [stateId, binding] of Object.entries(renderSurface.stateBindings)) {
        const bindingPath = `${renderPath}/stateBindings/${pathSegment(stateId)}`;
        if (binding.kind !== "artifacts" || binding.artifactIds.length !== 1)
          diagnostics.push(
            diagnostic(
              "artifact.invalid",
              bindingPath,
              "M3A requires one baked-web artifact binding per State.",
            ),
          );
        else {
          const artifact = artifacts[binding.artifactIds[0]!];
          if (artifact?.kind !== "baked-web" || !Object.hasOwn(artifact.states, stateId))
            diagnostics.push(
              diagnostic(
                "reference.invalid",
                `${bindingPath}/artifactIds/0`,
                "State binding must reference a baked-web artifact containing the same State.",
              ),
            );
        }
      }
    }
  }
  return diagnostics.length === 0
    ? { valid: true, value: bundle, diagnostics: [] }
    : { valid: false, diagnostics: sorted(diagnostics) };
};
