import { createNodeStylePreparationPort } from "@unframe/styles-node";
import { hashCanonicalJsonPayload } from "@unframe/artifacts";
import { createModelBuildIdentity, type BuildMediaPorts } from "@unframe/build";
import {
  PNG_ENCODER_IDENTITY,
  MODEL_TRANSFORM_IDENTITY,
  encodeRgbaToPng,
  transformGlb,
  createVideoValidator,
} from "@unframe/media-node";

export const buildMediaPorts: BuildMediaPorts = {
  pngIdentity: PNG_ENCODER_IDENTITY,
  modelIdentity: MODEL_TRANSFORM_IDENTITY,
  encodePng: encodeRgbaToPng,
  transformModel: transformGlb,
};
export const sourceAssetPorts = {
  styles: createNodeStylePreparationPort(),
  modelTransformIdentity: hashCanonicalJsonPayload(
    createModelBuildIdentity(MODEL_TRANSFORM_IDENTITY),
  ) as `sha256:${string}`,
  videoTransformIdentity: async () =>
    hashCanonicalJsonPayload((await createVideoValidator()).identity) as `sha256:${string}`,
};
