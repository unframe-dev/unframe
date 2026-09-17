import type { TextureArtifact } from "@unframe/unframe-core";
import type * as z from "zod";

import type { encodeRequestSchema } from "./validation/schemas.js";

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
