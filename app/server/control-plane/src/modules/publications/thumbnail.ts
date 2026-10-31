import type { BuildArtifacts } from "@unframe/core";

export function firstThumbnailTexture(bundle: BuildArtifacts["renderBundle"]): string | undefined {
  for (const surfaceId of Object.keys(bundle.surfaces).sort()) {
    const surface = bundle.surfaces[surfaceId]!;
    for (const renderSurfaceId of surface.renderSurfaceIds) {
      const renderSurface = surface.renderSurfaces[renderSurfaceId];
      if (!renderSurface) continue;
      for (const artifactId of Object.keys(renderSurface.artifacts).sort()) {
        const artifact = renderSurface.artifacts[artifactId]!;
        if (artifact.kind !== "baked-web") continue;
        for (const stateId of Object.keys(artifact.states).sort()) {
          return artifact.states[stateId]!.texture.assetId;
        }
      }
    }
  }
  return undefined;
}
