import type { TextureArtifact } from "@unframe/unframe-core";
import type * as z from "zod";

import type { encodeRequestSchema, resizeRequestSchema } from "./validation/schemas.js";

type DeepReadonly<T> = T extends Uint8Array
  ? Uint8Array
  : T extends readonly unknown[]
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type EncodeRequest = DeepReadonly<z.input<typeof encodeRequestSchema>>;
export type EncodeLimits = EncodeRequest["limits"];
export type RgbaInput = EncodeRequest["rgba"];
export type ResizeRequest = DeepReadonly<z.input<typeof resizeRequestSchema>>;

export type ResizedRgba = {
  readonly sourceId: string;
  readonly rgba: Uint8Array;
  readonly pixelSize: readonly [number, number];
  readonly colorSpace: "srgb";
  readonly alphaMode: "opaque" | "straight";
  readonly sourceChecksum: string;
  readonly checksum: string;
  readonly provenance: {
    readonly transformerId: "unframe-memory-rgba-resize";
    readonly version: "1";
    readonly fingerprint: "linear-srgb-associated-alpha-box-linear-v1";
  };
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
