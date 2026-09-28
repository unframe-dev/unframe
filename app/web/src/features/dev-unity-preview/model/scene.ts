import type { BuildArtifactsV2 } from "@unframe/unframe-core";
import type {
  PreviewQuad,
  PreviewSceneLoad,
  PreviewVector2,
  PreviewVector3,
  PreviewQuaternion,
  PreviewUvRect,
} from "./types";

type Surface = BuildArtifactsV2["definition"]["scene"]["surfaces"][string];
type Bounds =
  BuildArtifactsV2["renderBundle"]["surfaces"][string]["renderSurfaces"][string]["logicalBounds"];

const copy3 = (value: readonly [number, number, number]): PreviewVector3 => [
  value[0],
  value[1],
  value[2],
];
const copy4 = (value: readonly [number, number, number, number]): PreviewQuaternion => [
  value[0],
  value[1],
  value[2],
  value[3],
];

export const previewQuadId = (
  surfaceId: string,
  renderSurfaceId: string,
  artifactId: string,
  stateId: string,
) => JSON.stringify([surfaceId, renderSurfaceId, artifactId, stateId]);

function freezePayload<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) freezePayload(child);
  return Object.freeze(value);
}

function quadGeometry(surface: Surface, bounds: Bounds) {
  const [logicalWidth, logicalHeight] = surface.logicalSize;
  const [physicalWidth, physicalHeight] = surface.physicalSizeMeters;
  const fitX = physicalWidth / logicalWidth;
  const fitY = physicalHeight / logicalHeight;
  const scaleX =
    surface.fit === "stretch"
      ? fitX
      : surface.fit === "contain"
        ? Math.min(fitX, fitY)
        : Math.max(fitX, fitY);
  const scaleY = surface.fit === "stretch" ? fitY : scaleX;
  const viewportWidth = Math.min(logicalWidth, physicalWidth / scaleX);
  const viewportHeight = Math.min(logicalHeight, physicalHeight / scaleY);
  const left = Math.max(bounds.x, (logicalWidth - viewportWidth) / 2);
  const top = Math.max(bounds.y, (logicalHeight - viewportHeight) / 2);
  const right = Math.min(bounds.x + bounds.width, (logicalWidth + viewportWidth) / 2);
  const bottom = Math.min(bounds.y + bounds.height, (logicalHeight + viewportHeight) / 2);
  if (right <= left || bottom <= top) return null;
  const width = right - left;
  const height = bottom - top;
  return {
    position: [
      (left + width / 2 - logicalWidth / 2) * scaleX,
      (logicalHeight / 2 - top - height / 2) * scaleY,
      0,
    ] as PreviewVector3,
    size: [width * scaleX, height * scaleY] as PreviewVector2,
    uvRect: [
      (left - bounds.x) / bounds.width,
      1 - (bottom - bounds.y) / bounds.height,
      (right - bounds.x) / bounds.width,
      1 - (top - bounds.y) / bounds.height,
    ] as PreviewUvRect,
  };
}

export function createPreviewScene(
  artifacts: BuildArtifactsV2,
  textureUrls: ReadonlyMap<string, string>,
): PreviewSceneLoad {
  const definition = artifacts.definition;
  const nodes = Object.values(definition.scene.nodes)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => ({
      id: node.id,
      parentId: node.parent.kind === "node" ? node.parent.nodeId : null,
      position: copy3(node.transform.position),
      rotation: copy4(node.transform.rotation),
      scale: copy3(node.transform.scale),
    }));
  const quads: PreviewQuad[] = [];
  for (const [surfaceId, compiled] of Object.entries(artifacts.renderBundle.surfaces)) {
    const surface = definition.scene.surfaces[surfaceId]!;
    for (const renderSurface of Object.values(compiled.renderSurfaces)) {
      const geometry = quadGeometry(surface, renderSurface.logicalBounds);
      if (!geometry) continue;
      for (const [stateId, binding] of Object.entries(renderSurface.stateBindings)) {
        if (binding.kind !== "artifacts") continue;
        if (binding.artifactIds.length !== 1) {
          throw new Error(
            `複数 artifact の Render Surface はプレビュー未対応です: ${renderSurface.id}`,
          );
        }
        for (const artifactId of binding.artifactIds) {
          const artifact = renderSurface.artifacts[artifactId]!;
          if (artifact.kind !== "baked-web") continue;
          const textureId = artifact.states[stateId]!.texture.assetId;
          quads.push({
            id: previewQuadId(surfaceId, renderSurface.id, artifact.id, stateId),
            nodeId: surface.hostNodeId,
            textureId,
            position: geometry.position,
            size: geometry.size,
            uvRect: geometry.uvRect,
            layer: renderSurface.layer,
          });
        }
      }
    }
  }
  return freezePayload({
    nodes,
    textures: [...textureUrls].map(([id, url]) => ({ id, url })),
    quads,
    stageSize: copy3(definition.stage.size),
  });
}
