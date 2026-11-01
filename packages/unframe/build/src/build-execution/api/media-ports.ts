import type { TextureArtifact, RenderBundle, ValidationResult } from "@unframe/presentation";
import type { Json } from "@unframe/authoring";

export type EncodeLimits = Readonly<{
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  maxInputBytes: number;
  maxOutputBytes: number;
}>;
export type VideoMetadata = {
  mediaType: "video/mp4";
  codec: "h264";
  checksum: string;
  encodedSizeBytes: number;
  durationMilliseconds: number;
  pixelSize: [number, number];
  alpha: false;
  audio: boolean;
  requiredFeatures: ("h264" | "audio")[];
};
export type ModelLimits = {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxDecodedAccessorBytes: number;
  maxNodes: number;
  maxPrimitives: number;
  maxVertices: number;
  maxTriangles: number;
  maxBonesPerSkin: number;
  maxMorphTargetsPerPrimitive: number;
  maxAnimationClips: number;
};
export type BuildMediaPorts = Readonly<{
  pngIdentity: Json;
  modelIdentity: Json;
  encodePng(input: {
    sourceId: string;
    rgba: Uint8Array;
    pixelSize: readonly [number, number];
    colorSpace: "srgb";
    alphaMode: "opaque" | "straight" | "premultiplied";
    limits: EncodeLimits;
  }): ValidationResult<{ descriptor: TextureArtifact; bytes: Uint8Array; byteLength: number }>;
  transformModel(input: {
    sourceId: string;
    bytes: Uint8Array;
    limits: ModelLimits;
  }): Promise<ValidationResult<{ descriptor: RenderBundle["models"][string]; bytes: Uint8Array }>>;
}>;
