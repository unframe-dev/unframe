import { PNG_ENCODER_IDENTITY, encodeRgbaToPng } from "@unframe/presentation-assets";
import {
  canonicalizeRenderBundle,
  hashRenderBundle,
  materializeCompletedSemanticTree,
  validatePresentationArtifacts,
  type Diagnostic,
  type RenderBundle,
  type ValidationResult,
} from "@unframe/presentation-core";
import {
  createRendererFingerprint,
  executeRendererPlugin,
  validateRendererPlugin,
} from "@unframe/presentation-renderer-api";
import {
  compilerBuildOptionsSchema,
  declarationProjectEnvelopeSchema,
} from "../validation/project-schemas.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { safeBuildOptionsSnapshot } from "../validation/safe-build-options.js";
import { compareStrings, diagnostic, sortDiagnostics } from "../diagnostics/diagnostics.js";
import { hashJson } from "../lowering/support.js";
import { checkDeclarationProject } from "./check-declaration-project.js";
import type {
  CompilerBuildOptions,
  CompilerDeclarationProject,
  CompiledDeclarationProject,
} from "./types.js";

const invalidCompileOptions = (message: string): ValidationResult<never> => ({
  valid: false,
  diagnostics: [diagnostic("compiler-invalid-options", ["options"], message)],
});

const compileUnchecked = async (
  input: unknown,
  options: unknown,
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  const checked = checkDeclarationProject(input);
  if (!checked.valid) return checked;
  const optionsSnapshot = safeBuildOptionsSnapshot(options);
  if (!optionsSnapshot.valid) return optionsSnapshot;
  const parsedOptions = compilerBuildOptionsSchema.safeParse(optionsSnapshot.value);
  if (!parsedOptions.success)
    return invalidCompileOptions("Build options must be a complete explicit configuration.");
  const validatedOptions = parsedOptions.data as unknown as CompilerBuildOptions;

  // The Definition does not retain Theme metadata; resolve it from the checked project instead.
  const sourceProject = safePlainClone(input);
  if (!sourceProject.valid)
    return {
      valid: false,
      diagnostics: [
        diagnostic("compiler-invalid-input", [], "Project input could not be resolved safely."),
      ],
    };
  const parsedSourceProject = declarationProjectEnvelopeSchema.safeParse(sourceProject.value);
  if (!parsedSourceProject.success)
    return {
      valid: false,
      diagnostics: [
        diagnostic("compiler-invalid-input", [], "Project input could not be resolved safely."),
      ],
    };
  const resolvedSourceProject = parsedSourceProject.data as unknown as CompilerDeclarationProject;
  const selectedThemeId = resolvedSourceProject.presentation.theme?.themeId;
  const selectedTheme = resolvedSourceProject.themes.find(
    (candidate) => candidate.declaration.id === selectedThemeId,
  );
  if (!selectedTheme)
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "compiler-theme-not-found",
          ["themes"],
          "Selected theme must resolve exactly once.",
        ),
      ],
    };

  const rendererDiagnostics: Diagnostic[] = [];
  for (const [index, candidate] of validatedOptions.renderers.entries())
    for (const item of validateRendererPlugin(candidate))
      rendererDiagnostics.push({
        ...item,
        path: ["options", "renderers", index, ...item.path],
      });
  if (rendererDiagnostics.length > 0)
    return { valid: false, diagnostics: sortDiagnostics(rendererDiagnostics) };
  const matchingRenderers = validatedOptions.renderers.filter(
    (candidate) => candidate.identity.id === "baked-web",
  );
  if (matchingRenderers.length !== 1)
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          matchingRenderers.length === 0
            ? "compiler-renderer-not-found"
            : "compiler-renderer-ambiguous",
          ["options", "renderers"],
          "baked-web renderer must resolve exactly once.",
        ),
      ],
    };
  const renderer = matchingRenderers[0]!;
  const rendererFingerprint = createRendererFingerprint(
    renderer.identity,
    validatedOptions.rendererConfigHash,
  );
  const environmentHash = hashJson(
    JSON.stringify({
      baseEnvironmentHash: validatedOptions.compiler.baseEnvironmentHash,
      compilerName: validatedOptions.compiler.name,
      compilerVersion: validatedOptions.compiler.version,
      pngEncoder: PNG_ENCODER_IDENTITY,
      rendererFingerprint,
    }),
  );
  const assets: Record<string, Uint8Array> = {};
  const surfaces: RenderBundle["surfaces"] = {};
  const definition = checked.value.definition;

  for (const [surfaceId, surface] of Object.entries(definition.scene.surfaces).sort(([a], [b]) =>
    compareStrings(a, b),
  )) {
    const semanticsByState: Record<
      string,
      RenderBundle["surfaces"][string]["semanticsByState"][string]
    > = {};
    const states: Record<string, { kind: "capture" }> = {};
    for (const stateId of Object.keys(surface.states).sort()) {
      const materialized = materializeCompletedSemanticTree(surface, stateId);
      if (!materialized.valid) return materialized;
      semanticsByState[stateId] =
        materialized.value as unknown as RenderBundle["surfaces"][string]["semanticsByState"][string];
      states[stateId] = { kind: "capture" };
    }
    const renderSurfaceId = `${surfaceId}:render`;
    const inputHash = hashJson(
      JSON.stringify({ definitionHash: checked.value.definitionHash, surfaceId, semanticsByState }),
    );
    const buildContextHash = hashJson(
      JSON.stringify({
        colorScheme: validatedOptions.colorScheme,
        inputHash,
        locale: validatedOptions.locale,
        pixelTarget: validatedOptions.pixelTarget,
        rendererConfigHash: validatedOptions.rendererConfigHash,
        themeHash: selectedTheme.hash,
        themeId: selectedThemeId,
        timezone: validatedOptions.timezone,
      }),
    );
    const rendered = await executeRendererPlugin(renderer, {
      surface,
      sourceIntent: surface.renderIntent,
      resolvedIntent: {
        updateModel: surface.renderIntent.updateModel,
        interaction: surface.renderIntent.interaction,
        internalAnimation: surface.renderIntent.internalAnimation,
        selectedRendererId: "baked-web",
        fallbackPolicy: surface.renderIntent.fallbackPolicy,
      },
      semanticsByState,
      plan: {
        id: renderSurfaceId,
        semanticSurfaceId: surfaceId,
        logicalBounds: {
          x: 0,
          y: 0,
          width: surface.logicalSize[0],
          height: surface.logicalSize[1],
        },
        layer: 0,
        contentNodeIds: Object.keys(surface.contentNodes).sort(),
        states,
      },
      entry: { kind: "structured" },
      context: {
        locale: validatedOptions.locale,
        timezone: validatedOptions.timezone,
        colorScheme: validatedOptions.colorScheme,
        themeId: selectedThemeId as string,
        themeHash: selectedTheme.hash,
        inputHash,
        buildContextHash,
        environmentHash,
        rendererConfigHash: validatedOptions.rendererConfigHash,
        rendererFingerprint,
        pixelTarget: validatedOptions.pixelTarget,
      },
    });
    if (!rendered.valid) return rendered;
    const artifactId = `${renderSurfaceId}:artifact`;
    const artifactStates: Record<string, unknown> = {};
    for (const capture of [...rendered.value.captures].sort((a, b) =>
      compareStrings(a.stateId, b.stateId),
    )) {
      const encoded = encodeRgbaToPng({
        sourceId: `${surfaceId}:${capture.id}`,
        rgba: capture.rgba,
        pixelSize: capture.pixelSize,
        colorSpace: capture.colorSpace,
        alphaMode: capture.alphaMode,
        limits: validatedOptions.encodeLimits,
      });
      if (!encoded.valid) return encoded;
      assets[encoded.value.descriptor.assetId] = encoded.value.bytes;
      artifactStates[capture.stateId] = {
        stateId: capture.stateId,
        textures: [encoded.value.descriptor],
      };
    }
    const stateBindings: Record<string, unknown> = {};
    for (const stateId of Object.keys(surface.states).sort())
      stateBindings[stateId] = { kind: "artifacts", artifactIds: [artifactId] };
    surfaces[surfaceId] = {
      semanticSurfaceId: surfaceId,
      logicalSize: [...surface.logicalSize],
      physicalSizeMeters: [...surface.physicalSizeMeters],
      renderSurfaceIds: [renderSurfaceId],
      renderSurfaces: {
        [renderSurfaceId]: {
          id: renderSurfaceId,
          semanticSurfaceId: surfaceId,
          logicalBounds: {
            x: 0,
            y: 0,
            width: surface.logicalSize[0],
            height: surface.logicalSize[1],
          },
          layer: 0,
          artifacts: {
            [artifactId]: { id: artifactId, kind: "baked-web", states: artifactStates },
          },
          stateBindings,
        },
      },
      semanticsByState,
      interactionsByState: rendered.value.hitRegionsByState,
    } as unknown as RenderBundle["surfaces"][string];
  }
  const bundle: RenderBundle = {
    schemaVersion: 1,
    bundleId: hashJson(
      JSON.stringify({
        sourceHash: checked.value.sourceHash,
        definitionHash: checked.value.definitionHash,
        environmentHash,
        buildContext: {
          locale: validatedOptions.locale,
          timezone: validatedOptions.timezone,
          colorScheme: validatedOptions.colorScheme,
          themeId: selectedThemeId,
          themeHash: selectedTheme.hash,
          pixelTarget: validatedOptions.pixelTarget,
          rendererConfigHash: validatedOptions.rendererConfigHash,
        },
      }),
    ),
    sourceHash: checked.value.sourceHash,
    definitionHash: checked.value.definitionHash,
    compiler: {
      name: validatedOptions.compiler.name,
      version: validatedOptions.compiler.version,
      environmentHash,
    },
    buildContext: {
      locale: validatedOptions.locale,
      timezone: validatedOptions.timezone,
      colorScheme: validatedOptions.colorScheme,
      themeId: selectedThemeId as string,
      themeHash: selectedTheme.hash,
    },
    surfaces,
  };
  const validated = validatePresentationArtifacts(definition, bundle);
  if (!validated.valid) return validated;
  const canonical = canonicalizeRenderBundle(validated.value.renderBundle);
  const hash = hashRenderBundle(validated.value.renderBundle);
  if (!canonical.valid || !hash.valid)
    return {
      valid: false,
      diagnostics: !canonical.valid ? canonical.diagnostics : hash.diagnostics,
    };
  return {
    valid: true,
    value: {
      ...checked.value,
      renderBundle: validated.value.renderBundle,
      renderBundleJson: canonical.value,
      renderBundleHash: hash.value,
      assets,
    },
    diagnostics: [],
  };
};

export const compileDeclarationProject = async (
  input: unknown,
  options: unknown,
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  try {
    return await compileUnchecked(input, options);
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic("compiler-invalid-input", [], "Compiler input could not be inspected safely."),
      ],
    };
  }
};
