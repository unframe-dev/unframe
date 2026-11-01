import {
  compileDeclarationProject as compile,
  compileCheckedDeclarationProject as compileChecked,
  compileAuthoringProject as compileAuthoring,
  type BuildMediaPorts,
  type CheckedDeclarationProject,
  type CompilerBuildCache,
  type CompilerDeclarationProject,
  type CompilerSourceAssetBytes,
} from "@unframe/build";
import {
  encodeRgbaToPng,
  MODEL_TRANSFORM_IDENTITY,
  PNG_ENCODER_IDENTITY,
  transformGlb,
} from "@unframe/media-node";

const media: BuildMediaPorts = {
  pngIdentity: PNG_ENCODER_IDENTITY,
  modelIdentity: MODEL_TRANSFORM_IDENTITY,
  encodePng: encodeRgbaToPng,
  transformModel: transformGlb,
};
export const compileDeclarationProject = (
  input: unknown,
  options: unknown,
  bytes: CompilerSourceAssetBytes = {},
  cache?: CompilerBuildCache,
) => compile(input, options, bytes, cache, media);
export const compileCheckedDeclarationProject = (
  project: CompilerDeclarationProject,
  checked: CheckedDeclarationProject,
  options: unknown,
  bytes: CompilerSourceAssetBytes = {},
  cache?: CompilerBuildCache,
) => compileChecked(project, checked, options, bytes, cache, media);
export const compileAuthoringProject = (
  source: unknown,
  carrier: unknown,
  options: unknown,
  bytes: CompilerSourceAssetBytes = {},
  cache?: CompilerBuildCache,
) => compileAuthoring(source, carrier, options, bytes, cache, media);
