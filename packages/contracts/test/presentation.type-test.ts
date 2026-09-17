import type {
  SerializedPresentationDefinitionV1,
  SerializedRenderBundleV1,
} from "../src/presentation/index";

export const tupleConformance = {
  stageSize: [4, 3, 2],
  logicalSize: [1920, 1080],
  rotation: [0, 0, 0, 1],
  texturePixelSize: [2048, 1152],
} satisfies {
  stageSize: SerializedPresentationDefinitionV1["stage"]["size"];
  logicalSize: SerializedPresentationDefinitionV1["scene"]["surfaces"][string]["logicalSize"];
  rotation: SerializedPresentationDefinitionV1["scene"]["nodes"][string]["transform"]["rotation"];
  texturePixelSize: SerializedRenderBundleV1["surfaces"][string]["renderSurfaces"][string]["artifacts"][string]["states"][string]["textures"][number]["pixelSize"];
};
