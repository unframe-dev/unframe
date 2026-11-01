import { compileVideoAssets } from "./compile-video-assets.js";
import { compileModelAssets, MODEL_BUILD_IDENTITY } from "./compile-model-assets.js";
import type { CompilerSourceAssetBytes } from "./types.js";
import { CompilerInternalError, type CompilerStage } from "./compiler-internal-error.js";
import { PNG_ENCODER_IDENTITY, encodeRgbaToPng } from "@unframe/core/assets";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  validatePresentationArtifacts,
  verifyBuildIntegrity,
  type BuildArtifacts,
} from "@unframe/artifacts";
import {
  materializeCompletedSemanticTree,
  type Diagnostic,
  type RenderBundle,
  type SemanticSurface,
  type ValidationResult,
} from "@unframe/presentation";
import {
  SUPPORTED_RENDERER_CONTRACT_VERSION,
  createRendererFingerprint,
  executeRendererPlugin,
  type RendererIdentity,
  type RenderSurfacePlan,
  validateRendererPlugin,
} from "@unframe/core/renderer-api";
import { compareStrings, diagnostic, sortDiagnostics } from "../diagnostics/diagnostics.js";
import {
  readCachedBuild,
  writeCachedBuild,
  type CompilerBuildCache,
} from "../cache/build-cache.js";
import { compilerBuildOptionsSchema } from "../validation/project-schemas.js";
import { safeBuildOptionsSnapshot } from "../validation/safe-build-options.js";
import { encodeSourceAssetBase64 } from "../validation/source-assets.js";
import { derivedResourceId, resourceId } from "../lowering/support.js";
import { reactResourceId } from "../resolution/resolve-opaque-component.js";
import { prepareDeclarationProject } from "./check-declaration-project.js";
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
type PlannedSurface = Extract<ReturnType<typeof planSurfacePartitions>, { valid: true }>["value"];
const planOpaqueSurface = (
  surface: SemanticSurface,
  renderer: RendererIdentity,
  moduleHash: string,
): ValidationResult<PlannedSurface> => {
  if (surface.content.kind !== "opaque")
    return failure(
      "compiler-partition-content-unsupported",
      ["surface", surface.id],
      "Opaque content is required.",
    );
  const semanticsByState: PlannedSurface["semanticsByState"] = {};
  const interactionsByState: PlannedSurface["interactionsByState"] = {};
  const states: Record<string, { kind: "capture" }> = {};
  for (const stateId of Object.keys(surface.states).sort(compareStrings)) {
    const materialized = materializeCompletedSemanticTree(surface, stateId);
    if (!materialized.valid) return materialized;
    semanticsByState[stateId] = {
      rootNodeIds: [...materialized.value.rootNodeIds],
      nodes: Object.fromEntries(
        Object.entries(materialized.value.nodes).map(([id, node]) => [id, { ...node }]),
      ),
    };
    interactionsByState[stateId] = [];
    states[stateId] = { kind: "capture" };
  }
  const bounds = { x: 0, y: 0, width: surface.logicalSize[0], height: surface.logicalSize[1] };
  const scale = POLICY.longEdgePixels / Math.max(bounds.width, bounds.height);
  const pixelTarget = [
    Math.max(1, Math.floor(bounds.width * scale + 0.5)),
    Math.max(1, Math.floor(bounds.height * scale + 0.5)),
  ] as const;
  const identity = opaquePartitionIdentity(surface.id, bounds, renderer, moduleHash);
  const plan: RenderSurfacePlan = {
    id: identity.id,
    semanticSurfaceId: surface.id,
    logicalBounds: bounds,
    layer: 0,
    ownership: {
      kind: "opaque",
      bindingKeys: Object.keys(surface.content.bindings).sort(compareStrings),
    },
    clipWindow: bounds,
    states,
  };
  return {
    valid: true,
    value: {
      partitions: [
        {
          plan,
          pixelTarget,
          partitionRendererKey: identity.partitionRendererKey,
          identityDescriptor: identity.descriptor,
        },
      ],
      semanticsByState,
      interactionsByState,
    },
    diagnostics: [],
  };
};
const compileUnchecked = async (
  input: unknown,
  options: unknown,
  checkedOverride: CheckedDeclarationProject | undefined,
  sourceAssetBytes: unknown,
  cache: CompilerBuildCache | undefined,
  context: { stage: CompilerStage },
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  const prepared = prepareDeclarationProject(input, sourceAssetBytes, checkedOverride);
  if (!prepared.valid) return prepared;
  const project = prepared.value.project;
  const checked = { valid: true as const, value: prepared.value.checked, diagnostics: [] as const };
  context.stage = "input";
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
  context.stage = "planning";
  const checkedSurfaces = Object.values(checked.value.definition.scene.surfaces);
  const needsRenderer = checkedSurfaces.length > 0;
  const needsTheme = checkedSurfaces.some((surface) => surface.content.kind === "structured");
  context.stage = "input";
  const hasModels = Object.values(project.assets).some(
    (asset) => asset.mediaType === "model/gltf-binary",
  );
  const mediaSourceBytes = Object.values(project.assets).reduce(
    (sum, asset) =>
      sum +
      (asset.mediaType === "model/gltf-binary" || asset.mediaType === "video/mp4"
        ? asset.encodedSizeBytes
        : 0),
    0,
  );
  const themeId = project.presentation.theme?.themeId;
  const theme = project.themes.find(({ declaration }) => declaration.id === themeId);
  if (!theme && (themeId !== undefined || needsTheme))
    return failure(
      "compiler-theme-not-found",
      ["themes"],
      "Selected theme must resolve exactly once.",
    );
  const themeHash = theme?.hash ?? hashCanonicalJsonPayload({ kind: "no-theme" });
  const bundleThemeId = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(themeId ?? "")
    ? (themeId as string)
    : resourceId("theme", themeId ?? "opaque-no-theme");

  context.stage = "renderer-validation";
  const rendererDiagnostics: Diagnostic[] = [];
  for (const [index, candidate] of buildOptions.renderers.entries())
    for (const item of validateRendererPlugin(candidate))
      rendererDiagnostics.push({ ...item, path: ["options", "renderers", index, ...item.path] });
  if (rendererDiagnostics.length)
    return { valid: false, diagnostics: sortDiagnostics(rendererDiagnostics) };
  const rendererIds = new Set<string>();
  for (const [index, candidate] of buildOptions.renderers.entries()) {
    if (candidate.identity.contractVersion !== SUPPORTED_RENDERER_CONTRACT_VERSION)
      return failure(
        "compiler-renderer-contract-unsupported",
        ["options", "renderers", index, "identity", "contractVersion"],
        "Renderer contract version is unsupported.",
      );
    if (rendererIds.has(candidate.identity.id))
      return failure(
        "compiler-renderer-ambiguous",
        ["options", "renderers"],
        "Renderer ID must resolve exactly once.",
      );
    rendererIds.add(candidate.identity.id);
  }
  const renderers = buildOptions.renderers.filter(({ identity }) => identity.id === "baked-web");
  if (renderers.length > 1 || (needsRenderer && renderers.length !== 1))
    return failure(
      renderers.length ? "compiler-renderer-ambiguous" : "compiler-renderer-not-found",
      ["options", "renderers"],
      "baked-web renderer must resolve exactly once.",
    );
  const renderer = renderers[0];
  const rendererFingerprint = renderer
    ? createRendererFingerprint(renderer.identity, buildOptions.rendererConfigHash)
    : hashCanonicalJsonPayload({ kind: "no-surfaces" });
  const environmentHash = hashCanonicalJsonPayload({
    baseEnvironmentHash: buildOptions.compiler.baseEnvironmentHash,
    compilerName: buildOptions.compiler.name,
    compilerVersion: buildOptions.compiler.version,
    pngEncoder: PNG_ENCODER_IDENTITY,
    rendererFingerprint,
    ...(hasModels ? { modelBuild: MODEL_BUILD_IDENTITY } : {}),
    ...(Object.values(project.assets).some((asset) => asset.mediaType === "video/mp4")
      ? { videoValidator: buildOptions.videoValidator?.identity ?? null }
      : {}),
  });
  context.stage = "cache";
  const cacheKey = cache
    ? hashCanonicalJsonPayload({
        cacheVersion: 1,
        project,
        compiler: buildOptions.compiler,
        locale: buildOptions.locale,
        timezone: buildOptions.timezone,
        colorScheme: buildOptions.colorScheme,
        rendererConfigHash: buildOptions.rendererConfigHash,
        encodeLimits: buildOptions.encodeLimits,
        rendererIdentity: renderer?.identity ?? null,
        rendererCapabilities: renderer?.capabilities ?? null,
        rendererRegistry: buildOptions.renderers
          .map(({ identity, capabilities }) => ({ identity, capabilities }))
          .sort((left, right) => compareStrings(left.identity.id, right.identity.id)),
        rendererFingerprint,
        environmentHash,
        pngEncoder: PNG_ENCODER_IDENTITY,
        textureBuildPolicy: POLICY,
      })
    : undefined;
  if (cache && cacheKey) {
    const cached = await readCachedBuild(cache, cacheKey, checked.value, {
      environmentHash,
      compilerName: buildOptions.compiler.name,
      compilerVersion: buildOptions.compiler.version,
      locale: buildOptions.locale,
      timezone: buildOptions.timezone,
      colorScheme: buildOptions.colorScheme,
      themeId: bundleThemeId,
      themeHash,
      textureBuildPolicyHash: hashCanonicalJsonPayload(POLICY),
    });
    if (cached) return { valid: true, value: cached, diagnostics: [] };
  }

  context.stage = "planning";
  const modelAssets = await compileModelAssets(project.assets, prepared.value.sourceAssetBytes);
  if (!modelAssets.valid) return modelAssets;
  for (const [groupId, group] of Object.entries(checked.value.definition.flow.groups))
    for (const [stepId, step] of Object.entries(group.steps))
      for (const [cueIndex, cue] of step.cues.entries()) {
        const targets = [
          ...(cue.trigger.kind === "modelClipCompleted" ? [cue.trigger] : []),
          ...cue.actions.filter((action) => action.kind === "modelClip.play"),
        ];
        for (const target of targets) {
          const node = checked.value.definition.scene.nodes[target.nodeId];
          const model = node?.kind === "model" ? modelAssets.value.models[node.assetId] : undefined;
          const clip = model?.clips[target.clipId];
          if (
            !clip ||
            !Number.isSafeInteger(clip.durationMilliseconds) ||
            clip.durationMilliseconds <= 0
          )
            return failure(
              "compiler-model-clip-not-found",
              ["flow", groupId, "steps", stepId, "cues", cueIndex],
              "Clip must exist with a positive measured duration in the transformed GLB.",
            );
        }
      }
  for (const entry of project.components) {
    if (!("structure" in entry) || entry.structure.root.kind !== "model") continue;
    const model = modelAssets.value.models[entry.structure.root.asset.assetId];
    const references = [
      ...Object.values(entry.manifest.actions).flatMap((action) =>
        action.effects.flatMap((effect) =>
          effect.kind === "playModelClip" ? [effect.clipId] : [],
        ),
      ),
      ...Object.values(entry.manifest.outputs).flatMap((output) =>
        output.producer.kind === "modelClipCompleted" ? [output.producer.clipId] : [],
      ),
    ];
    for (const clipId of references)
      if (!model?.clips[clipId] || model.clips[clipId]!.durationMilliseconds <= 0)
        return failure(
          "compiler-model-clip-not-found",
          ["components", entry.manifest.componentId, "clips", clipId],
          "Every declared clip must exist with a positive measured duration in the transformed GLB.",
        );
  }
  const videoAssets = await compileVideoAssets(
    project.assets,
    prepared.value.sourceAssetBytes,
    buildOptions.videoValidator,
  );
  if (!videoAssets.valid) return videoAssets;
  const sourceDescriptors = { ...checked.value.assetSet.assets, ...modelAssets.value.descriptors };
  const assets: Record<string, Uint8Array> = { ...modelAssets.value.bytes };
  const fontAssets: Record<
    string,
    { mediaType: "font/ttf" | "font/otf"; checksum: `sha256:${string}`; dataBase64: string }
  > = {};
  const imageAssets: Record<
    string,
    { mediaType: "image/png" | "image/jpeg"; checksum: `sha256:${string}`; dataBase64: string }
  > = {};
  for (const [assetId, asset] of Object.entries(project.assets)) {
    if (asset.mediaType === "model/gltf-binary") continue;
    if (asset.mediaType === "video/mp4") {
      assets[assetId] = prepared.value.sourceAssetBytes[assetId]!;
      continue;
    }
    const bytes = prepared.value.sourceAssetBytes[assetId]!;
    assets[assetId] = bytes;
    const carrier = {
      checksum: asset.checksum as `sha256:${string}`,
      dataBase64: encodeSourceAssetBase64(bytes),
    };
    if (asset.mediaType === "font/ttf" || asset.mediaType === "font/otf")
      fontAssets[assetId] = { ...carrier, mediaType: asset.mediaType };
    else imageAssets[assetId] = { ...carrier, mediaType: asset.mediaType };
  }

  const definition = checked.value.definition;
  const surfaces: RenderBundle["surfaces"] = {};
  const generatedDescriptors: Record<string, BuildArtifacts["assetSet"]["assets"][string]> = {};
  const retainedChecksums = new Set<string>();
  let outputBytes = 0;
  for (const asset of Object.values(sourceDescriptors))
    if (!retainedChecksums.has(asset.checksum)) {
      retainedChecksums.add(asset.checksum);
      outputBytes += asset.encodedSizeBytes;
    }
  if (!Number.isSafeInteger(outputBytes) || outputBytes > POLICY.maxBuildOutputBytes)
    return budgetFailure("compiler-budget-output-bytes-exceeded", ["assets"]);
  if (outputBytes + mediaSourceBytes > POLICY.maxBuildAccountedPeakBytes)
    return budgetFailure("compiler-budget-accounted-peak-exceeded", ["assets"]);
  const definitionSurfaces = Object.values(definition.scene.surfaces);
  const planned = new Map<string, PlannedSurface>();
  const opaqueRendererHashes = new Map<string, string>();
  const preflightDiagnostics: Diagnostic[] = [];
  let preflightBindings = 0;
  let preflightPixels = 0;
  let preflightOutputBytes = outputBytes;
  const hasOpaqueSurface = definitionSurfaces.some((surface) => surface.content.kind === "opaque");
  let totalPartitions = 0;
  for (const surface of definitionSurfaces) {
    if (!renderer)
      return failure(
        "compiler-renderer-not-found",
        ["options", "renderers"],
        "Surface compilation requires a baked-web renderer.",
      );
    if (surface.content.kind === "opaque") {
      const reactScene = Array.isArray(project.presentation.scene)
        ? project.presentation.scene
        : (project.presentation.scene as { components: readonly unknown[] }).components.filter(
            (item): item is import("@unframe/core/authoring").StaticReactSceneItem =>
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
      if (!component || component.lock.mode !== "opaque")
        return failure(
          "compiler-opaque-entry-missing",
          ["scene", "surfaces", surface.id],
          "Opaque capture requires its frozen renderer entry.",
        );
      opaqueRendererHashes.set(surface.id, component.lock.rendererInputHash);
    }
    const result =
      surface.content.kind === "opaque"
        ? planOpaqueSurface(surface, renderer.identity, opaqueRendererHashes.get(surface.id)!)
        : planSurfacePartitions(surface, renderer.identity);
    if (!result.valid) return result;
    planned.set(surface.id, result.value);
    totalPartitions += result.value.partitions.length;
    const path = ["definition", "scene", "surfaces", surface.id] as const;
    if (result.value.partitions.length > POLICY.maxRenderSurfacesPerSemanticSurface)
      preflightDiagnostics.push(
        diagnostic(
          "compiler-budget-render-surface-count-exceeded",
          path,
          "Render Surface count exceeds the fixed texture build policy.",
        ),
      );
    for (const { plan, pixelTarget, videoNodeId } of result.value.partitions) {
      if (videoNodeId) {
        preflightBindings += Object.values(plan.states).filter(
          (state) => state.kind !== "empty",
        ).length;
        continue;
      }
      const stateCount = Object.values(plan.states).filter(({ kind }) => kind === "capture").length;
      const pixelCount = pixelTarget[0] * pixelTarget[1];
      preflightBindings += stateCount;
      preflightPixels += pixelCount * stateCount;
      if (Object.keys(plan.states).length > POLICY.maxStatesPerRenderSurface)
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
      if (hasOpaqueSurface && stateCount > 0) {
        const stateBytes = pixelCount * 4;
        const captureBytes = stateBytes * stateCount;
        const scanlineBytes = stateBytes + pixelTarget[1];
        const maxEncodedStateBytes = scanlineBytes + Math.ceil(scanlineBytes / 65_535) * 5 + 80;
        preflightOutputBytes += maxEncodedStateBytes * stateCount;
        if (
          !Number.isSafeInteger(preflightOutputBytes) ||
          preflightOutputBytes > POLICY.maxBuildOutputBytes
        )
          preflightDiagnostics.push(
            diagnostic(
              "compiler-budget-output-bytes-exceeded",
              path,
              "Predicted encoded output exceeds the fixed texture build policy.",
            ),
          );
        const peakBytes =
          mediaSourceBytes +
          preflightOutputBytes +
          captureBytes +
          maxEncodedStateBytes +
          (surface.content.kind === "opaque" ? 2 * stateBytes : 0);
        if (!Number.isSafeInteger(peakBytes) || peakBytes > POLICY.maxBuildAccountedPeakBytes)
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
  if (totalPartitions > POLICY.maxRenderSurfacesPerBundle)
    preflightDiagnostics.push(
      diagnostic(
        "compiler-budget-render-surface-count-exceeded",
        ["definition", "scene", "surfaces"],
        "Render Surface count exceeds the fixed texture build policy.",
      ),
    );
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
  if (preflightDiagnostics.length)
    return { valid: false, diagnostics: sortDiagnostics(preflightDiagnostics) };
  for (const [surfaceId, surface] of Object.entries(definition.scene.surfaces).sort(
    ([left], [right]) => compareStrings(left, right),
  )) {
    if (!renderer)
      return failure(
        "compiler-renderer-not-found",
        ["options", "renderers"],
        "Surface compilation requires a baked-web renderer.",
      );
    const stateIds = Object.keys(surface.states).sort(compareStrings);
    const surfacePlan = planned.get(surfaceId)!;
    const { semanticsByState, interactionsByState } = surfacePlan;
    const partitions = surfacePlan.partitions;
    const renderSurfaces: RenderBundle["surfaces"][string]["renderSurfaces"] = {};
    for (const { plan, pixelTarget, videoNodeId } of partitions) {
      if (videoNodeId) {
        const node =
          surface.content.kind === "structured" ? surface.content.nodes[videoNodeId] : undefined;
        if (node?.kind !== "video")
          return failure(
            "compiler-video-target-invalid",
            ["surfaces", surfaceId],
            "Video partition must resolve to a Video content node.",
          );
        const metadata = videoAssets.value[node.assetId];
        if (!metadata)
          return failure(
            "compiler-video-metadata-invalid",
            ["assets", node.assetId],
            "Video metadata is missing.",
          );
        const artifacts: RenderBundle["surfaces"][string]["renderSurfaces"][string]["artifacts"] =
          {};
        const stateBindings: RenderBundle["surfaces"][string]["renderSurfaces"][string]["stateBindings"] =
          {};
        for (const stateId of stateIds) {
          if (plan.states[stateId]?.kind === "empty") {
            stateBindings[stateId] = { kind: "empty" };
            continue;
          }
          const override = surface.states[stateId]?.contentOverrides[videoNodeId];
          const loop = override?.kind === "video" ? (override.loop ?? node.loop) : node.loop;
          const fit =
            override?.kind === "video" ? (override.style?.fit ?? node.style.fit) : node.style.fit;
          const artifactId = derivedResourceId(
            "video",
            hashCanonicalJsonPayload({
              sourceId: node.assetId,
              checksum: metadata.checksum,
              renderSurfaceId: plan.id,
              loop,
              fit,
            }),
          );
          artifacts[artifactId] = {
            ...metadata,
            checksum: metadata.checksum as `sha256:${string}`,
            id: artifactId,
            kind: "video",
            contractVersion: 1,
            assetId: node.assetId,
            loop,
            fit,
          };
          stateBindings[stateId] = { kind: "artifacts", artifactIds: [artifactId] };
        }
        renderSurfaces[plan.id] = {
          id: plan.id,
          semanticSurfaceId: surfaceId,
          logicalBounds: plan.logicalBounds,
          layer: plan.layer,
          partitionStrategyVersion: 1,
          artifacts,
          stateBindings,
        };
        continue;
      }
      context.stage = "planning";
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
        surfaceId,
        semanticsByState,
        renderSurfaceId,
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
      context.stage = "rendering";
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
        imageAssets,
        plan,
        entry: opaqueRendererHash
          ? { kind: "opaque", entryId: surfaceId, moduleHash: opaqueRendererHash }
          : { kind: "structured" },
        context: {
          locale: buildOptions.locale,
          timezone: buildOptions.timezone,
          colorScheme: buildOptions.colorScheme,
          themeId: bundleThemeId,
          themeHash,
          inputHash,
          buildContextHash,
          environmentHash,
          rendererConfigHash: buildOptions.rendererConfigHash,
          rendererFingerprint,
          pixelTarget,
        },
      });
      if (!rendered.valid) return rendered;
      if (surface.content.kind === "opaque") {
        const regionOutput = rendered.value.hitRegionsByState;
        if (
          !regionOutput &&
          Object.values(surface.states).some((state) => state.enabledInteractionIds.length)
        )
          return failure(
            "compiler-opaque-hit-regions-missing",
            ["render", surfaceId, "hitRegionsByState"],
            "Opaque Interaction requires measured Hit Regions.",
          );
        for (const stateId of stateIds)
          interactionsByState[stateId] = [...(regionOutput?.[stateId] ?? [])].map((region) => ({
            ...region,
            bounds: { ...region.bounds },
          }));
      }
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
        context.stage = "encoding";
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
        const accountedPeakBytes =
          mediaSourceBytes +
          outputBytes +
          captureBytes +
          encoded.value.byteLength +
          (surface.content.kind === "opaque" ? capture.rgba.length * 2 : 0);
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
      const stateBindings: Record<
        string,
        { kind: "artifacts"; artifactIds: string[] } | { kind: "empty" }
      > = {};
      for (const stateId of stateIds)
        stateBindings[stateId] =
          plan.states[stateId]?.kind === "empty"
            ? { kind: "empty" }
            : { kind: "artifacts", artifactIds: [artifactId] };
      const alphaFeature =
        rendered.value.captures[0]?.alphaMode === "straight"
          ? ("alpha-straight" as const)
          : ("alpha-opaque" as const);
      renderSurfaces[renderSurfaceId] = {
        id: renderSurfaceId,
        semanticSurfaceId: surfaceId,
        logicalBounds: plan.logicalBounds,
        layer: plan.layer,
        partitionStrategyVersion: 1,
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
      };
    }
    surfaces[surfaceId] = {
      semanticSurfaceId: surfaceId,
      logicalSize: [...surface.logicalSize],
      physicalSizeMeters: [...surface.physicalSizeMeters],
      renderSurfaceIds: partitions.map(({ plan }) => plan.id),
      renderSurfaces,
      semanticsByState,
      interactionsByState,
    };
  }

  context.stage = "artifacts";
  const bundle: RenderBundle = {
    schemaVersion: 1,
    bundleId: `b:${hashCanonicalJsonPayload({ sourceHash: checked.value.sourceHash, definitionHash: checked.value.definitionHash, environmentHash, locale: buildOptions.locale, timezone: buildOptions.timezone, colorScheme: buildOptions.colorScheme, themeId: bundleThemeId, themeHash, rendererConfigHash: buildOptions.rendererConfigHash, textureBuildPolicy: POLICY }).slice(7)}`,
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
      themeHash,
      textureBuildPolicy: POLICY,
    },
    surfaces,
    models: modelAssets.value.models,
  };
  const assetSet: BuildArtifacts["assetSet"] = {
    schemaVersion: 1,
    assets: { ...sourceDescriptors, ...generatedDescriptors },
  };
  const renderBundleJson = canonicalizeJsonPayload(bundle);
  const renderBundleHash = hashCanonicalJsonPayload(bundle);
  const assetSetJson = canonicalizeJsonPayload(assetSet);
  const assetSetHash = hashCanonicalJsonPayload(assetSet);
  const buildManifest: BuildArtifacts["buildManifest"] = {
    schemaVersion: 1,
    buildId: `build:${hashCanonicalJsonPayload({ sourceHash: checked.value.sourceHash, renderBundleHash, assetSetHash }).slice(7)}`,
    presentationId: definition.presentationId,
    sourceDraftRevision: 0,
    definitionHash: checked.value.definitionHash,
    renderBundleHash,
    assetSetHash,
    contractVersions: {
      definition: 1,
      renderBundle: 1,
      assetSet: 1,
      delivery: 3,
      runtime: 3,
      progression: 2,
      projection: 2,
    },
  };
  const artifactValidation = validatePresentationArtifacts(definition, bundle);
  if (!artifactValidation.valid) return artifactValidation;
  const verified = verifyBuildIntegrity({
    definition,
    renderBundle: bundle,
    assetSet,
    buildManifest,
  });
  if (!verified.valid) return verified;
  const compiled: CompiledDeclarationProject = {
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
  };
  if (cache && cacheKey) await writeCachedBuild(cache, cacheKey, compiled);
  return {
    valid: true,
    value: compiled,
    diagnostics: [],
  };
};

const compileWithErrors = async (
  input: unknown,
  options: unknown,
  checked: CheckedDeclarationProject | undefined,
  sourceAssetBytes: unknown,
  cache: CompilerBuildCache | undefined,
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  const context: { stage: CompilerStage } = { stage: "check" };
  try {
    return await compileUnchecked(input, options, checked, sourceAssetBytes, cache, context);
  } catch (cause) {
    throw new CompilerInternalError(context.stage, cause);
  }
};

export const compileCheckedDeclarationProject = (
  project: CompilerDeclarationProject,
  checked: CheckedDeclarationProject,
  options: unknown,
  sourceAssetBytes: CompilerSourceAssetBytes = {},
  cache?: CompilerBuildCache,
) => compileWithErrors(project, options, checked, sourceAssetBytes, cache);
export const compileDeclarationProject = (
  input: unknown,
  options: unknown,
  sourceAssetBytes: CompilerSourceAssetBytes = {},
  cache?: CompilerBuildCache,
): Promise<ValidationResult<CompiledDeclarationProject>> =>
  compileWithErrors(input, options, undefined, sourceAssetBytes, cache);
