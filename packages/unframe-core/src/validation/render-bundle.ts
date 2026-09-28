import type { RenderBundleV2 } from "@unframe/contracts/presentation/v2";

import type { Diagnostic, ValidationResult } from "../domain/model.js";
import { hashCanonicalJsonPayload } from "../canonicalization/payload.js";
import { parseRenderBundleInput } from "./contract-input.js";
import { validateRegions, validateSemanticRoles } from "./semantic-invariants.js";
import {
  diagnostic,
  pathSegment,
  sorted,
  structuralDiagnostic,
  validateRecordIds,
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
  let textureBindings = 0;
  let renderedPixels = 0;
  let encodedBytes = 0;
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
    if (surface.renderSurfaceIds.length > policy.maxRenderSurfacesPerSemanticSurface)
      diagnostics.push(
        diagnostic(
          "budget.exceeded",
          `${path}/renderSurfaceIds`,
          "Surface partition count exceeds texture policy.",
        ),
      );

    const stateIds = Object.keys(surface.semanticsByState);
    if (stateIds.length > policy.maxStatesPerRenderSurface)
      diagnostics.push(
        diagnostic(
          "budget.exceeded",
          `${path}/semanticsByState`,
          "State count exceeds texture policy.",
        ),
      );
    if (!equalSet(stateIds, Object.keys(surface.interactionsByState)))
      diagnostics.push(
        diagnostic(
          "artifact.invalid",
          `${path}/interactionsByState`,
          "Semantic and interaction State sets must match.",
        ),
      );
    for (const [stateId, tree] of Object.entries(surface.semanticsByState)) {
      validateSemanticRoles(diagnostics, tree, `${path}/semanticsByState/${pathSegment(stateId)}`);
    }
    for (const [stateId, regions] of Object.entries(surface.interactionsByState)) {
      const tree = surface.semanticsByState[stateId];
      if (tree)
        validateRegions(
          diagnostics,
          tree,
          regions,
          `${path}/interactionsByState/${pathSegment(stateId)}`,
        );
    }

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
      const bounds = renderSurface.logicalBounds;
      if (
        bounds.x < 0 ||
        bounds.y < 0 ||
        bounds.x + bounds.width > surface.logicalSize[0] ||
        bounds.y + bounds.height > surface.logicalSize[1]
      )
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            `${renderPath}/logicalBounds`,
            "RenderSurface bounds must lie within the SemanticSurface logical size.",
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
          const [width, height] = state.texture.pixelSize;
          renderedPixels += width * height;
          encodedBytes += state.texture.encodedSizeBytes;
          if (
            width > policy.maxTextureWidth ||
            height > policy.maxTextureHeight ||
            width * height > policy.maxTexturePixels ||
            expectedGpuBytes > policy.maxSurfaceCaptureBytes
          )
            diagnostics.push(
              diagnostic(
                "budget.exceeded",
                `${statePath}/texture`,
                "Texture exceeds policy dimensions or capture bytes.",
              ),
            );
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
          textureBindings += binding.artifactIds.length;
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
    for (const [index, renderSurfaceId] of surface.renderSurfaceIds.entries())
      if (surface.renderSurfaces[renderSurfaceId]?.layer !== index)
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            `${path}/renderSurfaceIds/${index}`,
            "RenderSurfaces must be ordered by consecutive layers.",
          ),
        );
  }
  if (globalRenderSurfaceIds.size > policy.maxRenderSurfacesPerBundle)
    diagnostics.push(
      diagnostic("budget.exceeded", "/surfaces", "RenderSurface count exceeds texture policy."),
    );
  if (
    textureBindings > policy.maxTextureBindings ||
    renderedPixels > policy.maxRenderedPixels ||
    encodedBytes > policy.maxBuildOutputBytes
  )
    diagnostics.push(
      diagnostic(
        "budget.exceeded",
        "/buildContext/textureBuildPolicy",
        "RenderBundle exceeds texture build budget.",
      ),
    );
  return diagnostics.length === 0
    ? { valid: true, value: bundle, diagnostics: [] }
    : { valid: false, diagnostics: sorted(diagnostics) };
};
