import { PNG_ENCODER_IDENTITY, encodeRgbaToPng } from "@unframe/unframe-assets";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  materializeCompletedSemanticTree,
  validatePresentationArtifacts,
  verifyBuildIntegrityV2,
  type BuildArtifactsV2,
  type Diagnostic,
  type RenderBundle,
  type ValidationResult,
} from "@unframe/unframe-core";
import {
  createRendererFingerprint,
  executeRendererPlugin,
  validateRendererPlugin,
} from "@unframe/unframe-renderer-api";
import { compareStrings, diagnostic, sortDiagnostics } from "../diagnostics/diagnostics.js";
import {
  compilerBuildOptionsSchema,
  declarationProjectEnvelopeSchema,
} from "../validation/project-schemas.js";
import { safeBuildOptionsSnapshot } from "../validation/safe-build-options.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { decodeCanonicalBase64 } from "../validation/source-assets.js";
import { derivedResourceId, resourceId } from "../lowering/support.js";
import { checkDeclarationProject } from "./check-declaration-project.js";
import type {
  CheckedDeclarationProject,
  CompiledDeclarationProject,
  CompilerBuildOptions,
  CompilerDeclarationProject,
} from "./types.js";

type RenderArtifact =
  RenderBundle["surfaces"][string]["renderSurfaces"][string]["artifacts"][string];
type BakedWebArtifact = Extract<RenderArtifact, { kind: "baked-web" }>;

const POLICY_BASE = {
  policyVersion: 1 as const,
  resolutionPolicyVersion: 1 as const,
  longEdgePixels: 2048,
  maxStatesPerRenderSurface: 16,
  maxRenderSurfacesPerSemanticSurface: 16,
  maxRenderSurfacesPerBundle: 64,
  maxTextureBindings: 256,
  maxTextureWidth: 2048,
  maxTextureHeight: 2048,
  maxTexturePixels: 4_194_304,
  maxRenderedPixels: 67_108_864,
  maxSurfaceCaptureBytes: 268_435_456,
  maxBuildOutputBytes: 268_435_456,
  maxBuildAccountedPeakBytes: 536_870_912,
  rendererConcurrency: 1 as const,
};
const POLICY = { ...POLICY_BASE, policyHash: hashCanonicalJsonPayload(POLICY_BASE) };
const failure = (
  code: string,
  path: readonly (string | number)[],
  message: string,
): ValidationResult<never> => ({ valid: false, diagnostics: [diagnostic(code, path, message)] });
const budgetFailure = (code: string, path: readonly (string | number)[]) =>
  failure(code, path, "The fixed texture build policy budget was exceeded.");
const pixelTargetFor = ([width, height]: readonly [number, number]): readonly [number, number] => {
  const scale = POLICY.longEdgePixels / Math.max(width, height);
  return [
    Math.max(1, Math.floor(width * scale + 0.5)),
    Math.max(1, Math.floor(height * scale + 0.5)),
  ];
};

const compileUnchecked = async (
  input: unknown,
  options: unknown,
  checkedOverride?: CheckedDeclarationProject,
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  const checked = checkedOverride
    ? { valid: true as const, value: checkedOverride, diagnostics: [] as const }
    : checkDeclarationProject(input);
  if (!checked.valid) return checked;
  const optionsSnapshot = safeBuildOptionsSnapshot(options);
  if (!optionsSnapshot.valid) return optionsSnapshot;
  const parsedOptions = compilerBuildOptionsSchema.safeParse(optionsSnapshot.value);
  if (!parsedOptions.success)
    return failure(
      "compiler-invalid-options",
      ["options"],
      "Build options must be a complete explicit configuration.",
    );
  const buildOptions = parsedOptions.data as unknown as CompilerBuildOptions;
  const sourceSnapshot = safePlainClone(input);
  if (!sourceSnapshot.valid)
    return failure("compiler-invalid-input", [], "Project input could not be resolved safely.");
  const parsedProject = declarationProjectEnvelopeSchema.safeParse(sourceSnapshot.value);
  if (!parsedProject.success)
    return failure("compiler-invalid-input", [], "Project input could not be resolved safely.");
  const project = parsedProject.data as unknown as CompilerDeclarationProject;
  const themeId = project.presentation.theme?.themeId;
  const theme = project.themes.find(({ declaration }) => declaration.id === themeId);
  if (!theme)
    return failure(
      "compiler-theme-not-found",
      ["themes"],
      "Selected theme must resolve exactly once.",
    );
  const bundleThemeId = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(themeId ?? "")
    ? (themeId as string)
    : resourceId("theme", themeId as string);

  const rendererDiagnostics: Diagnostic[] = [];
  for (const [index, candidate] of buildOptions.renderers.entries())
    for (const item of validateRendererPlugin(candidate))
      rendererDiagnostics.push({ ...item, path: ["options", "renderers", index, ...item.path] });
  if (rendererDiagnostics.length)
    return { valid: false, diagnostics: sortDiagnostics(rendererDiagnostics) };
  const renderers = buildOptions.renderers.filter(({ identity }) => identity.id === "baked-web");
  if (renderers.length !== 1)
    return failure(
      renderers.length ? "compiler-renderer-ambiguous" : "compiler-renderer-not-found",
      ["options", "renderers"],
      "baked-web renderer must resolve exactly once.",
    );
  const renderer = renderers[0]!;
  const rendererFingerprint = createRendererFingerprint(
    renderer.identity,
    buildOptions.rendererConfigHash,
  );
  const environmentHash = hashCanonicalJsonPayload({
    baseEnvironmentHash: buildOptions.compiler.baseEnvironmentHash,
    compilerName: buildOptions.compiler.name,
    compilerVersion: buildOptions.compiler.version,
    pngEncoder: PNG_ENCODER_IDENTITY,
    rendererFingerprint,
  });

  const assets: Record<string, Uint8Array> = {};
  const fontAssets: Record<
    string,
    { mediaType: "font/ttf" | "font/otf"; checksum: `sha256:${string}`; dataBase64: string }
  > = {};
  for (const [assetId, asset] of Object.entries(project.assets)) {
    const bytes = decodeCanonicalBase64(asset.dataBase64);
    if (!bytes)
      return failure(
        "compiler-invalid-asset",
        ["assets", assetId],
        "Asset bytes must be canonical base64.",
      );
    assets[assetId] = bytes;
    fontAssets[assetId] = {
      mediaType: asset.mediaType,
      checksum: asset.checksum as `sha256:${string}`,
      dataBase64: asset.dataBase64,
    };
  }

  const definition = checked.value.definition;
  const surfaces: RenderBundle["surfaces"] = {};
  const generatedDescriptors: Record<string, BuildArtifactsV2["assetSet"]["assets"][string]> = {};
  const retainedChecksums = new Set<string>();
  let outputBytes = 0;
  for (const asset of Object.values(checked.value.assetSet.assets))
    if (!retainedChecksums.has(asset.checksum)) {
      retainedChecksums.add(asset.checksum);
      outputBytes += asset.encodedSizeBytes;
    }
  if (!Number.isSafeInteger(outputBytes) || outputBytes > POLICY.maxBuildOutputBytes)
    return budgetFailure("compiler-budget-output-bytes-exceeded", ["assets"]);
  let preflightBindings = 0;
  let preflightPixels = 0;
  const definitionSurfaces = Object.values(definition.scene.surfaces);
  const preflightDiagnostics: Diagnostic[] = [];
  if (definitionSurfaces.length > POLICY.maxRenderSurfacesPerBundle)
    preflightDiagnostics.push(
      diagnostic(
        "compiler-budget-render-surface-count-exceeded",
        ["definition", "scene", "surfaces"],
        "Render Surface count exceeds the fixed texture build policy.",
      ),
    );
  for (const surface of definitionSurfaces) {
    const stateCount = Object.keys(surface.states).length;
    const pixelTarget = pixelTargetFor(surface.logicalSize);
    const pixelCount = pixelTarget[0] * pixelTarget[1];
    preflightBindings += stateCount;
    preflightPixels += pixelCount * stateCount;
    const path = ["definition", "scene", "surfaces", surface.id] as const;
    if (stateCount > POLICY.maxStatesPerRenderSurface)
      preflightDiagnostics.push(
        diagnostic(
          "compiler-budget-state-count-exceeded",
          [...path, "states"],
          "State count exceeds the fixed texture build policy.",
        ),
      );
    if (
      pixelTarget[0] > POLICY.maxTextureWidth ||
      pixelTarget[1] > POLICY.maxTextureHeight ||
      pixelCount > POLICY.maxTexturePixels
    )
      preflightDiagnostics.push(
        diagnostic(
          "compiler-budget-pixel-target-exceeded",
          [...path, "logicalSize"],
          "Derived pixel dimensions exceed the fixed texture build policy.",
        ),
      );
    if (pixelCount * stateCount * 4 > POLICY.maxSurfaceCaptureBytes)
      preflightDiagnostics.push(
        diagnostic(
          "compiler-budget-capture-bytes-exceeded",
          path,
          "Predicted capture bytes exceed the fixed texture build policy.",
        ),
      );
  }
  if (!Number.isSafeInteger(preflightBindings) || preflightBindings > POLICY.maxTextureBindings)
    preflightDiagnostics.push(
      diagnostic(
        "compiler-budget-texture-binding-count-exceeded",
        ["definition", "scene", "surfaces"],
        "Texture binding count exceeds the fixed texture build policy.",
      ),
    );
  if (!Number.isSafeInteger(preflightPixels) || preflightPixels > POLICY.maxRenderedPixels)
    preflightDiagnostics.push(
      diagnostic(
        "compiler-budget-rendered-pixels-exceeded",
        ["definition", "scene", "surfaces"],
        "Rendered pixels exceed the fixed texture build policy.",
      ),
    );
  if (preflightDiagnostics.length > 0)
    return { valid: false, diagnostics: sortDiagnostics(preflightDiagnostics) };
  for (const [surfaceId, surface] of Object.entries(definition.scene.surfaces).sort(
    ([left], [right]) => compareStrings(left, right),
  )) {
    const stateIds = Object.keys(surface.states).sort(compareStrings);
    const pixelTarget = pixelTargetFor(surface.logicalSize);
    const semanticsByState: RenderBundle["surfaces"][string]["semanticsByState"] = {};
    const states: Record<string, { kind: "capture" }> = {};
    for (const stateId of stateIds) {
      const materialized = materializeCompletedSemanticTree(surface, stateId);
      if (!materialized.valid) return materialized;
      semanticsByState[stateId] = {
        rootNodeIds: [...materialized.value.rootNodeIds],
        nodes: Object.fromEntries(
          Object.entries(materialized.value.nodes).map(([id, node]) => [id, { ...node }]),
        ),
      };
      states[stateId] = { kind: "capture" };
    }
    const renderSurfaceId = derivedResourceId(surfaceId, "render");
    const inputHash = hashCanonicalJsonPayload({
      definitionHash: checked.value.definitionHash,
      surfaceId,
      semanticsByState,
    });
    const buildContextHash = hashCanonicalJsonPayload({
      colorScheme: buildOptions.colorScheme,
      inputHash,
      locale: buildOptions.locale,
      pixelTarget,
      rendererConfigHash: buildOptions.rendererConfigHash,
      textureBuildPolicy: POLICY,
      themeHash: theme.hash,
      themeId: bundleThemeId,
      timezone: buildOptions.timezone,
    });
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
      fontAssets,
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
        contentNodeIds: Object.keys(surface.contentNodes).sort(compareStrings),
        states,
      },
      entry: { kind: "structured" },
      context: {
        locale: buildOptions.locale,
        timezone: buildOptions.timezone,
        colorScheme: buildOptions.colorScheme,
        themeId: bundleThemeId,
        themeHash: theme.hash,
        inputHash,
        buildContextHash,
        environmentHash,
        rendererConfigHash: buildOptions.rendererConfigHash,
        rendererFingerprint,
        pixelTarget,
      },
    });
    if (!rendered.valid) return rendered;
    const alphaModes = new Set(rendered.value.captures.map(({ alphaMode }) => alphaMode));
    if (alphaModes.size !== 1)
      return failure(
        "compiler-renderer-output-inconsistent",
        ["render", surfaceId, "captures"],
        "All captures in one baked-web artifact must use the same alpha mode.",
      );
    const artifactId = derivedResourceId(renderSurfaceId, "artifact");
    const captureBytes = rendered.value.captures.reduce(
      (sum, capture) => sum + capture.rgba.length,
      0,
    );
    if (!Number.isSafeInteger(captureBytes) || captureBytes > POLICY.maxSurfaceCaptureBytes)
      return budgetFailure("compiler-budget-capture-bytes-exceeded", ["render", surfaceId]);
    const artifactStates: BakedWebArtifact["states"] = {};
    for (const capture of [...rendered.value.captures].sort((left, right) =>
      compareStrings(left.stateId, right.stateId),
    )) {
      if (capture.pixelSize[0] !== pixelTarget[0] || capture.pixelSize[1] !== pixelTarget[1])
        return budgetFailure("compiler-budget-pixel-target-exceeded", [
          "render",
          surfaceId,
          capture.stateId,
        ]);
      const encoded = encodeRgbaToPng({
        sourceId: `${surfaceId}:${capture.id}`,
        rgba: capture.rgba,
        pixelSize: capture.pixelSize,
        colorSpace: capture.colorSpace,
        alphaMode: capture.alphaMode,
        limits: buildOptions.encodeLimits,
      });
      if (!encoded.valid) return encoded;
      const uniqueOutput = !retainedChecksums.has(encoded.value.descriptor.checksum);
      const nextOutputBytes = outputBytes + (uniqueOutput ? encoded.value.byteLength : 0);
      if (!Number.isSafeInteger(nextOutputBytes) || nextOutputBytes > POLICY.maxBuildOutputBytes)
        return budgetFailure("compiler-budget-output-bytes-exceeded", [
          "render",
          surfaceId,
          capture.stateId,
        ]);
      const accountedPeakBytes = outputBytes + captureBytes + encoded.value.byteLength;
      if (
        !Number.isSafeInteger(accountedPeakBytes) ||
        accountedPeakBytes > POLICY.maxBuildAccountedPeakBytes
      )
        return budgetFailure("compiler-budget-accounted-peak-exceeded", [
          "render",
          surfaceId,
          capture.stateId,
        ]);
      if (uniqueOutput) {
        retainedChecksums.add(encoded.value.descriptor.checksum);
        outputBytes = nextOutputBytes;
      }
      assets[encoded.value.descriptor.assetId] = encoded.value.bytes;
      generatedDescriptors[encoded.value.descriptor.assetId] = {
        checksum: encoded.value.descriptor.checksum,
        mediaType: "image/png",
        encodedSizeBytes: encoded.value.byteLength,
      };
      artifactStates[capture.stateId] = {
        stateId: capture.stateId,
        texture: {
          ...encoded.value.descriptor,
          pixelSize: [...encoded.value.descriptor.pixelSize],
        },
      };
    }
    const stateBindings: Record<string, { kind: "artifacts"; artifactIds: string[] }> = {};
    for (const stateId of stateIds)
      stateBindings[stateId] = { kind: "artifacts", artifactIds: [artifactId] };
    const alphaFeature =
      rendered.value.captures[0]?.alphaMode === "straight"
        ? ("alpha-straight" as const)
        : ("alpha-opaque" as const);
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
            [artifactId]: {
              id: artifactId,
              kind: "baked-web",
              contractVersion: 1,
              requiredFeatures: [alphaFeature, "png", "srgb"],
              states: artifactStates,
            },
          },
          stateBindings,
        },
      },
      semanticsByState,
      interactionsByState: Object.fromEntries(
        Object.entries(rendered.value.hitRegionsByState).map(([stateId, regions]) => [
          stateId,
          regions.map((region) => ({ ...region, bounds: { ...region.bounds } })),
        ]),
      ),
    };
  }

  const bundle: RenderBundle = {
    schemaVersion: 2,
    bundleId: `b:${hashCanonicalJsonPayload({ sourceHash: checked.value.sourceHash, definitionHash: checked.value.definitionHash, environmentHash, locale: buildOptions.locale, timezone: buildOptions.timezone, colorScheme: buildOptions.colorScheme, themeId: bundleThemeId, themeHash: theme.hash, rendererConfigHash: buildOptions.rendererConfigHash, textureBuildPolicy: POLICY }).slice(7)}`,
    sourceHash: checked.value.sourceHash,
    definitionHash: checked.value.definitionHash,
    compiler: {
      name: buildOptions.compiler.name,
      version: buildOptions.compiler.version,
      environmentHash,
    },
    buildContext: {
      locale: buildOptions.locale,
      timezone: buildOptions.timezone,
      colorScheme: buildOptions.colorScheme,
      themeId: bundleThemeId,
      themeHash: theme.hash,
      textureBuildPolicy: POLICY,
    },
    surfaces,
    models: {},
  };
  const assetSet: BuildArtifactsV2["assetSet"] = {
    schemaVersion: 2,
    assets: { ...checked.value.assetSet.assets, ...generatedDescriptors },
  };
  const renderBundleJson = canonicalizeJsonPayload(bundle);
  const renderBundleHash = hashCanonicalJsonPayload(bundle);
  const assetSetJson = canonicalizeJsonPayload(assetSet);
  const assetSetHash = hashCanonicalJsonPayload(assetSet);
  const buildManifest: BuildArtifactsV2["buildManifest"] = {
    schemaVersion: 2,
    buildId: `build:${hashCanonicalJsonPayload({ sourceHash: checked.value.sourceHash, renderBundleHash, assetSetHash }).slice(7)}`,
    presentationId: definition.presentationId,
    sourceDraftRevision: 0,
    definitionHash: checked.value.definitionHash,
    renderBundleHash,
    assetSetHash,
    contractVersions: {
      definition: 2,
      renderBundle: 2,
      assetSet: 2,
      delivery: 2,
      runtime: 2,
      progression: 1,
      projection: 1,
    },
  };
  const artifactValidation = validatePresentationArtifacts(definition, bundle);
  if (!artifactValidation.valid) return artifactValidation;
  const verified = verifyBuildIntegrityV2({
    definition,
    renderBundle: bundle,
    assetSet,
    buildManifest,
  });
  if (!verified.valid) return verified;
  return {
    valid: true,
    value: {
      ...checked.value,
      renderBundle: verified.value.renderBundle,
      renderBundleJson,
      renderBundleHash,
      assetSet: verified.value.assetSet,
      assetSetJson,
      assetSetHash,
      buildManifest: verified.value.buildManifest,
      buildManifestJson: canonicalizeJsonPayload(verified.value.buildManifest),
      buildManifestHash: hashCanonicalJsonPayload(verified.value.buildManifest),
      assets,
    },
    diagnostics: [],
  };
};

export const compileCheckedDeclarationProject = (
  project: CompilerDeclarationProject,
  checked: CheckedDeclarationProject,
  options: unknown,
) => compileUnchecked(project, options, checked);
export const compileDeclarationProject = async (
  input: unknown,
  options: unknown,
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  try {
    return await compileUnchecked(input, options);
  } catch {
    return failure("compiler-invalid-input", [], "Compiler input could not be inspected safely.");
  }
};
