import type {
  PresentationArtifacts,
  SemanticSurface,
  SurfaceContentNode,
  ValidationResult,
} from "../domain/model.js";
import { canonicalizeJsonPayload, hashCanonicalJsonPayload } from "../canonicalization/payload.js";
import { materializeCompletedSemanticTree } from "../semantic-tree/materialize.js";
import { resolveStructuredLayout, type LogicalRect } from "../semantic-tree/structured-layout.js";
import { diagnostic, pathSegment, sorted } from "./shared.js";
import { validatePresentationDefinition } from "./definition.js";
import { validateRenderBundle } from "./render-bundle.js";

const sameSet = (left: Iterable<string>, right: Iterable<string>) => {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((item) => b.has(item));
};

const axisOverlaps = (rects: readonly LogicalRect[], axis: "x" | "y") => {
  const size = axis === "x" ? "width" : "height";
  const start = Math.max(...rects.map((rect) => rect[axis]));
  const end = Math.min(...rects.map((rect) => rect[axis] + rect[size]));
  return (
    end > start || (end === start && rects.some((rect) => rect[axis] + rect[size] === rect[axis]))
  );
};

const visibleWindow = (surface: SemanticSurface): LogicalRect => {
  const [width, height] = surface.logicalSize;
  if (surface.fit !== "cover") return { x: 0, y: 0, width, height };
  const [physicalWidth, physicalHeight] = surface.physicalSizeMeters;
  const physicalAspect = physicalWidth / physicalHeight;
  const logicalAspect = width / height;
  const logPhysicalAspect = Math.log(physicalWidth) - Math.log(physicalHeight);
  const logLogicalAspect = Math.log(width) - Math.log(height);
  const cropWidth =
    Number.isFinite(physicalAspect) &&
    physicalAspect > 0 &&
    Number.isFinite(logicalAspect) &&
    logicalAspect > 0
      ? physicalAspect < logicalAspect
      : logPhysicalAspect < logLogicalAspect;
  if (cropWidth) {
    const measured =
      Number.isFinite(physicalAspect) && physicalAspect > 0
        ? height * physicalAspect
        : Math.exp(Math.log(height) + logPhysicalAspect);
    const croppedWidth = Math.min(width, Math.max(Number.MIN_VALUE, measured));
    return { x: (width - croppedWidth) / 2, y: 0, width: croppedWidth, height };
  }
  const measured =
    Number.isFinite(physicalAspect) && physicalAspect > 0
      ? width / physicalAspect
      : Math.exp(Math.log(width) - logPhysicalAspect);
  const croppedHeight = Math.min(height, Math.max(Number.MIN_VALUE, measured));
  return { x: 0, y: (height - croppedHeight) / 2, width, height: croppedHeight };
};

const visibleVideoInState = (surface: SemanticSurface, stateId: string, videoId: string) => {
  if (surface.content.kind !== "structured") return false;
  const layout = resolveStructuredLayout(surface, stateId);
  const clips = [layout[videoId]!, visibleWindow(surface)];
  let nodeId: string | null = videoId;
  while (nodeId !== null) {
    const base: SurfaceContentNode = surface.content.nodes[nodeId]!;
    const override: SemanticSurface["states"][string]["contentOverrides"][string] | undefined =
      surface.states[stateId]!.contentOverrides[nodeId];
    const node: SurfaceContentNode = override
      ? ({ ...base, ...override } as SurfaceContentNode)
      : base;
    if (!node.visible || node.opacity === 0) return false;
    if (node.kind === "frame" && node.clip) clips.push(layout[nodeId]!);
    nodeId = node.parentId;
  }
  return axisOverlaps(clips, "x") && axisOverlaps(clips, "y");
};

export const validatePresentationArtifacts = (
  definition: unknown,
  renderBundle: unknown,
  options: { fullDelivery?: boolean } = {},
): ValidationResult<PresentationArtifacts> => {
  const definitionResult = validatePresentationDefinition(definition, options);
  const bundleResult = validateRenderBundle(renderBundle, options);
  const diagnostics = [...definitionResult.diagnostics, ...bundleResult.diagnostics];
  if (!definitionResult.valid || !bundleResult.valid)
    return { valid: false, diagnostics: sorted(diagnostics) };

  const expectedHash = hashCanonicalJsonPayload(definitionResult.value);
  if (bundleResult.value.definitionHash !== expectedHash)
    diagnostics.push(
      diagnostic(
        "hash.invalid",
        "/definitionHash",
        "RenderBundle definitionHash must match the canonical PresentationDefinition hash.",
      ),
    );

  const definitionSurfaces = definitionResult.value.scene.surfaces;
  const bundleSurfaces = bundleResult.value.surfaces;
  const mediaSurfaceIds = new Set<string>();
  for (const group of Object.values(definitionResult.value.flow.groups))
    for (const step of Object.values(group.steps))
      for (const cue of step.cues) {
        if (cue.trigger.kind === "mediaCompleted") mediaSurfaceIds.add(cue.trigger.surfaceId);
        for (const action of cue.actions)
          if (
            action.kind === "media.play" ||
            action.kind === "media.pause" ||
            action.kind === "media.seek"
          )
            mediaSurfaceIds.add(action.surfaceId);
      }
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
    const videoContent =
      definitionSurface.content.kind === "structured"
        ? Object.values(definitionSurface.content.nodes).filter((node) => node.kind === "video")
        : [];
    if (
      canonicalizeJsonPayload(bundleSurface.logicalSize) !==
        canonicalizeJsonPayload(definitionSurface.logicalSize) ||
      canonicalizeJsonPayload(bundleSurface.physicalSizeMeters) !==
        canonicalizeJsonPayload(definitionSurface.physicalSizeMeters)
    )
      diagnostics.push(
        diagnostic("artifact.invalid", path, "Compiled surface sizes must match the Definition."),
      );
    const stateIds = Object.keys(definitionSurface.states).sort();
    let canonicalVideoDuration: number | undefined;
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
      let stateVideoLoop: boolean | undefined;
      let firstVideoArtifactPath: string | undefined;
      let firstNonemptyBindingPath: string | undefined;
      let firstBindingPath: string | undefined;
      let variantLoopMismatch = false;
      for (const renderSurfaceId of Object.keys(bundleSurface.renderSurfaces).sort()) {
        const renderSurface = bundleSurface.renderSurfaces[renderSurfaceId];
        if (renderSurface === undefined) continue;
        const binding = renderSurface.stateBindings[stateId];
        firstBindingPath ??= `${path}/renderSurfaces/${pathSegment(renderSurface.id)}/stateBindings/${pathSegment(stateId)}`;
        if (binding?.kind !== "artifacts") continue;
        firstNonemptyBindingPath ??= `${path}/renderSurfaces/${pathSegment(renderSurface.id)}/stateBindings/${pathSegment(stateId)}`;
        for (const artifactId of [...binding.artifactIds].sort()) {
          const artifact = renderSurface.artifacts[artifactId];
          if (artifact?.kind !== "video") continue;
          const artifactPath = `${path}/renderSurfaces/${pathSegment(renderSurface.id)}/artifacts/${pathSegment(artifactId)}`;
          if (
            videoContent.length === 1 &&
            canonicalVideoDuration !== undefined &&
            artifact.durationMilliseconds !== canonicalVideoDuration
          )
            diagnostics.push(
              diagnostic(
                "artifact.invalid",
                `${artifactPath}/durationMilliseconds`,
                "Video artifacts for one Surface must have the same canonical duration.",
              ),
            );
          if (videoContent.length === 1) canonicalVideoDuration ??= artifact.durationMilliseconds;
          if (stateVideoLoop !== undefined && artifact.loop !== stateVideoLoop) {
            variantLoopMismatch = true;
            diagnostics.push(
              diagnostic(
                "artifact.invalid",
                `${artifactPath}/loop`,
                "Video variants bound to one State must have the same loop value.",
              ),
            );
          }
          firstVideoArtifactPath ??= artifactPath;
          stateVideoLoop ??= artifact.loop;
        }
      }
      if (
        mediaSurfaceIds.has(surfaceId) &&
        firstVideoArtifactPath === undefined &&
        videoContent.length === 1 &&
        visibleVideoInState(definitionSurface, stateId, videoContent[0]!.id)
      )
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            firstNonemptyBindingPath ?? firstBindingPath ?? `${path}/renderSurfaces`,
            "Visible Media State requires a bound Video artifact candidate.",
          ),
        );
      const content = videoContent.length === 1 ? videoContent[0] : undefined;
      const override = content && definitionSurface.states[stateId]?.contentOverrides[content.id];
      const expectedLoop =
        override?.kind === "video" ? (override.loop ?? content?.loop) : content?.loop;
      if (
        expectedLoop !== undefined &&
        stateVideoLoop !== undefined &&
        !variantLoopMismatch &&
        stateVideoLoop !== expectedLoop
      )
        diagnostics.push(
          diagnostic(
            "artifact.invalid",
            `${firstVideoArtifactPath}/loop`,
            "Bound Video loop must match the effective Definition State loop.",
          ),
        );
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
      const regions = bundleSurface.interactionsByState[stateId] ?? [];
      const enabled = new Set(definitionSurface.states[stateId]?.enabledInteractionIds ?? []);
      const covered = new Set(regions.map((region) => region.interactionId));
      for (const [index, region] of regions.entries()) {
        const interaction = definitionSurface.interactions[region.interactionId];
        if (!enabled.has(region.interactionId) || interaction?.hitPriority !== region.priority)
          diagnostics.push(
            diagnostic(
              "artifact.invalid",
              `${path}/interactionsByState/${pathSegment(stateId)}/${index}`,
              "Region must match an enabled Definition Interaction and hit priority.",
            ),
          );
      }
      for (const interactionId of enabled)
        if (!covered.has(interactionId))
          diagnostics.push(
            diagnostic(
              "artifact.invalid",
              `${path}/interactionsByState/${pathSegment(stateId)}`,
              "Enabled Interaction requires a region.",
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
