import type { TextureArtifact } from "@unframe/presentation-core";

export type RgbaInput = Uint8Array;

export type EncodeLimits = {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
};

export type EncodeRequest = {
  readonly sourceId: string;
  readonly rgba: RgbaInput;
  readonly pixelSize: readonly [number, number];
  readonly colorSpace: "srgb";
  readonly alphaMode: "opaque" | "straight" | "premultiplied";
  readonly limits: EncodeLimits;
};

export type EncodedTextureArtifact = {
  readonly descriptor: TextureArtifact;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sourceId: string;
  readonly provenance: {
    readonly encoderId: "unframe-memory-png";
    readonly version: "1";
    readonly fingerprint: "png-rgba8-srgb-filter0-store-v1";
  };
};
