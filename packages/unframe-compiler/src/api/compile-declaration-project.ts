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
  type SemanticSurface,
  type ValidationResult,
} from "@unframe/unframe-core";
import {
  createRendererFingerprint,
  executeRendererPlugin,
  type RendererIdentity,
  type RenderSurfacePlan,
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
import { reactResourceId } from "../resolution/resolve-opaque-component.js";
import { checkDeclarationProject } from "./check-declaration-project.js";
import { opaquePartitionIdentity } from "./opaque-partition-identity.js";
import { planSurfacePartitions } from "./plan-surface-partitions.js";
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
  longEdgePixels: 2048,
  maxBuildAccountedPeakBytes: 536_870_912,
  maxBuildOutputBytes: 268_435_456,
  maxRenderedPixels: 67_108_864,
  maxRenderSurfacesPerBundle: 64,
  maxRenderSurfacesPerSemanticSurface: 16,
  maxStatesPerRenderSurface: 16,
  maxSurfaceCaptureBytes: 268_435_456,
  maxTextureBindings: 256,
  maxTextureHeight: 2048,
  maxTexturePixels: 4_194_304,
  maxTextureWidth: 2048,
  policyVersion: 1 as const,
  rendererConcurrency: 1 as const,
  resolutionPolicyVersion: 1 as const,
};
const POLICY = { ...POLICY_BASE, policyHash: hashCanonicalJsonPayload(POLICY_BASE) };
const failure = (
  code: string,
  path: ReadonlyArray<string | number>,
  message: string,
): ValidationResult<never> => ({ diagnostics: [diagnostic(code, path, message)], valid: false });
const budgetFailure = (code: string, path: ReadonlyArray<string | number>) =>
  failure(code, path, "The fixed texture build policy budget was exceeded.");
type PlannedSurface = Extract<ReturnType<typeof planSurfacePartitions>, { valid: true }>["value"];
const planOpaqueSurface = (
  surface: SemanticSurface,
  renderer: RendererIdentity,
  moduleHash: string,
): ValidationResult<PlannedSurface> => {
  if (surface.content.kind !== "opaque") {
    return failure(
      "compiler-partition-content-unsupported",
      ["surface", surface.id],
      "Opaque content is required.",
    );
  }
  const semanticsByState: PlannedSurface["semanticsByState"] = {};
  const interactionsByState: PlannedSurface["interactionsByState"] = {};
  const states: Record<string, { kind: "capture" }> = {};
  for (const stateId of Object.keys(surface.states).sort(compareStrings)) {
    const materialized = materializeCompletedSemanticTree(surface, stateId);
    if (!materialized.valid) {
      return materialized;
    }
    semanticsByState[stateId] = {
      nodes: Object.fromEntries(
        Object.entries(materialized.value.nodes).map(([id, node]) => [id, { ...node }]),
      ),
      rootNodeIds: [...materialized.value.rootNodeIds],
    };
    interactionsByState[stateId] = [];
    states[stateId] = { kind: "capture" };
  }
  const bounds = { height: surface.logicalSize[1], width: surface.logicalSize[0], x: 0, y: 0 };
  const scale = POLICY.longEdgePixels / Math.max(bounds.width, bounds.height);
  const pixelTarget = [
    Math.max(1, Math.floor(bounds.width * scale + 0.5)),
    Math.max(1, Math.floor(bounds.height * scale + 0.5)),
  ] as const;
  const identity = opaquePartitionIdentity(surface.id, bounds, renderer, moduleHash);
  const plan: RenderSurfacePlan = {
    clipWindow: bounds,
    id: identity.id,
    layer: 0,
    logicalBounds: bounds,
    ownership: {
      bindingKeys: Object.keys(surface.content.bindings).sort(compareStrings),
      kind: "opaque",
    },
    semanticSurfaceId: surface.id,
    states,
  };
  return {
    diagnostics: [],
    valid: true,
    value: {
      interactionsByState,
      partitions: [
        {
          plan,
          pixelTarget,
          partitionRendererKey: identity.partitionRendererKey,
          identityDescriptor: identity.descriptor,
        },
      ],
      semanticsByState,
    },
  };
};
const compileUnchecked = async (
  input: unknown,
  options: unknown,
  checkedOverride?: CheckedDeclarationProject,
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  const checked = checkedOverride
    ? { diagnostics: [] as const, valid: true as const, value: checkedOverride }
    : checkDeclarationProject(input);
  if (!checked.valid) {
    return checked;
  }
  const optionsSnapshot = safeBuildOptionsSnapshot(options);
  if (!optionsSnapshot.valid) {
    return optionsSnapshot;
  }
  const parsedOptions = compilerBuildOptionsSchema.safeParse(optionsSnapshot.value);
  if (!parsedOptions.success) {
    return failure(
      "compiler-invalid-options",
      ["options"],
      "Build options must be a complete explicit configuration.",
    );
  }
  const buildOptions = parsedOptions.data as unknown as CompilerBuildOptions;
  const sourceSnapshot = safePlainClone(input);
  if (!sourceSnapshot.valid) {
    return failure("compiler-invalid-input", [], "Project input could not be resolved safely.");
  }
  const parsedProject = declarationProjectEnvelopeSchema.safeParse(sourceSnapshot.value);
  if (!parsedProject.success) {
    return failure("compiler-invalid-input", [], "Project input could not be resolved safely.");
  }
  const project = parsedProject.data as unknown as CompilerDeclarationProject;
  const themeId = project.presentation.theme?.themeId;
  const theme = project.themes.find(({ declaration }) => declaration.id === themeId);
  if (!theme && (themeId !== undefined || !Array.isArray(project.presentation.scene))) {
    return failure(
      "compiler-theme-not-found",
      ["themes"],
      "Selected theme must resolve exactly once.",
    );
  }
  const themeHash = theme?.hash ?? hashCanonicalJsonPayload({ kind: "no-theme" });
  const bundleThemeId = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(themeId ?? "")
    ? (themeId as string)
    : resourceId("theme", themeId ?? "opaque-no-theme");

  const rendererDiagnostics: Array<Diagnostic> = [];
  for (const [index, candidate] of buildOptions.renderers.entries()) {
    for (const item of validateRendererPlugin(candidate)) {
      rendererDiagnostics.push({ ...item, path: ["options", "renderers", index, ...item.path] });
    }
  }
  if (rendererDiagnostics.length) {
    return { diagnostics: sortDiagnostics(rendererDiagnostics), valid: false };
  }
  const renderers = buildOptions.renderers.filter(({ identity }) => identity.id === "baked-web");
  if (renderers.length !== 1) {
    return failure(
      renderers.length ? "compiler-renderer-ambiguous" : "compiler-renderer-not-found",
      ["options", "renderers"],
      "baked-web renderer must resolve exactly once.",
    );
  }
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
    { checksum: `sha256:${string}`; dataBase64: string; mediaType: "font/ttf" | "font/otf" }
  > = {};
  for (const [assetId, asset] of Object.entries(project.assets)) {
    const bytes = decodeCanonicalBase64(asset.dataBase64);
    if (!bytes) {
      return failure(
        "compiler-invalid-asset",
        ["assets", assetId],
        "Asset bytes must be canonical base64.",
      );
    }
    assets[assetId] = bytes;
    fontAssets[assetId] = {
      checksum: asset.checksum as `sha256:${string}`,
      dataBase64: asset.dataBase64,
      mediaType: asset.mediaType,
    };
  }

  const definition = checked.value.definition;
  const surfaces: RenderBundle["surfaces"] = {};
  const generatedDescriptors: Record<string, BuildArtifactsV2["assetSet"]["assets"][string]> = {};
  const retainedChecksums = new Set<string>();
  let outputBytes = 0;
  for (const asset of Object.values(checked.value.assetSet.assets)) {
    if (!retainedChecksums.has(asset.checksum)) {
      retainedChecksums.add(asset.checksum);
      outputBytes += asset.encodedSizeBytes;
    }
  }
  if (!Number.isSafeInteger(outputBytes) || outputBytes > POLICY.maxBuildOutputBytes) {
    return budgetFailure("compiler-budget-output-bytes-exceeded", ["assets"]);
  }
  const definitionSurfaces = Object.values(definition.scene.surfaces);
  const planned = new Map<string, PlannedSurface>();
  const opaqueRendererHashes = new Map<string, string>();
  const preflightDiagnostics: Array<Diagnostic> = [];
  let preflightBindings = 0;
  let preflightPixels = 0;
  let preflightOutputBytes = outputBytes;
  const hasOpaqueSurface = definitionSurfaces.some((surface) => surface.content.kind === "opaque");
  let totalPartitions = 0;
  for (const surface of definitionSurfaces) {
    if (surface.content.kind === "opaque") {
      const reactScene = Array.isArray(project.presentation.scene)
        ? project.presentation.scene
        : (project.presentation.scene as { components: ReadonlyArray<unknown> }).components.filter(
            (item): item is import("@unframe/unframe-authoring").StaticReactSceneItem =>
              typeof item === "object" && item !== null && "component" in item,
          );
      const instance = reactScene.find(
        (item) => reactResourceId("surface", item.id) === surface.id,
      );
      const component = instance
        ? project.components.find(
            (item) =>
              item.manifest.componentId === instance.component.id &&
              item.manifest.version === instance.component.version,
          )
        : undefined;
      if (!component || component.lock.mode !== "opaque") {
        return failure(
          "compiler-opaque-entry-missing",
          ["scene", "surfaces", surface.id],
          "Opaque capture requires its frozen renderer entry.",
        );
      }
      opaqueRendererHashes.set(surface.id, component.lock.rendererInputHash);
    }
    const result =
      surface.content.kind === "opaque"
        ? planOpaqueSurface(surface, renderer.identity, opaqueRendererHashes.get(surface.id)!)
        : planSurfacePartitions(surface, renderer.identity);
    if (!result.valid) {
      return result;
    }
    planned.set(surface.id, result.value);
    totalPartitions += result.value.partitions.length;
    const path = ["definition", "scene", "surfaces", surface.id] as const;
    if (result.value.partitions.length > POLICY.maxRenderSurfacesPerSemanticSurface) {
      preflightDiagnostics.push(
        diagnostic(
          "compiler-budget-render-surface-count-exceeded",
          path,
          "Render Surface count exceeds the fixed texture build policy.",
        ),
      );
    }
    for (const { pixelTarget, plan } of result.value.partitions) {
      const stateCount = Object.values(plan.states).filter(({ kind }) => kind === "capture").length;
      const pixelCount = pixelTarget[0] * pixelTarget[1];
      preflightBindings += stateCount;
      preflightPixels += pixelCount * stateCount;
      if (Object.keys(plan.states).length > POLICY.maxStatesPerRenderSurface) {
        preflightDiagnostics.push(
          diagnostic(
            "compiler-budget-state-count-exceeded",
            [...path, "states"],
            "State count exceeds the fixed texture build policy.",
          ),
        );
      }
      if (
        pixelTarget[0] > POLICY.maxTextureWidth ||
        pixelTarget[1] > POLICY.maxTextureHeight ||
        pixelCount > POLICY.maxTexturePixels
      ) {
        preflightDiagnostics.push(
          diagnostic(
            "compiler-budget-pixel-target-exceeded",
            [...path, "logicalSize"],
            "Derived pixel dimensions exceed the fixed texture build policy.",
          ),
        );
      }
      if (pixelCount * stateCount * 4 > POLICY.maxSurfaceCaptureBytes) {
        preflightDiagnostics.push(
          diagnostic(
            "compiler-budget-capture-bytes-exceeded",
            path,
            "Predicted capture bytes exceed the fixed texture build policy.",
          ),
        );
      }
      if (hasOpaqueSurface && stateCount > 0) {
        const stateBytes = pixelCount * 4;
        const captureBytes = stateBytes * stateCount;
        const scanlineBytes = stateBytes + pixelTarget[1];
        const maxEncodedStateBytes = scanlineBytes + Math.ceil(scanlineBytes / 65_535) * 5 + 80;
        preflightOutputBytes += maxEncodedStateBytes * stateCount;
        if (
          !Number.isSafeInteger(preflightOutputBytes) ||
          preflightOutputBytes > POLICY.maxBuildOutputBytes
        ) {
          preflightDiagnostics.push(
            diagnostic(
              "compiler-budget-output-bytes-exceeded",
              path,
              "Predicted encoded output exceeds the fixed texture build policy.",
            ),
          );
        }
        const peakBytes =
          preflightOutputBytes +
          captureBytes +
          maxEncodedStateBytes +
          (surface.content.kind === "opaque" ? 2 * stateBytes : 0);
        if (!Number.isSafeInteger(peakBytes) || peakBytes > POLICY.maxBuildAccountedPeakBytes) {
          preflightDiagnostics.push(
            diagnostic(
              "compiler-budget-accounted-peak-exceeded",
              path,
              "Predicted capture and stability buffers exceed the fixed texture build policy.",
            ),
          );
        }
      }
    }
  }
  if (totalPartitions > POLICY.maxRenderSurfacesPerBundle) {
    preflightDiagnostics.push(
      diagnostic(
        "compiler-budget-render-surface-count-exceeded",
        ["definition", "scene", "surfaces"],
        "Render Surface count exceeds the fixed texture build policy.",
      ),
    );
  }
  if (!Number.isSafeInteger(preflightBindings) || preflightBindings > POLICY.maxTextureBindings) {
    preflightDiagnostics.push(
      diagnostic(
        "compiler-budget-texture-binding-count-exceeded",
        ["definition", "scene", "surfaces"],
        "Texture binding count exceeds the fixed texture build policy.",
      ),
    );
  }
  if (!Number.isSafeInteger(preflightPixels) || preflightPixels > POLICY.maxRenderedPixels) {
    preflightDiagnostics.push(
      diagnostic(
        "compiler-budget-rendered-pixels-exceeded",
        ["definition", "scene", "surfaces"],
        "Rendered pixels exceed the fixed texture build policy.",
      ),
    );
  }
  if (preflightDiagnostics.length) {
    return { diagnostics: sortDiagnostics(preflightDiagnostics), valid: false };
  }
  for (const [surfaceId, surface] of Object.entries(definition.scene.surfaces).sort(
    ([left], [right]) => compareStrings(left, right),
  )) {
    const stateIds = Object.keys(surface.states).sort(compareStrings);
    const surfacePlan = planned.get(surfaceId)!;
    const { interactionsByState, semanticsByState } = surfacePlan;
    const partitions = surfacePlan.partitions;
    const renderSurfaces: RenderBundle["surfaces"][string]["renderSurfaces"] = {};
    for (const { pixelTarget, plan } of partitions) {
      const renderSurfaceId = plan.id;
      const opaqueRendererHash = opaqueRendererHashes.get(surfaceId);
      const inputHash = hashCanonicalJsonPayload({
        definitionHash: checked.value.definitionHash,
        ...(opaqueRendererHash
          ? {
              rendererInputHash: opaqueRendererHash,
              sourceHash: checked.value.sourceHash,
            }
          : {}),
        renderSurfaceId,
        semanticsByState,
        surfaceId,
      });
      const buildContextHash = hashCanonicalJsonPayload({
        colorScheme: buildOptions.colorScheme,
        inputHash,
        locale: buildOptions.locale,
        pixelTarget,
        rendererConfigHash: buildOptions.rendererConfigHash,
        textureBuildPolicy: POLICY,
        themeHash,
        themeId: bundleThemeId,
        timezone: buildOptions.timezone,
      });
      const rendered = await executeRendererPlugin(renderer, {
        context: {
          buildContextHash,
          colorScheme: buildOptions.colorScheme,
          environmentHash,
          inputHash,
          locale: buildOptions.locale,
          pixelTarget,
          rendererConfigHash: buildOptions.rendererConfigHash,
          rendererFingerprint,
          themeHash,
          themeId: bundleThemeId,
          timezone: buildOptions.timezone,
        },
        entry: opaqueRendererHash
          ? { entryId: surfaceId, kind: "opaque", moduleHash: opaqueRendererHash }
          : { kind: "structured" },
        fontAssets,
        plan,
        resolvedIntent: {
          fallbackPolicy: surface.renderIntent.fallbackPolicy,
          interaction: surface.renderIntent.interaction,
          internalAnimation: surface.renderIntent.internalAnimation,
          selectedRendererId: "baked-web",
          updateModel: surface.renderIntent.updateModel,
        },
        semanticsByState,
        sourceIntent: surface.renderIntent,
        surface,
      });
      if (!rendered.valid) {
        return rendered;
      }
      if (surface.content.kind === "opaque") {
        const regionOutput = rendered.value.hitRegionsByState;
        if (
          !regionOutput &&
          Object.values(surface.states).some((state) => state.enabledInteractionIds.length)
        ) {
          return failure(
            "compiler-opaque-hit-regions-missing",
            ["render", surfaceId, "hitRegionsByState"],
            "Opaque Interaction requires measured Hit Regions.",
          );
        }
        for (const stateId of stateIds) {
          interactionsByState[stateId] = [...(regionOutput?.[stateId] ?? [])].map((region) => ({
            ...region,
            bounds: { ...region.bounds },
          }));
        }
      }
      const alphaModes = new Set(rendered.value.captures.map(({ alphaMode }) => alphaMode));
      if (alphaModes.size !== 1) {
        return failure(
          "compiler-renderer-output-inconsistent",
          ["render", surfaceId, "captures"],
          "All captures in one baked-web artifact must use the same alpha mode.",
        );
      }
      const artifactId = derivedResourceId(renderSurfaceId, "artifact");
      const captureBytes = rendered.value.captures.reduce(
        (sum, capture) => sum + capture.rgba.length,
        0,
      );
      if (!Number.isSafeInteger(captureBytes) || captureBytes > POLICY.maxSurfaceCaptureBytes) {
        return budgetFailure("compiler-budget-capture-bytes-exceeded", ["render", surfaceId]);
      }
      const artifactStates: BakedWebArtifact["states"] = {};
      for (const capture of [...rendered.value.captures].sort((left, right) =>
        compareStrings(left.stateId, right.stateId),
      )) {
        if (capture.pixelSize[0] !== pixelTarget[0] || capture.pixelSize[1] !== pixelTarget[1]) {
          return budgetFailure("compiler-budget-pixel-target-exceeded", [
            "render",
            surfaceId,
            capture.stateId,
          ]);
        }
        const encoded = encodeRgbaToPng({
          alphaMode: capture.alphaMode,
          colorSpace: capture.colorSpace,
          limits: buildOptions.encodeLimits,
          pixelSize: capture.pixelSize,
          rgba: capture.rgba,
          sourceId: `${surfaceId}:${capture.id}`,
        });
        if (!encoded.valid) {
          return encoded;
        }
        const uniqueOutput = !retainedChecksums.has(encoded.value.descriptor.checksum);
        const nextOutputBytes = outputBytes + (uniqueOutput ? encoded.value.byteLength : 0);
        if (
          !Number.isSafeInteger(nextOutputBytes) ||
          nextOutputBytes > POLICY.maxBuildOutputBytes
        ) {
          return budgetFailure("compiler-budget-output-bytes-exceeded", [
            "render",
            surfaceId,
            capture.stateId,
          ]);
        }
        const accountedPeakBytes =
          outputBytes +
          captureBytes +
          encoded.value.byteLength +
          (surface.content.kind === "opaque" ? capture.rgba.length * 2 : 0);
        if (
          !Number.isSafeInteger(accountedPeakBytes) ||
          accountedPeakBytes > POLICY.maxBuildAccountedPeakBytes
        ) {
          return budgetFailure("compiler-budget-accounted-peak-exceeded", [
            "render",
            surfaceId,
            capture.stateId,
          ]);
        }
        if (uniqueOutput) {
          retainedChecksums.add(encoded.value.descriptor.checksum);
          outputBytes = nextOutputBytes;
        }
        assets[encoded.value.descriptor.assetId] = encoded.value.bytes;
        generatedDescriptors[encoded.value.descriptor.assetId] = {
          checksum: encoded.value.descriptor.checksum,
          encodedSizeBytes: encoded.value.byteLength,
          mediaType: "image/png",
        };
        artifactStates[capture.stateId] = {
          stateId: capture.stateId,
          texture: {
            ...encoded.value.descriptor,
            pixelSize: [...encoded.value.descriptor.pixelSize],
          },
        };
      }
      const stateBindings: Record<
        string,
        { artifactIds: Array<string>; kind: "artifacts" } | { kind: "empty" }
      > = {};
      for (const stateId of stateIds) {
        stateBindings[stateId] =
          plan.states[stateId]?.kind === "empty"
            ? { kind: "empty" }
            : { artifactIds: [artifactId], kind: "artifacts" };
      }
      const alphaFeature =
        rendered.value.captures[0]?.alphaMode === "straight"
          ? ("alpha-straight" as const)
          : ("alpha-opaque" as const);
      renderSurfaces[renderSurfaceId] = {
        artifacts: {
          [artifactId]: {
            contractVersion: 1,
            id: artifactId,
            kind: "baked-web",
            requiredFeatures: [alphaFeature, "png", "srgb"],
            states: artifactStates,
          },
        },
        id: renderSurfaceId,
        layer: plan.layer,
        logicalBounds: plan.logicalBounds,
        partitionStrategyVersion: 1,
        semanticSurfaceId: surfaceId,
        stateBindings,
      };
    }
    surfaces[surfaceId] = {
      interactionsByState,
      logicalSize: [...surface.logicalSize],
      physicalSizeMeters: [...surface.physicalSizeMeters],
      renderSurfaceIds: partitions.map(({ plan }) => plan.id),
      renderSurfaces,
      semanticsByState,
      semanticSurfaceId: surfaceId,
    };
  }

  const bundle: RenderBundle = {
    buildContext: {
      colorScheme: buildOptions.colorScheme,
      locale: buildOptions.locale,
      textureBuildPolicy: POLICY,
      themeHash,
      themeId: bundleThemeId,
      timezone: buildOptions.timezone,
    },
    bundleId: `b:${hashCanonicalJsonPayload({ colorScheme: buildOptions.colorScheme, definitionHash: checked.value.definitionHash, environmentHash, locale: buildOptions.locale, rendererConfigHash: buildOptions.rendererConfigHash, sourceHash: checked.value.sourceHash, textureBuildPolicy: POLICY, themeHash, themeId: bundleThemeId, timezone: buildOptions.timezone }).slice(7)}`,
    compiler: {
      environmentHash,
      name: buildOptions.compiler.name,
      version: buildOptions.compiler.version,
    },
    definitionHash: checked.value.definitionHash,
    models: {},
    schemaVersion: 2,
    sourceHash: checked.value.sourceHash,
    surfaces,
  };
  const assetSet: BuildArtifactsV2["assetSet"] = {
    assets: { ...checked.value.assetSet.assets, ...generatedDescriptors },
    schemaVersion: 2,
  };
  const renderBundleJson = canonicalizeJsonPayload(bundle);
  const renderBundleHash = hashCanonicalJsonPayload(bundle);
  const assetSetJson = canonicalizeJsonPayload(assetSet);
  const assetSetHash = hashCanonicalJsonPayload(assetSet);
  const buildManifest: BuildArtifactsV2["buildManifest"] = {
    assetSetHash,
    buildId: `build:${hashCanonicalJsonPayload({ assetSetHash, renderBundleHash, sourceHash: checked.value.sourceHash }).slice(7)}`,
    contractVersions: {
      assetSet: 2,
      definition: 2,
      delivery: 2,
      progression: 1,
      projection: 1,
      renderBundle: 2,
      runtime: 2,
    },
    definitionHash: checked.value.definitionHash,
    presentationId: definition.presentationId,
    renderBundleHash,
    schemaVersion: 2,
    sourceDraftRevision: 0,
  };
  const artifactValidation = validatePresentationArtifacts(definition, bundle);
  if (!artifactValidation.valid) {
    return artifactValidation;
  }
  const verified = verifyBuildIntegrityV2({
    assetSet,
    buildManifest,
    definition,
    renderBundle: bundle,
  });
  if (!verified.valid) {
    return verified;
  }
  return {
    diagnostics: [],
    valid: true,
    value: {
      ...checked.value,
      assets,
      assetSet: verified.value.assetSet,
      assetSetHash,
      assetSetJson,
      buildManifest: verified.value.buildManifest,
      buildManifestHash: hashCanonicalJsonPayload(verified.value.buildManifest),
      buildManifestJson: canonicalizeJsonPayload(verified.value.buildManifest),
      renderBundle: verified.value.renderBundle,
      renderBundleHash,
      renderBundleJson,
    },
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
