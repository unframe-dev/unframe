import { createNodeStylePreparationPort } from "@unframe-dev/styles-node";
import { hashCanonicalJsonPayload } from "@unframe-dev/artifacts";
import { createModelBuildIdentity, type BuildMediaPorts } from "@unframe-dev/build";
import {
  PNG_ENCODER_IDENTITY,
  MODEL_TRANSFORM_IDENTITY,
  encodeRgbaToPng,
  transformGlb,
  createVideoValidator,
} from "@unframe-dev/media-node";

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
  videoTransformIdentity: async (signal?: AbortSignal) =>
    hashCanonicalJsonPayload((await createVideoValidator(signal)).identity) as `sha256:${string}`,
};
